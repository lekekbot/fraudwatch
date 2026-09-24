import { type AddressLabel, isEmptyLabel, normalizeLabel } from "@/lib/labels/labels";
import type { FraudWatchDB } from "./db";

export async function getAddressLabels(db: FraudWatchDB, caseId: string): Promise<AddressLabel[]> {
  return db.address_labels.where("caseId").equals(caseId).toArray();
}

/** Saves a label; clearing every field removes it. */
export async function saveAddressLabel(db: FraudWatchDB, label: AddressLabel): Promise<void> {
  const clean = normalizeLabel(label);
  if (isEmptyLabel(clean)) await db.address_labels.delete([clean.caseId, clean.address]);
  else await db.address_labels.put(clean);
}
