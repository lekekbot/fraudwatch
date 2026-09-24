import type { FraudWatchCase } from "@/lib/case/model";
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

/** Records that the case was opened so it sorts to the top of "recent". */
export async function touchCase(db: FraudWatchDB, id: string, now = new Date()): Promise<void> {
  await db.cases.update(id, { updatedAt: now.toISOString() });
}

export async function deleteCase(db: FraudWatchDB, id: string): Promise<void> {
  await db.cases.delete(id);
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
