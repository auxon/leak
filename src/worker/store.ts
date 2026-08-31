export type Plan = "monthly" | null;

export type EntitlementStatus =
  | "free"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired";

export type Entitlement = {
  email: string;
  customerId: string;
  subscriptionId: string;
  status: EntitlementStatus;
  priceId: string;
  plan: Plan;
  currentPeriodEnd: number;
  updatedAt: number;
};

export type MeResponse = {
  email: string | null;
  status: EntitlementStatus;
  plan: Plan;
  currentPeriodEnd: number | null;
  configured: boolean;
  pro: boolean;
  connected: boolean;
  last4: string | null;
  livemode: boolean | null;
};

export type AccountRecord = {
  wrappedKey: string;
  livemode: boolean;
  last4: string;
  createdAt: number;
  nextScanAt?: number;
  lastAlertAt?: number;
};

export type FindingKind =
  | "no_endpoints"
  | "endpoint_disabled"
  | "missing_events"
  | "delivery_failed"
  | "past_due_sub"
  | "open_invoice";

export type FindingRow = {
  id: string;
  email: string;
  kind: FindingKind;
  dedupe_key: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  stripe_id: string | null;
  status: "open" | "resolved" | "replayed";
  first_seen: number;
  last_seen: number;
};

export function entitlementKey(email: string): string {
  return `ent:${email.trim().toLowerCase()}`;
}

export function magicKey(hash: string): string {
  return `magic:${hash}`;
}

export function rateKey(email: string): string {
  return `rl:${email.trim().toLowerCase()}`;
}

export function accountKey(email: string): string {
  return `acct:${email.trim().toLowerCase()}`;
}

export function isProStatus(status: EntitlementStatus | undefined): boolean {
  return status === "trialing" || status === "active" || status === "past_due";
}

export async function getEntitlement(kv: KVNamespace, email: string): Promise<Entitlement | null> {
  return kv.get<Entitlement>(entitlementKey(email), "json");
}

export async function putEntitlement(kv: KVNamespace, ent: Entitlement): Promise<void> {
  await kv.put(entitlementKey(ent.email), JSON.stringify(ent));
  if (ent.customerId) await kv.put(`cust:${ent.customerId}`, ent.email);
}

export async function getAccount(kv: KVNamespace, email: string): Promise<AccountRecord | null> {
  return kv.get<AccountRecord>(accountKey(email), "json");
}

export async function putAccount(kv: KVNamespace, email: string, acct: AccountRecord): Promise<void> {
  await kv.put(accountKey(email), JSON.stringify(acct));
}

export async function deleteAccount(kv: KVNamespace, email: string): Promise<void> {
  await kv.delete(accountKey(email));
}
