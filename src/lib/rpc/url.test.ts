import { describe, expect, it } from "vitest";
import { redactRpcUrl, validateRpcUrl } from "./url";

describe("validateRpcUrl", () => {
  it("accepts https endpoints, including ones carrying API keys", () => {
    expect(validateRpcUrl("https://api.mainnet-beta.solana.com").ok).toBe(true);
    expect(validateRpcUrl(" https://mainnet.helius-rpc.com/?api-key=secret ").ok).toBe(true);
  });

  it("allows plain http only for local nodes", () => {
    expect(validateRpcUrl("http://localhost:8899").ok).toBe(true);
    expect(validateRpcUrl("http://127.0.0.1:8899").ok).toBe(true);
    expect(validateRpcUrl("http://rpc.example.com").ok).toBe(false);
  });

  it("rejects other schemes, garbage, and userinfo credentials", () => {
    expect(validateRpcUrl("").ok).toBe(false);
    expect(validateRpcUrl("wss://rpc.example.com").ok).toBe(false);
    expect(validateRpcUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateRpcUrl("not a url").ok).toBe(false);
    expect(validateRpcUrl("https://user:pass@rpc.example.com").ok).toBe(false);
  });
});

describe("redactRpcUrl", () => {
  it("never reveals path, query, or fragment", () => {
    expect(redactRpcUrl("https://mainnet.helius-rpc.com/?api-key=secret")).toBe("https://mainnet.helius-rpc.com/…");
    expect(redactRpcUrl("https://x.quiknode.pro/abc123token/")).toBe("https://x.quiknode.pro/…");
    expect(redactRpcUrl("https://api.mainnet-beta.solana.com")).toBe("https://api.mainnet-beta.solana.com");
    expect(redactRpcUrl("garbage")).toBe("(invalid URL)");
  });
});
