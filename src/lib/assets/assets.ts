import { address, getAddressDecoder, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
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
  /** Metaplex creators with a royalty share: who a secondary sale's royalty goes to. Absent until read. */
  royaltyRecipients?: string[];
  /** Royalty in basis points (500 = 5%), from Metaplex metadata. */
  royaltyBps?: number;
  logo?: string;
  /** bubblegum: a compressed NFT named from its mint instruction; das: named by the RPC's getAsset. */
  source: "builtin" | "token-2022" | "metaplex" | "bubblegum" | "das" | "none";
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

export type MetaplexMetadata = {
  name: string;
  symbol: string;
  /** Present when the account is long enough to hold them. */
  royaltyBps?: number;
  creators?: { address: string; verified: boolean; share: number }[];
};

/**
 * Metaplex metadata account: key u8, update authority, mint, borsh strings
 * name, symbol, uri, then seller_fee_basis_points u16 and Option<Vec<Creator>>
 * (address, verified u8, share u8).
 */
export function decodeMetaplexMetadata(bytes: Uint8Array): MetaplexMetadata | null {
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
  if (name === null || symbol === null) return null;
  const uri = readString();
  if (uri === null || offset + 3 > bytes.length) return { name, symbol };
  const royaltyBps = view.getUint16(offset, true);
  offset += 2;
  const hasCreators = bytes[offset++] === 1;
  if (!hasCreators) return { name, symbol, royaltyBps, creators: [] };
  if (offset + 4 > bytes.length) return { name, symbol, royaltyBps };
  const count = view.getUint32(offset, true);
  offset += 4;
  if (count > 5 || offset + count * 34 > bytes.length) return { name, symbol, royaltyBps };
  const decoder = getAddressDecoder();
  const creators = [];
  for (let i = 0; i < count; i++) {
    creators.push({ address: decoder.decode(bytes.subarray(offset, offset + 32)), verified: bytes[offset + 32] === 1, share: bytes[offset + 33] });
    offset += 34;
  }
  return { name, symbol, royaltyBps, creators };
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
      const royalty =
        decoded.creators === undefined
          ? {}
          : { royaltyBps: decoded.royaltyBps, royaltyRecipients: decoded.creators.filter((c) => c.share > 0).map((c) => c.address) };
      return { id: mint, symbol: decoded.symbol || null, name: decoded.name || null, decimals, nft, ...royalty, source: "metaplex", fetchedAt };
    }
  }
  return { id: mint, symbol: null, name: null, decimals, nft, source: "none", fetchedAt };
}

/**
 * Names a compressed NFT: from its mint instruction when a loaded transaction
 * minted it, otherwise through the RPC's DAS `getAsset` where supported.
 * Compressed NFTs are NFTs by construction.
 */
export async function fetchCompressedAssetMetadata(
  adapter: Pick<SolanaRpcAdapter, "getAsset">,
  assetId: string,
  mintedName: string | undefined,
  signal: AbortSignal,
  now = new Date(),
): Promise<AssetMetadata> {
  const base = { id: assetId, decimals: 0, nft: true, fetchedAt: now.toISOString() };
  if (mintedName) return { ...base, name: mintedName, symbol: null, source: "bubblegum" };
  const asset = await adapter.getAsset(assetId, signal);
  if (asset && (asset.name || asset.symbol)) return { ...base, name: asset.name, symbol: asset.symbol, source: "das" };
  return { ...base, name: null, symbol: null, source: "none" };
}
