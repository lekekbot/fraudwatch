export type RpcUrlValidation = { ok: true; url: URL } | { ok: false; error: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * RPC URLs frequently embed API keys (path segments or `?api-key=`), so the
 * full URL is treated as a secret: plain http is only allowed for local nodes.
 */
export function validateRpcUrl(input: string): RpcUrlValidation {
  const value = input.trim();
  if (!value) return { ok: false, error: "Enter an RPC URL." };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Not a valid URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "RPC URL must use https:// (or http:// for a local node)." };
  }
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    return { ok: false, error: "Use https:// — plain http would expose your RPC key in transit." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Credentials in the URL's user:password section are not supported." };
  }
  return { ok: true, url };
}

/** Safe-to-display form of an RPC URL: origin only, no path, query, or fragment. */
export function redactRpcUrl(input: string): string {
  try {
    const url = new URL(input);
    const hasSecretBearingParts = url.pathname !== "/" || url.search !== "" || url.hash !== "";
    return hasSecretBearingParts ? `${url.origin}/…` : url.origin;
  } catch {
    return "(invalid URL)";
  }
}
