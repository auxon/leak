import { Badge, Box, Button, Divider, Link, Spinner } from "@stripe/ui-extension-sdk/ui";
import type { ExtensionContextValue } from "@stripe/ui-extension-sdk/context";
import { summarize } from "../scan";
import { useLeakFindings, useLeakStripe } from "../hooks";

/** Dashboard homepage card: account health at a glance. */
export function HealthOverview({ environment }: ExtensionContextValue) {
  const stripe = useLeakStripe();
  const live = environment.mode !== "test";
  const { findings, loading, error, scannedAt, rescan } = useLeakFindings(stripe, live);
  const { critical, warnings, healthy } = summarize(findings);

  return (
    <Box>
      <Box>Leak — billing health</Box>
      {loading ? (
        <Box>
          <Spinner />
        </Box>
      ) : error ? (
        <Box>
          {error} <Button onPress={rescan}>Retry</Button>
        </Box>
      ) : healthy ? (
        <Box>
          <Badge type="positive">Healthy</Badge> No webhook, delivery, or
          past-due issues found{live ? "" : " (test mode)"}.
        </Box>
      ) : (
        <Box>
          <Badge type={critical > 0 ? "negative" : "warning"}>
            {critical > 0 ? `${critical} critical` : `${warnings} warnings`}
          </Badge>{" "}
          {critical > 0
            ? "billing leaks need attention."
            : "worth a look before they cost you."}
        </Box>
      )}
      <Divider />
      <Box>
        <Button onPress={rescan} disabled={loading}>
          Rescan
        </Button>{" "}
        <Link
          href="https://entangleit.com/leak"
          external
        >
          Continuous monitoring
        </Link>
      </Box>
      {scannedAt ? (
        <Box>Last scan {scannedAt.toLocaleTimeString()}.</Box>
      ) : null}
    </Box>
  );
}

export default HealthOverview;
