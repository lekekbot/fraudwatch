export type RpcSettings = {
  id: "default";
  url: string;
  lastTest?: {
    ok: boolean;
    at: string;
    latencyMs?: number;
    solanaCore?: string;
  };
  updatedAt: string;
};
