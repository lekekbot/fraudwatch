/**
 * Write the small synthetic fixtures to disk.
 *
 * Usage: node scripts/fixtures/generate-synthetic.ts
 *
 * - loop-c-d-a:   manifest.json + rpc.json
 * - high-activity: manifest.json only (rpc.json is several MB; tests should
 *                  call generateHighActivity() directly).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as Generate from "../../fixtures/solana/synthetic/generate";

// Node needs the explicit `.ts` extension; the repo tsconfig forbids it in
// static imports, so load at runtime and keep the static types.
const { generateLoopCDA, generateHighActivity } = (await import(
  new URL("../../fixtures/solana/synthetic/generate.ts", import.meta.url).href
)) as typeof Generate;

const OUT = join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "fixtures", "solana");

function write(id: string, files: Record<string, unknown>) {
  const dir = join(OUT, id);
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(data, null, 2) + "\n");
  }
  console.log(`wrote ${dir}: ${Object.keys(files).join(", ")}`);
}

const loop = generateLoopCDA();
write(loop.manifest.id, { "manifest.json": loop.manifest, "rpc.json": loop.rpc });

const high = generateHighActivity();
write(high.manifest.id, { "manifest.json": high.manifest });
console.log(
  `high-activity: ${high.manifest.expected.transactionCount} in-range txs, ${high.rpc.length} recorded calls (not written)`,
);
