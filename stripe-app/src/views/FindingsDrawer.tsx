import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  ContextView,
  Divider,
  Link,
  Spinner,
} from "@stripe/ui-extension-sdk/ui";
import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { summarize } from "../scan";
import { livemodeOf, useLeakFindings, useLeakStripe } from "../hooks";

/** Full findings list in the Dashboard drawer, on every page. */
export function FindingsDrawer({ environment }: ExtensionContextValue) {
  const stripe = useLeakStripe();
  const { findings, loading, error, scannedAt, rescan } = useLeakFindings(
    stripe,
    livemodeOf(environment),
  );
  const [showAll, setShowAll] = useState(false);
  const { critical, warnings, healthy } = summarize(findings);
  const visible = showAll ? findings : findings.slice(0, 10);

  return (
    <ContextView
      title="Leak findings"
      actions={<Button onPress={rescan}>Rescan</Button>}
    >
      {loading ? (
        <Box>
          <Spinner /> Scanning webhooks, deliveries, subscriptions, invoices…
        </Box>
      ) : error ? (
        <Box>
          {error} <Button onPress={rescan}>Retry</Button>
        </Box>
      ) : healthy ? (
        <Box>
          <Badge type="positive">Healthy</Badge> Nothing leaking. Leak
          checks webhook endpoints, delivery failures, past-due
          subscriptions, and open invoices.
        </Box>
      ) : (
        <Box>
          <Badge type={critical > 0 ? "negative" : "warning"}>
            {critical} critical · {warnings} warnings
          </Badge>
        </Box>
      )}
      {visible.map((f, i) => (
        <Box key={`${f.kind}-${i}`}>
          <Divider />
          <Box>
            <Badge type={f.severity === "critical" ? "negative" : "warning"}>
              {f.severity}
            </Badge>{" "}
            {f.title}
          </Box>
          {f.detail.split("\n").map((line, j) => (
            <Box key={j}>{line}</Box>
          ))}
          {f.fixUrl ? (
            <Box>
              <Link href={f.fixUrl}>Open in Dashboard</Link>
            </Box>
          ) : null}
        </Box>
      ))}
      {!showAll && findings.length > 10 ? (
        <Box>
          <Button onPress={() => setShowAll(true)}>
            Show all {findings.length} findings
          </Button>
        </Box>
      ) : null}
      <Divider />
      <Box>
        {scannedAt ? `Scanned ${scannedAt.toLocaleTimeString()}. ` : ""}
        <Link href="https://entangleit.com/leak" external>
          Get continuous monitoring + email alerts
        </Link>
      </Box>
    </ContextView>
  );
}

export default FindingsDrawer;
