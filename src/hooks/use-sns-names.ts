"use client";

import { type Address } from "@solana/kit";
import { useEffect, useMemo, useState } from "react";
import { rpcCall } from "@/lib/rpc/json-rpc";
import { type AccountFetcher, primaryDomains } from "@/lib/solana/sns";

/** Looked-up names are reused for a week; owners rarely change their primary domain. */
const MAX_AGE_MS = 7 * 86_400_000;
const STORAGE_KEY = "fraudwatch:sns-names";

type Cached = Record<string, { name: string | null; at: number }>;

function readCache(): Cached {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Cached;
  } catch {
    return {};
  }
}

const accountsVia = (url: string, signal: AbortSignal): AccountFetcher => async (addresses: Address[]) => {
  const result = await rpcCall<{ value: ({ data: [string, string] } | null)[] }>(url, "getMultipleAccounts", [addresses, { encoding: "base64" }], signal);
  return result.value.map((account) => (account ? Uint8Array.from(atob(account.data[0]), (c) => c.charCodeAt(0)) : null));
};

/**
 * Primary .sol names for `addresses`, looked up on-chain through the user's RPC
 * in the background and cached in the browser. Addresses without one are
 * remembered too, so they aren't asked again.
 */
export function useSnsNames(addresses: readonly string[], rpcUrl: string | undefined): ReadonlyMap<string, string> {
  const key = [...addresses].sort().join(",");
  /** Bumped when a lookup lands, so the cached names are read again. */
  const [version, setVersion] = useState(0);
  const names = useMemo(() => {
    void version;
    const cache = readCache();
    return new Map(key ? key.split(",").flatMap((a) => (cache[a]?.name ? [[a, cache[a].name!] as [string, string]] : [])) : []);
  }, [key, version]);

  useEffect(() => {
    if (!key) return;
    const wanted = key.split(",");
    const cache = readCache();
    const fresh = (a: string) => cache[a] && Date.now() - cache[a].at < MAX_AGE_MS;
    const missing = wanted.filter((a) => !fresh(a));
    if (!rpcUrl || missing.length === 0) return;
    const controller = new AbortController();
    primaryDomains(missing, accountsVia(rpcUrl, controller.signal))
      .then((found) => {
        const now = Date.now();
        for (const a of missing) cache[a] = { name: found.get(a) ?? null, at: now };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
        } catch {
          // Storage full or unavailable: the names still show for this session.
        }
        setVersion((v) => v + 1);
      })
      .catch(() => {
        // Names are a nicety: a failed lookup leaves the addresses as they are.
      });
    return () => controller.abort();
  }, [key, rpcUrl]);

  return names;
}
