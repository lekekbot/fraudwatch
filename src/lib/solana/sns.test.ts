import { type Address, getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { primaryDomains } from "./sns";

const enc = getAddressEncoder();
const SOL_TLD = "58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx" as Address;
const WALLET = "Fw1ETanDZafof7xEULsnq9UY6o71Tpds89tNwPkWLb1v";
const OTHER = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY";
const NAME_ACCOUNT = "AgJujvNQgYESUwBPitq2VUrfTaT2bvueHbgvsxqZ2sHg" as Address;

const bytes = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const favourite = bytes(new Uint8Array([1]), new Uint8Array(enc.encode(NAME_ACCOUNT)));
const nameAccount = (owner: string) => bytes(new Uint8Array(enc.encode(SOL_TLD)), new Uint8Array(enc.encode(owner as Address)), new Uint8Array(32));
const reverse = (name: string) => {
  const text = new TextEncoder().encode(name);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, text.length, true);
  return bytes(new Uint8Array(96), length, text);
};

/** Answers the lookup's three rounds in order: favourites, name accounts, reverse records. */
const rounds = (...answers: (Uint8Array | null)[][]) => {
  let call = 0;
  return async () => answers[call++] ?? [];
};

describe("primaryDomains", () => {
  it("reads a wallet's primary .sol name, skipping wallets without one", async () => {
    const out = await primaryDomains([WALLET, OTHER], rounds([favourite, null], [nameAccount(WALLET)], [reverse("couponvault")]));
    expect([...out]).toEqual([[WALLET, "couponvault.sol"]]);
  });

  it("ignores a favourite the wallet no longer owns", async () => {
    const out = await primaryDomains([WALLET], rounds([favourite], [nameAccount(OTHER)], [reverse("couponvault")]));
    expect(out.size).toBe(0);
  });
});
