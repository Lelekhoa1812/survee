import { SettingsConsole } from "@/components/SettingsConsole";
import { mcpToken, publicBaseUrl } from "@/lib/env";
import { listApiKeys } from "@/lib/repo/keys";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let keys = null;
  let loadError = false;
  try {
    keys = await listApiKeys();
  } catch {
    loadError = true;
  }
  const origin = publicBaseUrl();
  return <SettingsConsole initialKeys={keys} loadError={loadError} envToken={mcpToken() !== null} origin={origin.ok ? origin.origin : null} />;
}
