import Dexie, { type EntityTable } from "dexie";
import type { FraudWatchCase } from "@/lib/case/model";
import type { RpcSettings } from "@/lib/rpc/settings";

export const DB_NAME = "fraudwatch";

/**
 * Local-only persistence. Sprint 01 owns `cases` and `rpc_settings`;
 * Sprint 03 adds the transaction/cache stores via a new `version()` block.
 */
export class FraudWatchDB extends Dexie {
  cases!: EntityTable<FraudWatchCase, "id">;
  rpc_settings!: EntityTable<RpcSettings, "id">;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      cases: "id, updatedAt, primaryWallet",
      rpc_settings: "id",
    });
  }
}

let instance: FraudWatchDB | null = null;

export function getDb(): FraudWatchDB {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available in this environment.");
  }
  instance ??= new FraudWatchDB();
  return instance;
}
