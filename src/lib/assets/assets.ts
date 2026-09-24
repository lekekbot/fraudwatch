import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import type { SolanaRpcAdapter } from "@/lib/rpc/generic-adapter";
import { SOL_DECIMALS } from "@/lib/solana/amount";

/**
 * Assets are identified by mint address. Native SOL (lamports held by the
 * wallet account itself) has no mint, so it uses this reserved id; it can never
 * collide with a mint, which is always a 32-byte base58 address.
 */
export const NATIVE_SOL = "SOL";
export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const METAPLEX_METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export type AssetMetadata = {
  /** Mint address, or NATIVE_SOL. */
  id: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  /**
   * From the mint account: true when it has 0 decimals and a supply of exactly
   * 1 (standard, programmable, edition and Token-2022 NFTs); null when the mint
   * couldn't be read. Absent on records saved before NFT detection, which are refetched.
   */
  nft?: boolean | null;
  logo?: string;
  source: "builtin" | "token-2022" | "metaplex" | "none";
  fetchedAt?: string;
};

/** Well-known assets, so common tokens are readable before (or without) any metadata lookup. */
const BUILTIN: AssetMetadata[] = [
  { id: NATIVE_SOL, symbol: "SOL", name: "Solana", decimals: SOL_DECIMALS, nft: false, source: "builtin" },
  { id: WRAPPED_SOL_MINT, symbol: "wSOL", name: "Wrapped SOL", decimals: 9, nft: false, source: "builtin" },
  { id: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", decimals: 6, nft: false, source: "builtin" },
  { id: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "USDT", decimals: 6, nft: false, source: "builtin" },
  { id: "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH", symbol: "USDG", name: "Global Dollar", decimals: 6, nft: false, source: "builtin" },
];

const BUILTIN_BY_ID = new Map(BUILTIN.map((a) => [a.id, a]));

export function builtinAsset(id: string): AssetMetadata | undefined {
  return BUILTIN_BY_ID.get(id);
}

type ParsedMint = {
  data?: {
    parsed?: {
      type?: string;
      info?: {
        decimals?: number;
        supply?: string;
        extensions?: Array<{ extension: string; state?: { name?: string; symbol?: string } }>;
      };
    };
  };
};

/** Metaplex metadata account: key u8, update authority, mint, then borsh strings name, symbol, uri. */
export function decodeMetaplexMetadata(bytes: Uint8Array): { name: string; symbol: string } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 1 + 32 + 32;
  const readString = (): string | null => {
    if (offset + 4 > bytes.length) return null;
    const length = view.getUint32(offset, true);
    offset += 4;
    if (length > 200 || offset + length > bytes.length) return null;
    const value = new TextDecoder().decode(bytes.subarray(offset, offset + length));
    offset += length;
    // Metaplex pads names and symbols with NUL bytes to a fixed width.
    return value.replace(/\0+$/, "").trim();
  };
  const name = readString();
  const symbol = readString();
  return name === null || symbol === null ? null : { name, symbol };
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function metaplexMetadataAddress(mint: string): Promise<string> {
  const program = address(METAPLEX_METADATA_PROGRAM);
  const encoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: ["metadata", encoder.encode(program), encoder.encode(address(mint))],
  });
  return pda;
}

/**
 * Mints that might be NFTs: a token that moved exactly one unit with 0
 * decimals. Only these need the on-chain supply check.
 */
export function nftCandidates(tokenChanges: Iterable<{ mint: string; decimals: number; delta: string }>): Set<string> {
  const out = new Set<string>();
  for (const t of tokenChanges) if (t.decimals === 0 && (t.delta === "1" || t.delta === "-1")) out.add(t.mint);
  return out;
}

/**
 * Look up a mint's name and symbol on-chain, and whether it's an NFT: the Token-2022 metadata extension
 * first, then the Metaplex metadata account. Returns `source: "none"` when
 * neither exists; callers fall back to the shortened mint address.
 */
export async function fetchAssetMetadata(
  adapter: SolanaRpcAdapter,
  mint: string,
  signal: AbortSignal,
  now = new Date(),
): Promise<AssetMetadata> {
  const fetchedAt = now.toISOString();
  const account = (await adapter.getAccountInfo(mint, signal)) as ParsedMint | null;
  const info = account?.data?.parsed?.info;
  const decimals = typeof info?.decimals === "number" ? info.decimals : null;
  const nft = info ? decimals === 0 && info.supply === "1" : null;

  const embedded = info?.extensions?.find((e) => e.extension === "tokenMetadata")?.state;
  if (embedded?.symbol || embedded?.name) {
    return { id: mint, symbol: embedded.symbol || null, name: embedded.name || null, decimals, nft, source: "token-2022", fetchedAt };
  }

  const metadata = (await adapter.getAccountInfo(await metaplexMetadataAddress(mint), signal)) as {
    owner?: string;
    data?: unknown;
  } | null;
  if (metadata?.owner === METAPLEX_METADATA_PROGRAM && Array.isArray(metadata.data) && typeof metadata.data[0] === "string") {
    const decoded = decodeMetaplexMetadata(base64ToBytes(metadata.data[0]));
    if (decoded && (decoded.symbol || decoded.name)) {
      return { id: mint, symbol: decoded.symbol || null, name: decoded.name || null, decimals, nft, source: "metaplex", fetchedAt };
    }
  }
  return { id: mint, symbol: null, name: null, decimals, nft, source: "none", fetchedAt };
}
