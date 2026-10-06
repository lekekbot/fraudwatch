import { describe, expect, it } from "vitest";
import type { RpcSettings } from "@/lib/rpc/settings";
import type { FraudWatchDB } from "./db";
import { getRpcSettings, recordRpcResult } from "./rpc-settings";

function stubDb(initial?: RpcSettings) {
  let row = initial;
  return { rpc_settings: { get: async () => row, put: async (next: RpcSettings) => void (row = next) } } as unknown as FraudWatchDB;
}
const settings = (url: string): RpcSettings => ({ id: "default", url, updatedAt: "2026-10-01T00:00:00.000Z" });

describe("RPC status from real use", () => {
  it("marks the endpoint working after a load, and failed after a failed one", async () => {
    const db = stubDb(settings("https://rpc.example.com"));
    await recordRpcResult(db, "https://rpc.example.com", true, new Date("2026-10-06T10:00:00Z"));
    expect((await getRpcSettings(db))?.lastTest).toEqual({ ok: true, at: "2026-10-06T10:00:00.000Z", source: "load" });
    await recordRpcResult(db, "https://rpc.example.com", false, new Date("2026-10-06T11:00:00Z"));
    expect((await getRpcSettings(db))?.lastTest).toMatchObject({ ok: false, source: "load" });
  });

  it("ignores a load against an endpoint that has since been changed, or with none configured", async () => {
    const db = stubDb(settings("https://new.example.com"));
    await recordRpcResult(db, "https://old.example.com", true);
    expect((await getRpcSettings(db))?.lastTest).toBeUndefined();
    const empty = stubDb();
    await recordRpcResult(empty, "https://rpc.example.com", true);
    expect(await getRpcSettings(empty)).toBeUndefined();
  });
});
