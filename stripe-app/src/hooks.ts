import { useCallback, useEffect, useMemo, useState } from "react";
import Stripe from "stripe";
import { createHttpClient, STRIPE_API_KEY } from "@stripe/ui-extension-sdk/http_client";
import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { collectFindings, summarize, type Finding } from "./scan";

export function useLeakStripe(): Stripe {
  return useMemo(
    () =>
      new Stripe(STRIPE_API_KEY, {
        httpClient: createHttpClient(),
      }),
    [],
  );
}

export function useLeakFindings(
  stripe: Stripe | null,
  livemode: boolean,
): {
  findings: Finding[];
  loading: boolean;
  error: string | null;
  scannedAt: Date | null;
  rescan: () => void;
} {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<Date | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!stripe) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    collectFindings(stripe, livemode)
      .then((rows) => {
        if (cancelled) return;
        setFindings(rows);
        setScannedAt(new Date());
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Scan failed.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stripe, livemode, nonce]);

  const rescan = useCallback(() => setNonce((n) => n + 1), []);
  return { findings, loading, error, scannedAt, rescan };
}

export function livemodeOf(env: ExtensionContextValue["environment"]): boolean {
  return env.mode !== "test";
}

export { summarize };
export type { Finding };
