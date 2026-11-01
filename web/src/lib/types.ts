export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Resource {
  id: string;
  name: string;
  data: Record<string, unknown>;
  status: 'active' | 'archived';
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'void';
  total: string;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  balanceCents: number;
  version: number;
  createdAt: string;
  lines?: { position: number; description: string; quantity: number; unitCents: number }[];
  payments?: {
    id: string;
    kind: 'payment' | 'refund';
    amountCents: number;
    provider: string | null;
    createdAt: string;
  }[];
}

export interface Member {
  userId: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  active: boolean;
  createdAt: string;
}

export interface AuditEntry {
  seq: number;
  id: string;
  tenantId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  prevHash: string | null;
  hash: string;
  createdAt: string;
}
export interface AuditPage {
  items: AuditEntry[];
  nextBefore: number | null;
}
export interface AuditVerdict {
  valid: boolean;
  checked: number;
  headHash?: string | null;
  broken?: { seq: number; reason: string };
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  active: boolean;
  createdAt: string;
  /** Only present in the creation response: the signing secret is shown once. */
  secret?: string;
}
export interface Delivery {
  id: string;
  topic: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}
