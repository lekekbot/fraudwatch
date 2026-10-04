import { type Address, address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";

/**
 * Primary .sol names (Solana Name Service) for wallets, read on-chain. A
 * wallet's primary name is the domain it marked as favourite; it only counts
 * while the wallet still owns that domain. Names are chosen by their owners,
 * so they're claims, not verified identities.
 */

const NAME_PROGRAM = address("namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX");
/** Holds each wallet's favourite (primary) domain. */
const NAME_OFFERS_PROGRAM = address("85iDfUvr3HJyLM2zcq5BXSiDvUWfw6cSE1FfNBo8Ap29");
const REVERSE_LOOKUP_CLASS = address("33m47vH6Eav6jr5Ry86XjhRft2jRBLDnDgPSHoquXi2Z");
/** The .sol top-level domain. */
const SOL_TLD = address("58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx");
const HASH_PREFIX = "SPL Name Service";
/** A name account starts with parent, owner and class, 32 bytes each. */
const HEADER = 96;

const encoder = getAddressEncoder();
const decoder = getAddressDecoder();

/** Raw account data for each address, in order; null for an account that doesn't exist. */
export type AccountFetcher = (addresses: Address[]) => Promise<(Uint8Array | null)[]>;

async function favouriteKey(owner: Address): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({ programAddress: NAME_OFFERS_PROGRAM, seeds: ["favourite_domain", encoder.encode(owner)] });
  return pda;
}

/** Where a domain's reverse record (its readable name) lives. */
async function reverseKey(nameAccount: Address): Promise<Address> {
  const hashed = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(HASH_PREFIX + nameAccount)));
  const [pda] = await getProgramDerivedAddress({
    programAddress: NAME_PROGRAM,
    seeds: [hashed, encoder.encode(REVERSE_LOOKUP_CLASS), new Uint8Array(32)],
  });
  return pda;
}

const readAddress = (data: Uint8Array, offset: number) => decoder.decode(data.subarray(offset, offset + 32));

/** The readable name in a reverse record: a u32 length, then the name. */
function reverseName(data: Uint8Array): string | null {
  if (data.length < HEADER + 4) return null;
  const length = new DataView(data.buffer, data.byteOffset + HEADER, 4).getUint32(0, true);
  if (length === 0 || HEADER + 4 + length > data.length) return null;
  // Sub-domain records carry a leading NUL; the name itself is what follows.
  const name = new TextDecoder().decode(data.subarray(HEADER + 4, HEADER + 4 + length)).replace(/^\0+/, "");
  return name || null;
}

/** In chunks, so a big case stays within one RPC call per hundred addresses per step. */
async function fetchAll(fetch: AccountFetcher, keys: Address[]): Promise<(Uint8Array | null)[]> {
  const out: (Uint8Array | null)[] = [];
  for (let i = 0; i < keys.length; i += 100) out.push(...(await fetch(keys.slice(i, i + 100))));
  return out;
}

/**
 * Primary .sol names for `wallets`, e.g. `kai.sol`. Wallets without a
 * primary name, or whose favourite domain they no longer own, are left out.
 */
export async function primaryDomains(wallets: readonly string[], fetch: AccountFetcher): Promise<Map<string, string>> {
  const owners = wallets.map((w) => address(w));
  const favourites = await fetchAll(fetch, await Promise.all(owners.map(favouriteKey)));
  // A favourite record is a tag byte, then the domain's name account.
  const chosen = owners.flatMap((owner, i) => {
    const data = favourites[i];
    return data && data.length >= 33 ? [{ owner, nameAccount: readAddress(data, 1) }] : [];
  });
  if (chosen.length === 0) return new Map();
  const names = await fetchAll(fetch, chosen.map((c) => c.nameAccount));
  const reverses = await fetchAll(fetch, await Promise.all(chosen.map((c) => reverseKey(c.nameAccount))));
  const out = new Map<string, string>();
  chosen.forEach(({ owner }, i) => {
    const name = names[i];
    const reverse = reverses[i];
    // Still owned by this wallet, and a .sol domain: a stale favourite after a sale doesn't count.
    if (!name || !reverse || name.length < HEADER || readAddress(name, 32) !== owner || readAddress(name, 0) !== SOL_TLD) return;
    const text = reverseName(reverse);
    if (text) out.set(owner, `${text}.sol`);
  });
  return out;
}
