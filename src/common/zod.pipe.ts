import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { badRequest } from './errors';

/** Validates (and strips unknown keys from) request input with a zod schema. */
@Injectable()
export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata?: ArgumentMetadata): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw badRequest('VALIDATION_FAILED', 'Request validation failed', {
        issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
