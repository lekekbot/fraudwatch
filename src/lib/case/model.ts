import type { CaseView } from "@/lib/routing/case-path";
import { isValidSolanaAddress, shortenAddress } from "@/lib/solana/address";
import type { EffectKind } from "@/lib/state/summarize";
import { type CaseRange, isValidRange, rangeFromDates } from "./range";

export type MappedWalletConfig = {
  address: string;

  addedFromWallet?: string;

  rangeMode: "case" | "first_interaction" | "custom";

  /** Where this wallet's history starts, for `first_interaction` (resolved when mapped) and `custom`. See `walletRange`. */
  customStart?: string;

  /** Never load from the RPC: only history already cached is shown. */
  paused?: boolean;
};

/** A wallet or address, a transaction (on a wallet's lane), or a moment in time. */
export type Bookmark = {
  id: string;
  kind: "wallet" | "transaction" | "date";
  /** Address, signature, or ISO time. */
  target: string;
  /** For a transaction: whose lane it was bookmarked on. */
  wallet?: string;
  note?: string;
  createdAt: string;
};

/** How a moved amount compares to a rule's value. */
export type AmountOp = "lt" | "gt" | "eq" | "ne";

/**
 * A named, switchable set of conditions that hides matching transactions.
 * Every condition given must match; any value within one may. No conditions match nothing.
 */
export type HideRule = {
  id: string;
  name: string;
  enabled: boolean;
  /** Transaction type is one of these. */
  kinds?: EffectKind[];
  /** Every asset it moves is one of these (spam tokens). */
  onlyAssets?: string[];
  /** It moves the asset, and every movement of it compares to `value` (base units) by `op`. */
  amount?: { assetId: string; op: AmountOp; value: string };
  /** Involves one of these addresses. */
  counterparties?: string[];
  /** Involves an address tagged with one of these. */
  tags?: string[];
  /** Uses one of these protocols (registry ids). */
  protocols?: string[];
};

/** Sparse and untrusted at rest, like the global preferences row; read through `caseOverrides`. */
export type CaseViewSettings = {
  schemaVersion: number;
  values: Record<string, unknown>;
  /** The preset last applied to this case: its values were copied into `values`, so editing or deleting it changes nothing here. */
  appliedPreset?: { ref: string; name: string; at: string };
};

export type FraudWatchCase = {
  id: string;
  name: string;

  primaryWallet: string;

  range: CaseRange;

  mappedWallets: MappedWalletConfig[];

  /** Lane order the user chose (Sprint 08); wallets missing from it follow in default order. */
  laneOrder?: string[];
  /** Mapped wallets whose lanes are hidden; still mapped and loaded. */
  hiddenLanes?: string[];
  /** Transactions hidden from the map by hand (Sprint 09C). */
  hiddenSignatures?: string[];
  /** Exceptions: shown even when a hide rule matches them. */
  shownSignatures?: string[];
  /** Saved conditions that hide matching transactions. */
  hideRules?: HideRule[];
  /** Places the investigator marked to come back to (Sprint 09). */
  bookmarks?: Bookmark[];
  /** Display preferences this case overrides; see `src/lib/case/view-settings.ts`. Never evidence. */
  viewSettings?: CaseViewSettings;
  /** The view last open, for "open cases on the last used view". */
  lastView?: CaseView;

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
    name: value.name,
    primaryWallet: value.primaryWallet,
    range: value.range,
    mappedWallets: [{ address: value.primaryWallet, rangeMode: "case" }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
