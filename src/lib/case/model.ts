import { isValidSolanaAddress, shortenAddress } from "@/lib/solana/address";
import { type CaseRange, isValidRange, rangeFromDates } from "./range";

/** v2 (Sprint 06): labels and tags live in the `address_labels` table, not the case. */
export const CASE_SCHEMA_VERSION = 2;

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

/** Empty dates are allowed: they're filled from the wallet's activity by `completeRange`. */
export type NewCaseDates = { startDate: string | null; endDate: string | null };

export type NewCaseValidation =
  | { ok: true; value: { name: string; primaryWallet: string; dates: NewCaseDates } }
  | { ok: false; errors: NewCaseErrors };

export const MAX_CASE_NAME_LENGTH = 120;

const validDate = (date: string) => rangeFromDates(date, date) !== null;

export function validateNewCaseInput(input: NewCaseInput): NewCaseValidation {
  const errors: NewCaseErrors = {};
  const primaryWallet = input.primaryWallet.trim();
  const name = input.name.trim() || (primaryWallet ? `Case ${shortenAddress(primaryWallet)}` : "");

  if (!primaryWallet) errors.primaryWallet = "Enter the primary wallet address.";
  else if (!isValidSolanaAddress(primaryWallet)) errors.primaryWallet = "Not a valid Solana address.";

  if (name.length > MAX_CASE_NAME_LENGTH) errors.name = `Keep the name under ${MAX_CASE_NAME_LENGTH} characters.`;

  if (input.startDate && !validDate(input.startDate)) errors.startDate = "Invalid date.";
  if (input.endDate && !validDate(input.endDate)) errors.endDate = "Invalid date.";
  if (!errors.startDate && !errors.endDate && input.startDate && input.endDate) {
    const range = rangeFromDates(input.startDate, input.endDate);
    if (!range || !isValidRange(range)) errors.endDate = "End date must be on or after the start date.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, primaryWallet, dates: { startDate: input.startDate || null, endDate: input.endDate || null } } };
}

/** The wallet's first and last activity, for filling empty dates; see `findActivitySpan`. */
export type WalletActivity = { first: string | null; last: string | null; truncated: boolean };

/**
 * Builds the case range, filling an empty start with the day of the wallet's
 * first transaction and an empty end with the day of its last. Errors name
 * the field the user should fill in.
 */
export function completeRange(
  dates: NewCaseDates,
  activity: WalletActivity | null,
): { ok: true; range: CaseRange } | { ok: false; errors: NewCaseErrors } {
  const errors: NewCaseErrors = {};
  const startDate = dates.startDate ?? activity?.first?.slice(0, 10) ?? null;
  const endDate = dates.endDate ?? activity?.last?.slice(0, 10) ?? null;
  if (!startDate) {
    errors.startDate = activity?.truncated
      ? "This wallet has too many transactions to find its first one. Enter a start date."
      : "No transactions found for this wallet. Enter a start date.";
  }
  if (!endDate) errors.endDate = "No transactions found for this wallet. Enter an end date.";
  if (!startDate || !endDate) return { ok: false, errors };

  const range = rangeFromDates(startDate, endDate);
  if (range && isValidRange(range)) return { ok: true, range };
  if (!dates.endDate) errors.startDate = `Start date is after the wallet's last transaction (${endDate}).`;
  else if (!dates.startDate) errors.endDate = `End date is before the wallet's first transaction (${startDate}).`;
  else errors.endDate = "End date must be on or after the start date.";
  return { ok: false, errors };
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
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
