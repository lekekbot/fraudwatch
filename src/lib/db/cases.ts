import { type FraudWatchCase, MAX_CASE_NAME_LENGTH } from "@/lib/case/model";
import { type CaseRange, sameRange } from "@/lib/case/range";
import type { FraudWatchDB } from "./db";

export async function listRecentCases(db: FraudWatchDB, limit = 20): Promise<FraudWatchCase[]> {
  return db.cases.orderBy("updatedAt").reverse().limit(limit).toArray();
}

export async function getCase(db: FraudWatchDB, id: string): Promise<FraudWatchCase | undefined> {
  return db.cases.get(id);
}

export async function saveCase(db: FraudWatchDB, fwCase: FraudWatchCase): Promise<void> {
  await db.cases.put(fwCase);
}

/**
 * Rename a case. The name is trimmed and must be 1–MAX_CASE_NAME_LENGTH
 * characters; returns the saved name, or throws with a message to show.
 */
export async function renameCase(db: FraudWatchDB, id: string, name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A case needs a name.");
  if (trimmed.length > MAX_CASE_NAME_LENGTH) throw new Error(`Keep the name under ${MAX_CASE_NAME_LENGTH} characters.`);
  const updated = await db.cases.update(id, { name: trimmed });
  if (!updated) throw new Error("That case no longer exists.");
  return trimmed;
}

/** Records that the case was opened so it sorts to the top of "recent". */
export async function touchCase(db: FraudWatchDB, id: string, now = new Date()): Promise<void> {
  await db.cases.update(id, { updatedAt: now.toISOString() });
}

/**
 * Delete a case, its labels and its last-load record. Cached chain data stays:
 * it is shared by every case that maps the same wallets.
 */
export async function deleteCase(db: FraudWatchDB, id: string): Promise<void> {
  await db.transaction("rw", db.cases, db.ingestion_jobs, db.address_labels, async () => {
    await db.cases.delete(id);
    await db.ingestion_jobs.delete(id);
    await db.address_labels.where("caseId").equals(id).delete();
  });
}

/** Cases with the same primary wallet and exactly the same range. */
export async function findDuplicateCases(
  db: FraudWatchDB,
  primaryWallet: string,
  range: CaseRange,
): Promise<FraudWatchCase[]> {
  const sameWallet = await db.cases.where("primaryWallet").equals(primaryWallet).toArray();
  return sameWallet.filter((c) => sameRange(c.range, range));
}
