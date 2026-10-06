/**
 * Records mainnet transactions as test fixtures (the raw `getTransaction`
 * jsonParsed response, which `canonicalize` reads).
 *
 *   # Specific transactions
 *   node scripts/capture-fixture.ts --rpc <url> --out fixtures/solana/defi --signature <sig> [--signature <sig> …]
 *
 *   # Search a program's recent transactions for Anchor instructions by name (as they appear in the
 *   # program's logs, e.g. "Instruction: Route"), keeping up to --count of each
 *   node scripts/capture-fixture.ts --rpc <url> --out fixtures/solana/defi \
 *     --program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 --instruction Route --instruction SharedAccountsRoute \
 *     [--count 1] [--scan 300]
 *
 * The RPC URL can also come from FRAUDWATCH_RPC_URL. Public RPCs rate-limit hard: every failed fetch is
 * logged, never skipped silently, and a summary says what's missing. Each file is named after the
 * instruction (or signature); its signature and capture date go to stdout for the test that uses it.
 * Fixtures are public chain data: never capture from a case you're investigating without meaning to publish it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Args = { rpc: string; out: string; signatures: string[]; program?: string; instructions: string[]; count: number; scan: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { rpc: process.env.FRAUDWATCH_RPC_URL ?? "", out: "", signatures: [], instructions: [], count: 1, scan: 300 };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    switch (argv[i]) {
      case "--rpc":
        args.rpc = value;
        i++;
        break;
      case "--out":
        args.out = value;
        i++;
        break;
      case "--signature":
        args.signatures.push(value);
        i++;
        break;
      case "--program":
        args.program = value;
        i++;
        break;
      case "--instruction":
        args.instructions.push(value);
        i++;
        break;
      case "--count":
        args.count = Number(value);
        i++;
        break;
      case "--scan":
        args.scan = Number(value);
        i++;
        break;
      default:
        throw new Error(`Unknown argument ${argv[i]}`);
    }
  }
  if (!args.rpc) throw new Error("Give an RPC URL with --rpc or FRAUDWATCH_RPC_URL.");
  if (!args.out) throw new Error("Give an output directory with --out.");
  if (args.signatures.length === 0 && !(args.program && args.instructions.length > 0)) throw new Error("Give --signature, or --program with at least one --instruction.");
  return args;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;

/** One JSON-RPC call, retried with backoff; null after the last retry, with the failure logged. */
async function call<T>(rpc: string, method: string, params: unknown[]): Promise<T | null> {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { result?: T; error?: { message: string } };
      if (body.error) throw new Error(body.error.message);
      return body.result ?? null;
    } catch (error) {
      console.warn(`  ${method} failed (attempt ${attempt}/5): ${error instanceof Error ? error.message : error}`);
      await sleep(2000 * attempt);
    }
  }
  failures++;
  console.error(`  gave up on ${method} ${JSON.stringify(params[0])}`);
  return null;
}

type Tx = { transaction: { signatures: string[] }; meta: { err: unknown; logMessages?: string[] } };
const getTransaction = (rpc: string, signature: string) => call<Tx>(rpc, "getTransaction", [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);

/** Anchor instruction names logged directly under the program's own top-level calls. */
function instructionsOf(tx: Tx, program: string): string[] {
  const stack: string[] = [];
  const names: string[] = [];
  for (const line of tx.meta.logMessages ?? []) {
    const invoke = /^Program (\S+) invoke \[/.exec(line);
    if (invoke) stack.push(invoke[1]);
    else if (/^Program \S+ (success|failed)/.test(line)) stack.pop();
    else if (line.startsWith("Program log: Instruction: ") && stack.at(-1) === program) names.push(line.slice("Program log: Instruction: ".length));
  }
  return names;
}

function save(out: string, name: string, tx: Tx) {
  const file = join(out, `${name}.json`);
  writeFileSync(file, JSON.stringify(tx));
  console.log(`saved ${file}  signature ${tx.transaction.signatures[0]}  captured ${new Date().toISOString().slice(0, 10)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.out, { recursive: true });

  for (const signature of args.signatures) {
    const tx = await getTransaction(args.rpc, signature);
    if (tx) save(args.out, signature.slice(0, 12), tx);
  }

  if (args.program) {
    const found = new Map(args.instructions.map((name) => [name, 0]));
    let before: string | undefined;
    let scanned = 0;
    while (scanned < args.scan && [...found.values()].some((n) => n < args.count)) {
      const page = await call<{ signature: string; err: unknown }[]>(args.rpc, "getSignaturesForAddress", [args.program, { limit: 100, ...(before ? { before } : {}) }]);
      if (!page || page.length === 0) break;
      before = page[page.length - 1].signature;
      for (const { signature, err } of page) {
        if (err || scanned >= args.scan) continue;
        scanned++;
        const tx = await getTransaction(args.rpc, signature);
        await sleep(300);
        if (!tx) continue;
        for (const name of instructionsOf(tx, args.program)) {
          const n = found.get(name);
          if (n === undefined || n >= args.count) continue;
          found.set(name, n + 1);
          save(args.out, args.count === 1 ? name : `${name}-${n + 1}`, tx);
        }
      }
    }
    console.log(`scanned ${scanned} transactions`);
    for (const [name, n] of found) if (n < args.count) console.log(`missing: ${name} (${n}/${args.count})`);
  }
  if (failures > 0) console.log(`${failures} fetch(es) failed after retries: results may be incomplete`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
