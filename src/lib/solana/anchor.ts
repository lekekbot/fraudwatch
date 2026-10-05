import { getAddressDecoder, getBase58Encoder } from "@solana/kit";

/** Instruction data (base58, as jsonParsed reports unparsed instructions) as bytes. */
export const bytesOf = (data: string | null): Uint8Array | null => {
  if (!data) return null;
  try {
    return Uint8Array.from(getBase58Encoder().encode(data));
  } catch {
    return null;
  }
};

/** An Anchor instruction's discriminator, the first 8 bytes of sha256("global:<name>"), as "b0,b1,…". */
export const discriminator = (bytes: Uint8Array | null): string | null => (bytes && bytes.length >= 8 ? Array.from(bytes.subarray(0, 8)).join(",") : null);

/** A little-endian reader over instruction data; every read returns null past the end. */
export function reader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fits = (offset: number, size: number) => offset >= 0 && offset + size <= bytes.length;
  return {
    u32: (offset: number, littleEndian = true) => (fits(offset, 4) ? view.getUint32(offset, littleEndian) : null),
    u64: (offset: number, littleEndian = true) => (fits(offset, 8) ? view.getBigUint64(offset, littleEndian) : null),
    slice: (offset: number, size: number) => (fits(offset, size) ? bytes.subarray(offset, offset + size) : null),
    address: (offset: number) => (fits(offset, 32) ? getAddressDecoder().decode(bytes.subarray(offset, offset + 32)) : null),
  };
}

export const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
