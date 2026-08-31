const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export type Me = {
  email: string | null;
  status: string;
  plan: "monthly" | null;
  currentPeriodEnd: number | null;
  configured: boolean;
  pro: boolean;
  connected: boolean;
  last4: string | null;
  livemode: boolean | null;
};

export type Finding = {
  id: string;
  kind: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  stripe_id: string | null;
  status: "open" | "resolved" | "replayed";
  first_seen: number;
  last_seen: number;
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return parseJson<T>(
    await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    }),
  );
}

export async function fetchMe(): Promise<Me> {
  try {
    return await api<Me>("/me");
  } catch {
    return {
      email: null,
      status: "free",
      plan: null,
      currentPeriodEnd: null,
      configured: false,
      pro: false,
      connected: false,
      last4: null,
      livemode: null,
    };
  }
}
