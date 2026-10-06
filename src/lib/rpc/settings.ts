export type RpcSettings = {
  id: "default";
  url: string;
  lastTest?: {
    ok: boolean;
    at: string;
    latencyMs?: number;
    solanaCore?: string;
    /** test: the "Test connection" button. load: a transaction load that just used the endpoint. */
    source?: "test" | "load";
  };
  updatedAt: string;
};
