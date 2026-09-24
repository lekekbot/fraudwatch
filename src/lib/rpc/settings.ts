export type RpcProviderType = "auto" | "generic" | "enhanced";

export const RPC_PROVIDER_TYPES: RpcProviderType[] = ["auto", "generic", "enhanced"];

export type RpcSettings = {
  id: "default";
  url: string;
  providerType: RpcProviderType;
  lastTest?: {
    ok: boolean;
    at: string;
    latencyMs?: number;
    solanaCore?: string;
  };
  updatedAt: string;
};
