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

export async function clearRpcSettings(db: FraudWatchDB): Promise<void> {
  await db.rpc_settings.delete("default");
}
