import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env';

const confirmedSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  amountCents: z.number().int().positive(),
  metadata: z.object({ tenantId: z.uuid(), invoiceId: z.uuid() }),
});
export type ConfirmedPayment = z.infer<typeof confirmedSchema>;

export class ProviderUnavailableError extends Error {}

/**
 * "A webhook is never the truth." The notification is only a POINTER ("something happened to payment X");
 * the state we act on is fetched from the provider over an authenticated call that WE initiate. A forged,
 * replayed or stale notification can then, at worst, make us ask a question — not move money.
 */
@Injectable()
export class PaymentProviderClient {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return Boolean(this.env.PAYMENT_PROVIDER_API_URL);
  }

  /** Returns null when the provider says the payment does not exist; throws when it cannot be asked. */
  async confirm(providerRef: string): Promise<ConfirmedPayment | null> {
    const base = this.env.PAYMENT_PROVIDER_API_URL;
    if (!base) throw new ProviderUnavailableError('reverse confirmation is not configured');
    let response: Response;
    try {
      response = await fetch(`${base.replace(/\/+$/, '')}/payments/${encodeURIComponent(providerRef)}`, {
        headers: this.env.PAYMENT_PROVIDER_API_TOKEN
          ? { authorization: `Bearer ${this.env.PAYMENT_PROVIDER_API_TOKEN}` }
          : {},
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
    } catch (error) {
      throw new ProviderUnavailableError(error instanceof Error ? error.message : 'provider unreachable');
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new ProviderUnavailableError(`provider answered HTTP ${response.status}`);
    const parsed = confirmedSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new ProviderUnavailableError('provider answered with an unexpected shape');
    return parsed.data;
  }
}
