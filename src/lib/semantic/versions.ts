import { BEHAVIOR_VERSION } from "@/lib/behavior/observations";
import { registry } from "@/lib/protocols/registry";
import { PARSER_VERSION } from "@/lib/solana/canonical";
import { RECONSTRUCTION_VERSION } from "@/lib/state/reconstruct";
import { SEMANTIC_VERSION } from "./events";
import { INTERPRETERS } from "./interpreters";

/**
 * Every version that decides what FraudWatch derives from a transaction, in
 * one place. Parser and reconstruction outputs are cached in IndexedDB and
 * cleared when their version changes (see `DERIVED_CACHES`); semantic events
 * and behaviour observations are computed on read from those, so a change to
 * any version below takes effect the next time a case opens.
 */
export function analysisVersions() {
  return {
    parser: PARSER_VERSION,
    reconstruction: RECONSTRUCTION_VERSION,
    semantic: SEMANTIC_VERSION,
    interpreters: Object.fromEntries(INTERPRETERS.map((i) => [i.id, i.version])),
    registry: registry.version,
    behavior: BEHAVIOR_VERSION,
  };
}

/** The versions as one string, e.g. for a debug bundle or a future cache key. */
export const analysisFingerprint = () => {
  const v = analysisVersions();
  return [`p${v.parser}`, `r${v.reconstruction}`, `s${v.semantic}`, ...Object.entries(v.interpreters).map(([id, n]) => `${id}@${n}`), `reg${v.registry}`, `b${v.behavior}`].join(";");
};
