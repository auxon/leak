import { Box, Link, SettingsView } from "@stripe/ui-extension-sdk/ui";

/** App settings page: docs, support, and the Pro upgrade path. */
export function AppSettings() {
  return (
    <SettingsView>
      <Box>
        Leak scans your webhooks, event deliveries, subscriptions, and
        invoices for revenue leaks — read-only, right inside the Dashboard.
      </Box>
      <Box>
        <Link href="https://entangleit.com/leak" external>
          Continuous monitoring + email alerts (Leak Pro)
        </Link>
      </Box>
      <Box>
        <Link href="https://entangleit.com/leak" external>
          Pricing
        </Link>
      </Box>
      <Box>
        Support: reply to any Leak email — responses within one business day.
      </Box>
    </SettingsView>
  );
}

export default AppSettings;
