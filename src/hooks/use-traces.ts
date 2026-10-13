"use client";

import { useCallback } from "react";
import { getDb } from "@/lib/db/db";
import { copyTrace, createTrace, deleteTrace, getTrace, listTraces, saveTrace, type NewTraceInput } from "@/lib/db/traces";
import type { Trace } from "@/lib/trace/model";
import { useLocalQuery } from "./use-local-db";

/** Reactive case list, with writes and reads scoped to the current case. */
export function useTraces(caseId: string) {
  const list = useLocalQuery((db) => listTraces(db, caseId), [caseId]);
  const get = useCallback((id: string) => getTrace(getDb(), id, caseId), [caseId]);
  const create = useCallback((input: Omit<NewTraceInput, "caseId">) => createTrace(getDb(), { ...input, caseId }), [caseId]);
  const duplicate = useCallback((id: string) => copyTrace(getDb(), id, caseId), [caseId]);
  const save = useCallback((trace: Trace) => {
    if (trace.caseId !== caseId) throw new Error("Trace belongs to another case.");
    return saveTrace(getDb(), trace);
  }, [caseId]);
  const remove = useCallback(async (id: string) => {
    const result = await get(id);
    if (!result.ok && result.reason === "missing") throw new Error("Trace not found in this case.");
    await deleteTrace(getDb(), id);
  }, [get]);
  return { list, get, create, duplicate, save, remove };
}
