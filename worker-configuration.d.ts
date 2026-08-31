interface KVNamespace {
  get(key: string, type?: "text"): Promise<string | null>;
  get<T>(key: string, type: "json"): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string }): Promise<{ keys: Array<{ name: string }> }>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results?: T[] }>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface ScheduledEvent {
  cron: string;
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

declare namespace Cloudflare {
  interface Env {
    KV: KVNamespace;
    DB: D1Database;
    ASSETS?: Fetcher;
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SECRET: string;
    STRIPE_PRICE_MONTHLY: string;
    SESSION_SECRET: string;
    KEY_ENCRYPTION_KEY: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM: string;
    APP_ORIGIN: string;
    APP_BASE: string;
    ENVIRONMENT: string;
  }
}

interface Env extends Cloudflare.Env {}
