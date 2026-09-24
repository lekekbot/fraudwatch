import { describe, expect, it } from "vitest";
import { SIGNATURE_PAGE_LIMIT, type SignatureInfo } from "@/lib/rpc/generic-adapter";
import { findActivitySpan } from "./activity-span";

/** A fake history of `count` signatures, newest first, one per minute, the oldest `untimed` without block time. */
function history(count: number, untimed = 0) {
  const sigs: SignatureInfo[] = Array.from({ length: count }, (_, i) => ({
    signature: `s${i}`,
    slot: count - i,
    blockTime: i >= count - untimed ? null : 1_750_000_000 - i * 60,
    err: null,
  }));
  const calls: Array<string | undefined> = [];
  const adapter = {
    async getSignaturesForAddress(_: string, { before }: { before?: string }) {
      calls.push(before);
      const start = before ? sigs.findIndex((s) => s.signature === before) + 1 : 0;
      return sigs.slice(start, start + SIGNATURE_PAGE_LIMIT);
    },
  };
  return { sigs, calls, adapter };
}

const signal = new AbortController().signal;
const iso = (blockTime: number) => new Date(blockTime * 1000).toISOString();

describe("findActivitySpan", () => {
  it("gets the newest transaction in one call when the start isn't needed", async () => {
    const { adapter, calls } = history(2500);
    const span = await findActivitySpan(adapter, "W", { needFirst: false, signal });
    expect(span).toMatchObject({ first: null, last: iso(1_750_000_000), truncated: false });
    expect(calls).toHaveLength(1);
  });

  it("pages back to the oldest transaction, skipping ones without a block time", async () => {
    const { adapter, calls, sigs } = history(2500, 2);
    const progress: number[] = [];
    const span = await findActivitySpan(adapter, "W", { needFirst: true, signal, onProgress: (n) => progress.push(n) });
    expect(span.first).toBe(iso(sigs[2497].blockTime!));
    expect(span.signaturesScanned).toBe(2500);
    expect(calls).toHaveLength(3);
    expect(progress).toEqual([1000, 2000]);
  });

  it("handles a history that ends exactly on a page boundary", async () => {
    const { adapter, sigs } = history(2000);
    const span = await findActivitySpan(adapter, "W", { needFirst: true, signal });
    expect(span.first).toBe(iso(sigs[1999].blockTime!));
  });

  it("stops at the safety limit instead of guessing a start", async () => {
    const { adapter } = history(5000);
    const span = await findActivitySpan(adapter, "W", { needFirst: true, signal, maxSignatures: 2000 });
    expect(span).toMatchObject({ first: null, truncated: true, signaturesScanned: 2000 });
  });

  it("reports nothing for a wallet with no transactions", async () => {
    const { adapter } = history(0);
    expect(await findActivitySpan(adapter, "W", { needFirst: true, signal })).toMatchObject({ first: null, last: null });
  });
});
