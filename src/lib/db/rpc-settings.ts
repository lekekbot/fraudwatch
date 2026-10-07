import type { RpcSettings } from "@/lib/rpc/settings";
import type { FraudWatchDB } from "./db";

export async function getRpcSettings(db: FraudWatchDB): Promise<RpcSettings | undefined> {
  return db.rpc_settings.get("default");
}

export async function saveRpcSettings(
  db: FraudWatchDB,
  input: { url: string; lastTest?: RpcSettings["lastTest"] },
  now = new Date(),
): Promise<RpcSettings> {
  const settings: RpcSettings = {
    id: "default",
    url: input.url.trim(),
    lastTest: input.lastTest,
    updatedAt: now.toISOString(),
  };
  await db.rpc_settings.put(settings);
  return settings;
}

/**
 * Records how the endpoint behaved in real use (a transaction load), so the
 * status reflects more than the last manual test. Ignored when the endpoint has
 * changed since the load started.
 */
export async function recordRpcResult(db: FraudWatchDB, url: string, ok: boolean, now = new Date()): Promise<void> {
  const current = await getRpcSettings(db);
  if (!current || current.url !== url.trim()) return;
  await db.rpc_settings.put({ ...current, lastTest: { ok, at: now.toISOString(), source: "load" } });
}
