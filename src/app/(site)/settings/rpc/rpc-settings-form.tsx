"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2Icon, Loader2Icon, XCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useLocalQuery } from "@/hooks/use-local-db";
import { getDb } from "@/lib/db/db";
import { clearRpcSettings, getRpcSettings, saveRpcSettings } from "@/lib/db/rpc-settings";
import { type RpcTestResult, testRpcConnection } from "@/lib/rpc/test-connection";
import { validateRpcUrl } from "@/lib/rpc/url";

export function RpcSettingsForm() {
  const stored = useLocalQuery((db) => getRpcSettings(db), []);
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<RpcTestResult | null>(null);
  const [testedUrl, setTestedUrl] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (hydrated || stored.status !== "ready") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time load of the persisted form values
    setHydrated(true);
    if (stored.data) {
      setUrl(stored.data.url);
    }
  }, [stored, hydrated]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function checkUrl(): string | null {
    const result = validateRpcUrl(url);
    setUrlError(result.ok ? null : result.error);
    return result.ok ? url.trim() : null;
  }

  async function runTest() {
    const valid = checkUrl();
    if (!valid) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setTesting(true);
    setTestResult(null);
    const result = await testRpcConnection(valid, { signal: controller.signal });
    if (controller.signal.aborted && result.ok === false && result.kind === "aborted") return;
    setTesting(false);
    setTestResult(result);
    setTestedUrl(valid);
  }

  async function save() {
    const valid = checkUrl();
    if (!valid) return;
    const lastTest =
      testResult && testedUrl === valid
        ? {
            ok: testResult.ok,
            at: new Date().toISOString(),
            source: "test" as const,
            ...(testResult.ok ? { latencyMs: testResult.latencyMs, solanaCore: testResult.solanaCore ?? undefined } : {}),
          }
        : undefined;
    try {
      await saveRpcSettings(getDb(), { url: valid, lastTest });
      toast.success(lastTest?.ok ? "RPC saved locally." : "RPC saved locally (connection not verified).");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save RPC settings.");
    }
  }

  async function clear() {
    await clearRpcSettings(getDb());
    setUrl("");
    setTestResult(null);
    toast.success("RPC settings cleared from this browser.");
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>RPC settings</CardTitle>
        <CardDescription>
          FraudWatch reads the blockchain through your own Solana RPC endpoint. It is stored only in this browser and is
          never put in URLs, exports, or logs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/*
          No `name` attributes and method="post": if the form were ever submitted
          natively (before hydration), the RPC URL must not be serialized into the
          page URL as a query string.
        */}
        <form
          id="rpc-settings"
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <FieldGroup>
            <Field data-invalid={urlError ? true : undefined}>
              <FieldLabel htmlFor="rpc-url">RPC URL</FieldLabel>
              <Input
                id="rpc-url"
                type="url"
                inputMode="url"
                placeholder="https://mainnet.helius-rpc.com/?api-key=…"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setUrlError(null);
                }}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={urlError ? true : undefined}
                className="font-mono"
              />
              {urlError ? (
                <FieldError>{urlError}</FieldError>
              ) : (
                <FieldDescription>Include any API key your provider requires. Must use https://.</FieldDescription>
              )}
            </Field>

            {testResult && <TestResultAlert result={testResult} />}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="ghost" onClick={clear} disabled={stored.status !== "ready" || !stored.data}>
          Clear saved RPC
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={runTest} disabled={testing}>
            {testing && <Loader2Icon className="animate-spin" />}
            Test connection
          </Button>
          <Button type="submit" form="rpc-settings">
            Save locally
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function TestResultAlert({ result }: { result: RpcTestResult }) {
  if (result.ok) {
    return (
      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>Connected</AlertTitle>
        <AlertDescription>
          {result.latencyMs} ms · slot {result.slot.toLocaleString()}
          {result.solanaCore ? ` · solana-core ${result.solanaCore}` : ""}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive">
      <XCircleIcon />
      <AlertTitle>Connection failed</AlertTitle>
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  );
}
