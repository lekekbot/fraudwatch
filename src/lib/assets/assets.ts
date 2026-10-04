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
  { id: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", symbol: "PUMP", name: "Pump", decimals: 6, nft: false, source: "builtin" },
  { id: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter", decimals: 6, nft: false, source: "builtin" },
  { id: "BPxxfRCXkUVhig4HS1Lh7kZqV6SPJhzfEk4x6fVBjPCy", symbol: "BP", name: "Backpack", decimals: 9, nft: false, source: "builtin" },
  { id: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", symbol: "RAY", name: "Raydium", decimals: 6, nft: false, source: "builtin" },
  { id: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof", symbol: "RENDER", name: "Render Token", decimals: 8, nft: false, source: "builtin" },
  { id: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4", symbol: "JLP", name: "Jupiter Perps LP", decimals: 6, nft: false, source: "builtin" },
  { id: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", symbol: "PYTH", name: "Pyth Network", decimals: 6, nft: false, source: "builtin" },
  { id: "Grass7B4RdKfBCjTKgSqnXkqjwiGvQyFbuSCUJr3XXjs", symbol: "GRASS", name: "Grass", decimals: 9, nft: false, source: "builtin" },
  { id: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", symbol: "JTO", name: "JITO", decimals: 9, nft: false, source: "builtin" },
  { id: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", symbol: "JitoSOL", name: "Jito Staked SOL", decimals: 9, nft: false, source: "builtin" },
  { id: "BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85", symbol: "BNSOL", name: "Binance Staked SOL", decimals: 9, nft: false, source: "builtin" },
  { id: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", symbol: "JupSOL", name: "Jupiter Staked SOL", decimals: 9, nft: false, source: "builtin" },
  { id: "Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ", symbol: "dSOL", name: "Drift Staked SOL", decimals: 9, nft: false, source: "builtin" },
  { id: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", symbol: "mSOL", name: "Marinade staked SOL", decimals: 9, nft: false, source: "builtin" },
  { id: "5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm", symbol: "INF", name: "Infinity", decimals: 9, nft: false, source: "builtin" },
  { id: "pSo1f9nQXWgXibFtKf7NWYxb5enAM4qfP6UJSiXRQfL", symbol: "PSOL", name: "Phantom Staked SOL", decimals: 9, nft: false, source: "builtin" },
  { id: "Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B", symbol: "bbSOL", name: "BybitSOL", decimals: 9, nft: false, source: "builtin" },
  { id: "vSoLxydx6akxyMD9XEcPvGYNGq6Nn66oqVb3UkGkei7", symbol: "vSOL", name: "vSOL", decimals: 9, nft: false, source: "builtin" },
  { id: "7Q2afV64in6N6SeZsAAB81TJzwDoD6zpqmHkzi9Dcavn", symbol: "JSOL", name: "JPool Staked SOL", decimals: 9, nft: false, source: "builtin" },
  { id: "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB", symbol: "USD1", name: "World Liberty Financial USD", decimals: 6, nft: false, source: "builtin" },
  { id: "72puLt71H93Z9CzHuBRTwFpL4TG3WZUhnoCC7p8gxigu", symbol: "USDGO", name: "USDGO", decimals: 6, nft: false, source: "builtin" },
  { id: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", symbol: "PYUSD", name: "PayPal USD", decimals: 6, nft: false, source: "builtin" },
  { id: "DEkqHyPN7GMRJ5cArtQFAWefqbZb33Hyf6s5iCwjEonT", symbol: "USDe", name: "USDe", decimals: 9, nft: false, source: "builtin" },
  { id: "6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG", symbol: "USX", name: "USX", decimals: 6, nft: false, source: "builtin" },
  { id: "3b8X44fLF9ooXaUm3hhSgjpmVs6rZZ3pPoGnGahc3Uu7", symbol: "PRIME", name: "Hastra PRIME", decimals: 6, nft: false, source: "builtin" },
  { id: "CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH", symbol: "CASH", name: "CASH", decimals: 6, nft: false, source: "builtin" },
  { id: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", symbol: "TRUMP", name: "OFFICIAL TRUMP", decimals: 6, nft: false, source: "builtin" },
  { id: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", symbol: "PENGU", name: "Pudgy Penguins", decimals: 6, nft: false, source: "builtin" },
  { id: "BCNT4t3rv5Hva8RnUtJUJLnxzeFAabcYp8CghC1SmWin", symbol: "BC", name: "BCGame Coin", decimals: 6, nft: false, source: "builtin" },
  { id: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "Bonk", name: "Bonk", decimals: 5, nft: false, source: "builtin" },
  { id: "DrZ26cKJDksVRWib3DVVsjo9eeXccc7hKhDJviiYEEZY", symbol: "YZY", name: "YZY", decimals: 6, nft: false, source: "builtin" },
  { id: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", symbol: "$WIF", name: "dogwifhat", decimals: 6, nft: false, source: "builtin" },
  { id: "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk", symbol: "USELESS", name: "USELESS COIN", decimals: 6, nft: false, source: "builtin" },
  { id: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump", symbol: "Fartcoin", name: "Fartcoin", decimals: 6, nft: false, source: "builtin" },
  { id: "EE5L8cMU4itTsCSuor7NLK6RZx6JhsBe8GGV3oaAHm3P", symbol: "AVDO", name: "AvocadoCoin", decimals: 8, nft: false, source: "builtin" },
  { id: "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump", symbol: "ANSEM", name: "The Black Bull", decimals: 6, nft: false, source: "builtin" },
  { id: "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5", symbol: "ONyc", name: "OnRe Tokenized Reinsurance", decimals: 9, nft: false, source: "builtin" },
  { id: "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL", symbol: "NFLXx", name: "Netflix xStock", decimals: 8, nft: false, source: "builtin" },
  { id: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", symbol: "SPCXx", name: "SpaceX xStock", decimals: 8, nft: false, source: "builtin" },
  { id: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", symbol: "TSLAx", name: "Tesla xStock", decimals: 8, nft: false, source: "builtin" },
  { id: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", symbol: "MSTRx", name: "MicroStrategy xStock", decimals: 8, nft: false, source: "builtin" },
  { id: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", symbol: "NVDAx", name: "NVIDIA xStock", decimals: 8, nft: false, source: "builtin" },
  { id: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", symbol: "SPYx", name: "SP500 xStock", decimals: 8, nft: false, source: "builtin" },
  { id: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", symbol: "CRCLx", name: "Circle xStock", decimals: 8, nft: false, source: "builtin" },
  { id: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg", symbol: "HOODx", name: "Robinhood xStock", decimals: 8, nft: false, source: "builtin" },
  { id: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", symbol: "QQQx", name: "Nasdaq xStock", decimals: 8, nft: false, source: "builtin" },
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
