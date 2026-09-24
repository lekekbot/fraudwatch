"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { type FraudWatchDB, getDb } from "@/lib/db/db";

export type LocalQuery<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

/**
 * Reactive IndexedDB query. Never runs during static prerender, and turns
 * "IndexedDB unavailable" (e.g. some private-browsing modes) into a visible
 * error instead of a crash.
 */
export function useLocalQuery<T>(query: (db: FraudWatchDB) => Promise<T>, deps: unknown[]): LocalQuery<T> {
  const result = useLiveQuery(
    async (): Promise<LocalQuery<T>> => {
      try {
        return { status: "ready", data: await query(getDb()) };
      } catch (err) {
        return { status: "error", error: err instanceof Error ? err.message : "Local storage error." };
      }
    },
    deps,
  );
  return result ?? { status: "loading" };
}
