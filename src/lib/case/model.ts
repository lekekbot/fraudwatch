import { isValidSolanaAddress, shortenAddress } from "@/lib/solana/address";
import { type CaseRange, isValidRange, rangeFromDates } from "./range";

export const CASE_SCHEMA_VERSION = 1;

export type MappedWalletConfig = {
  address: string;
  role: "primary" | "mapped";

  addedFromWallet?: string;
  addedFromTransaction?: string;

  rangeMode: "case" | "first_interaction" | "custom";

  customStart?: string;
};

export type FraudWatchCase = {
  id: string;
  version: number;
  name: string;

  chain: "solana";

  primaryWallet: string;

  range: CaseRange;

  mappedWallets: MappedWalletConfig[];

  labels: Record<string, string>;
  tags: Record<string, string[]>;

  createdAt: string;
  updatedAt: string;
};

export type NewCaseInput = {
  name: string;
  primaryWallet: string;
  startDate: string;
  endDate: string;
};

export type NewCaseErrors = Partial<Record<keyof NewCaseInput, string>>;

export type NewCaseValidation =
  | { ok: true; value: { name: string; primaryWallet: string; range: CaseRange } }
  | { ok: false; errors: NewCaseErrors };

export const MAX_CASE_NAME_LENGTH = 120;

export function validateNewCaseInput(input: NewCaseInput): NewCaseValidation {
  const errors: NewCaseErrors = {};
  const primaryWallet = input.primaryWallet.trim();
  const name = input.name.trim() || (primaryWallet ? `Case ${shortenAddress(primaryWallet)}` : "");

  if (!primaryWallet) errors.primaryWallet = "Enter the primary wallet address.";
  else if (!isValidSolanaAddress(primaryWallet)) errors.primaryWallet = "Not a valid Solana address.";

  if (name.length > MAX_CASE_NAME_LENGTH) errors.name = `Keep the name under ${MAX_CASE_NAME_LENGTH} characters.`;

  if (!input.startDate) errors.startDate = "Choose a start date.";
  if (!input.endDate) errors.endDate = "Choose an end date.";

  let range: CaseRange | null = null;
  if (input.startDate && input.endDate) {
    range = rangeFromDates(input.startDate, input.endDate);
    if (!range) errors.startDate = "Invalid date.";
    else if (!isValidRange(range)) errors.endDate = "End date must be on or after the start date.";
  }

  if (Object.keys(errors).length > 0 || !range) return { ok: false, errors };
  return { ok: true, value: { name, primaryWallet, range } };
}

export function createCase(
  value: { name: string; primaryWallet: string; range: CaseRange },
  deps: { id?: string; now?: Date } = {},
): FraudWatchCase {
  const timestamp = (deps.now ?? new Date()).toISOString();
  return {
    id: deps.id ?? crypto.randomUUID(),
    version: CASE_SCHEMA_VERSION,
    name: value.name,
    chain: "solana",
    primaryWallet: value.primaryWallet,
    range: value.range,
    mappedWallets: [{ address: value.primaryWallet, role: "primary", rangeMode: "case" }],
    labels: {},
    tags: {},
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
