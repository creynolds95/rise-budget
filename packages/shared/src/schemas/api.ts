import { z } from 'zod';
import { Cents, Id, IsoDate, PeriodId } from './primitives';
import {
  AccountKind,
  AppLock,
  ReviewState,
  RolloverPolicy,
  RuleMatchField,
  RuleMatchType,
  SpendShape,
} from './enums';
import { DebtPlan, FollowRule, RetirementPlan, SavingsPlan } from './entities';

export const ManualCadence = z.enum(['weekly', 'biweekly', 'monthly', 'semimonthly', 'annual']);

export const AnchorDays = z.tuple([
  z.number().int().min(1).max(31),
  z.number().int().min(1).max(31),
]);

// ── error contract (ARCHITECTURE §4) ──────────────────────────────────────────

export const ErrorCode = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INSUFFICIENT_POOL',
  'SPLITS_DO_NOT_SUM',
  'CATEGORY_IN_USE',
  'PERIOD_CLOSED',
  'NOTHING_TO_FORGIVE',
  'AMOUNT_MISMATCH',
  'IDEMPOTENCY_CONFLICT',
  'RATE_LIMITED',
  'STEP_UP_REQUIRED',
  'DB_LIMIT',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    detail: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ── request bodies ────────────────────────────────────────────────────────────

// PATCH bodies are written out without `.default()`s: `.partial()` on a defaulted field
// re-applies the default when the key is absent, silently resetting the user's choice.
export const PatchSettingsBody = z.object({
  appLock: AppLock.optional(),
  planChangesApplyToFuture: z.boolean().optional(),
  cushionCents: Cents.optional(),
  cashAccountIds: z.array(Id).optional(),
  dismissedPayMerchants: z
    .array(z.object({ merchant: z.string(), displayName: z.string() }))
    .optional(),
  dismissedMisses: z
    .array(z.object({ seriesId: z.string(), dueDate: IsoDate }))
    .max(200)
    .optional(),
  retirement: RetirementPlan.nullable().optional(),
  debt: DebtPlan.nullable().optional(),
  savings: SavingsPlan.nullable().optional(),
  /** Rules only: the log is the server's. */
  follow: z.object({ rules: z.array(FollowRule).max(20) }).optional(),
});

export const FollowUndoBody = z.object({ txnId: Id });

export const CreateAccountBody = z.object({
  name: z.string().min(1),
  kind: AccountKind,
  institutionName: z.string().nullable().default(null),
  includeInNetWorth: z.boolean().default(true),
  includeInBudget: z.boolean().default(true),
  expectedPaymentCents: Cents.nullable().default(null),
  paymentDay: z.int().min(1).max(31).nullable().default(null),
});
export type CreateAccountBody = z.infer<typeof CreateAccountBody>;

export const PatchAccountBody = z.object({
  name: z.string().min(1).optional(),
  kind: AccountKind.optional(),
  institutionName: z.string().nullable().optional(),
  includeInNetWorth: z.boolean().optional(),
  includeInBudget: z.boolean().optional(),
  expectedPaymentCents: Cents.nullable().optional(),
  paymentDay: z.int().min(1).max(31).nullable().optional(),
  syncCadenceHours: z.int().positive().nullable().optional(),
});
export type PatchAccountBody = z.infer<typeof PatchAccountBody>;

export const CreateSnapshotBody = z.object({ asOf: IsoDate, balanceCents: Cents });

export const SplitInput = z.object({ categoryId: Id, amountCents: Cents });
export type SplitInput = z.infer<typeof SplitInput>;

export const ReplaceSplitsBody = z.object({ splits: z.array(SplitInput).min(1) });

export const PatchTransactionBody = z.object({
  categoryId: Id.optional(),
  notes: z.string().nullable().optional(),
  merchantDisplay: z.string().nullable().optional(),
  reviewState: ReviewState.optional(),
  // M1: past months are editable, not frozen — moving a transaction's date moves its splits
  // to the new period and flags either side if closed (SPEC §2.5).
  postedAt: IsoDate.optional(),
});

export const CreateTransactionBody = z.object({
  accountId: Id,
  postedAt: IsoDate,
  amountCents: Cents,
  descriptor: z.string().min(1),
  categoryId: Id.optional(),
  notes: z.string().optional(),
});

export const BulkAcceptBody = z.union([
  z.object({ ids: z.array(Id).min(1) }),
  z.object({ minConfidence: z.number().min(0.9).max(1) }),
]);

export const TransferLinkBody = z.object({ otherTxnId: Id });

/** Caleb's "Recurring Cash Withdrawal" tag (cash-to-payday, not a category setting). */
export const RecurringCashWithdrawalBody = z
  .object({
    cadence: ManualCadence,
    /** Defaults in the UI to the tagged transaction's own date; editable before saving. */
    dueDate: IsoDate,
    /** Required, and only meaningful, for cadence 'semimonthly' (e.g. paid the 5th and 20th). */
    anchorDays: AnchorDays.optional(),
  })
  .refine((b) => b.cadence !== 'semimonthly' || b.anchorDays, {
    message: 'anchorDays is required for a semimonthly cadence',
    path: ['anchorDays'],
  });

/**
 * A hand-declared paycheck or bill for Runway, with no transaction to tag it from (a cold
 * start, or income Rise hasn't seen post yet). Same shape as the transaction-tagged manual
 * rule, just without a real merchant behind it.
 */
export const ManualCashEventBody = z
  .object({
    label: z.string().trim().min(1).max(60),
    kind: z.enum(['income', 'expense']),
    amountCents: Cents.positive(),
    cadence: ManualCadence,
    /** The first (or most recent) date it happens; projected forward from today. */
    anchorDate: IsoDate,
    /**
     * Days of the month, where 31 means the last day: [first, second] for 'semimonthly', or
     * [day, day] to pin a 'monthly' schedule to one day.
     */
    anchorDays: AnchorDays.optional(),
  })
  .refine((b) => b.cadence !== 'semimonthly' || b.anchorDays, {
    message: 'anchorDays is required for a semimonthly cadence',
    path: ['anchorDays'],
  });

/**
 * Edit one paycheck/bill schedule: `id` for a manual rule (tagged or hand-added), or `merchant`
 * to take a detected one over (it then stops being re-detected).
 */
export const ScheduleBody = z
  .object({
    id: z.string().min(1).optional(),
    merchant: z.string().min(1).optional(),
    kind: z.enum(['income', 'expense']),
    amountCents: Cents.positive(),
    cadence: ManualCadence,
    anchorDate: IsoDate,
    anchorDays: AnchorDays.optional(),
    /** Only a hand-added schedule has a name of its own to change. */
    label: z.string().trim().min(1).max(60).optional(),
  })
  .refine((b) => b.cadence !== 'semimonthly' || b.anchorDays, {
    message: 'anchorDays is required for a semimonthly cadence',
    path: ['anchorDays'],
  })
  .refine((b) => b.id || b.merchant, { message: 'id or merchant is required', path: ['id'] });

export const RunSyncBody = z.object({
  /** Backfill from this date instead of the usual window. */
  since: IsoDate.optional(),
});

export const PatchPeriodBody = z.object({ expectedIncomeCents: Cents.nonnegative() });

export const FundingSource = z.object({ fromCategoryId: Id, amountCents: Cents.positive() });
export type FundingSource = z.infer<typeof FundingSource>;

export const PatchAllocationBody = z.object({
  plannedCents: Cents.nonnegative(),
  funding: z.array(FundingSource).default([]),
  note: z.string().max(500).optional(),
  /** SPEC §2.9: also make this the plan for every later month. */
  applyToFuture: z.boolean().default(false),
});

export const CreateCategoryBody = z.object({
  groupId: Id,
  name: z.string().min(1),
  emoji: z.string().nullable().default(null),
  isBill: z.boolean().default(false),
  /** Omitted → smart default from `isBill` (SPEC §2.2). */
  rolloverPolicy: RolloverPolicy.optional(),
  spendShape: SpendShape.optional(),
  /** Whether a split filed here counts as spending. Default true. */
  budgeted: z.boolean().default(true),
});
export type CreateCategoryBody = z.infer<typeof CreateCategoryBody>;

export const PatchCategoryBody = z.object({
  name: z.string().trim().min(1).optional(),
  emoji: z.string().trim().max(16).nullable().optional(),
  groupId: Id.optional(),
  rolloverPolicy: RolloverPolicy.optional(),
  spendShape: SpendShape.optional(),
  isBill: z.boolean().optional(),
  budgeted: z.boolean().optional(),
  /** L6: manual drag-reorder within (or across) a group. */
  sortOrder: z.int().optional(),
});

/** L6: rename or reorder a group from the settings page. Kind never changes after creation. */
export const PatchCategoryGroupBody = z.object({
  name: z.string().trim().min(1).optional(),
  sortOrder: z.int().optional(),
});

export const ForgiveBody = z.object({
  amountCents: Cents.positive(),
  reason: z.string().trim().min(1),
});

export const CreateRuleBody = z.object({
  matchField: RuleMatchField,
  matchType: RuleMatchType,
  matchValue: z.string().min(1),
  categoryId: Id,
  priority: z.int().default(0),
});

export const PatchMerchantBody = z.object({
  /** Rename; applies to every past and future transaction. Null clears it. */
  displayName: z.string().trim().min(1).max(100).nullable().optional(),
  /** "No" to a rule offer. */
  suppressRuleOffer: z.boolean().optional(),
});

/** SPEC §4.6: returned after the third identical categorisation. Yes → POST /rules. */
export const RuleOffer = z.object({ merchant: z.string(), categoryId: Id });
export type RuleOffer = z.infer<typeof RuleOffer>;

/** Comma-separated ids in a query string, e.g. `account=a,b`. */
const IdList = z
  .string()
  .transform((s) => s.split(',').filter(Boolean))
  .pipe(z.array(Id).min(1).max(50));

export const TxnSort = z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']);
export type TxnSort = z.infer<typeof TxnSort>;

export const TransactionQuery = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  account: IdList.optional(),
  category: IdList.optional(),
  q: z.string().optional(),
  reviewState: ReviewState.optional(),
  /** `out` is spending (positive), `in` is money arriving (negative). */
  direction: z.enum(['in', 'out']).optional(),
  /** Bounds on the size of the amount, in cents, whichever way it went. */
  min: z.coerce.number().int().nonnegative().optional(),
  max: z.coerce.number().int().nonnegative().optional(),
  sort: TxnSort.default('date_desc'),
  cursor: z.string().optional(),
});

export const PeriodParam = z.object({ id: PeriodId });

// ── auth ──────────────────────────────────────────────────────────────────────

/** WebAuthn JSON payloads are validated structurally by @simplewebauthn/server. */
const WebAuthnJson = z.looseObject({ id: z.string(), type: z.literal('public-key') });

export const RegisterOptionsBody = z.object({
  /** One-time token from `pnpm seed:user`; omitted when adding a device while signed in. */
  registrationToken: z.string().optional(),
});

export const RegisterVerifyBody = z.object({
  challengeToken: z.string(),
  response: WebAuthnJson,
  deviceLabel: z.string().max(80).optional(),
});

/** C17: what Settings lists under Passkeys and Signed-in devices. */
export const DevicesResponse = z.object({
  passkeys: z.array(
    z.object({
      id: z.string(),
      label: z.string().nullable(),
      createdAt: z.string(),
      lastUsedAt: z.string().nullable(),
    }),
  ),
  sessions: z.array(
    z.object({
      id: z.string(),
      label: z.string().nullable(),
      createdAt: z.string(),
      lastSeenAt: z.string().nullable(),
      current: z.boolean(),
    }),
  ),
});
export type DevicesResponse = z.infer<typeof DevicesResponse>;

export const LoginVerifyBody = z.object({
  challengeToken: z.string(),
  response: WebAuthnJson,
});

export const FallbackLoginBody = z.object({
  email: z.email(),
  code: z.string().trim().min(6).max(32),
});

export const TotpConfirmBody = z.object({ code: z.string().regex(/^\d{6}$/) });

export const AccessTokenResponse = z.object({ access: z.string() });

export const CreateCategoryGroupBody = z.object({
  name: z.string().min(1),
  kind: z.enum(['income', 'expense']),
  sortOrder: z.int().optional(),
});

/** T46. `json` is everything (no credentials); `csv` is transactions for a spreadsheet. */
export const ExportQuery = z.object({ format: z.enum(['json', 'csv']).default('json') });
export type ExportQuery = z.infer<typeof ExportQuery>;

/** Cloudflare free-tier D1 allowances, per UTC day. */
export const D1_DAILY_LIMITS = { rowsRead: 5_000_000, rowsWritten: 100_000 } as const;

export const UsageDay = z.object({
  day: z.string(), // YYYY-MM-DD, UTC
  rowsRead: z.number().int(),
  rowsWritten: z.number().int(),
  requests: z.number().int(),
});
export const UsageStatus = z.object({
  limits: z.object({ rowsRead: z.number().int(), rowsWritten: z.number().int() }),
  /** Newest first, today included. Days with no activity are absent. */
  days: z.array(UsageDay),
  /** Today's heaviest routes by rows read, most first. */
  routes: z.array(
    z.object({ route: z.string(), rowsRead: z.number().int(), requests: z.number().int() }),
  ),
});
export type UsageStatus = z.infer<typeof UsageStatus>;

export const BackupStatus = z.object({
  latest: z.object({ date: IsoDate, bytes: z.int().nonnegative() }).nullable(),
  count: z.int().nonnegative(),
});
export type BackupStatus = z.infer<typeof BackupStatus>;

// ── reports (T41) ─────────────────────────────────────────────────────────────

export const SpendingReportQuery = z.object({ month: PeriodId });

/** Dashboard spending: per-day for this and last month, per-month for the last six. */
export const SpendingReport = z.object({
  month: PeriodId,
  days: z.array(z.object({ date: IsoDate, cents: Cents })),
  months: z.array(z.object({ periodId: PeriodId, cents: Cents })),
});
export type SpendingReport = z.infer<typeof SpendingReport>;

export const MoneyFlowReportQuery = z.object({ month: PeriodId });

/** Money-flow (Sankey) diagram: income → expense groups → categories, plus what's left over. */
export const MoneyFlowReport = z.object({
  month: PeriodId,
  nodes: z.array(z.object({ id: z.string(), name: z.string() })),
  links: z.array(z.object({ source: z.string(), target: z.string(), valueCents: Cents })),
});
export type MoneyFlowReport = z.infer<typeof MoneyFlowReport>;

export const CashFlowReportQuery = z.object({ month: PeriodId });

/** Cash-flow bar chart: income vs. expense per month, for the last six months. */
export const CashFlowReport = z.object({
  month: PeriodId,
  months: z.array(z.object({ periodId: PeriodId, incomeCents: Cents, expenseCents: Cents })),
});
export type CashFlowReport = z.infer<typeof CashFlowReport>;

// ── Monarch history import ────────────────────────────────────────────────────

/** Monarch rows outside these dates are never imported: SimpleFIN holds everything newer. */
export const MONARCH_WINDOW = { from: '2023-01-01', to: '2026-08-31' } as const;

export const MonarchSetupBody = z.object({
  /** Accounts to create as history-only (archived, outside net worth and the budget). */
  accounts: z
    .array(
      z.object({
        monarchName: z.string().trim().min(1).max(200),
        kind: z.enum(['depository', 'credit', 'loan']),
      }),
    )
    .max(100),
  /** Categories to create; `transfer` ones land in the unbudgeted Transfers group. */
  categories: z
    .array(
      z.object({
        monarchName: z.string().trim().min(1).max(200),
        kind: z.enum(['income', 'expense', 'transfer']),
        /** The group the person picked; without one it waits in "Imported" at $0. */
        groupId: Id.optional(),
      }),
    )
    .max(200),
});
export type MonarchSetupBody = z.infer<typeof MonarchSetupBody>;

export const MonarchRowsBody = z.object({
  /** One id for the whole import, so it can be undone as a unit. */
  batchId: Id,
  rows: z
    .array(
      z.object({
        sourceId: z.string().min(1).max(100),
        postedAt: IsoDate,
        amountCents: Cents,
        merchant: z.string().max(300),
        originalStatement: z.string().max(500),
        notes: z.string().max(2000),
        accountId: Id,
        categoryId: Id,
        isTransfer: z.boolean(),
        reviewed: z.boolean(),
      }),
    )
    .min(1)
    .max(200),
});
export type MonarchRowsBody = z.infer<typeof MonarchRowsBody>;

export const MonarchRowsResult = z.object({
  imported: z.number().int(),
  /** Already imported (same Monarch id), so left alone: re-running a file is safe. */
  duplicate: z.number().int(),
  /** Matches a transaction the bank feed already has on that account, same day and amount. */
  overlap: z.number().int(),
  /** Outside the import window, or in a month that is already closed. */
  rejected: z.number().int(),
});
export type MonarchRowsResult = z.infer<typeof MonarchRowsResult>;

export const MonarchBatch = z.object({
  batchId: z.string(),
  rows: z.number().int(),
  from: IsoDate,
  to: IsoDate,
  importedAt: z.string(),
});
export type MonarchBatch = z.infer<typeof MonarchBatch>;

/** A history account the import made and the live (bank-feed) account for the same card or bank account. */
export const MonarchMergeCandidate = z.object({
  historyId: Id,
  historyName: z.string(),
  liveId: Id,
  liveName: z.string(),
  /** Rows that move across. */
  rows: z.number().int(),
  /** Rows the live account's bank feed already has: dropped, not moved. */
  duplicates: z.number().int(),
});
export type MonarchMergeCandidate = z.infer<typeof MonarchMergeCandidate>;

export const MonarchMergeBody = z.object({ historyId: Id, liveId: Id });
export type MonarchMergeBody = z.infer<typeof MonarchMergeBody>;

/** Imported rows on a bank-fed account for days its feed already covers. */
export const MonarchFeedOverlap = z.object({
  accountId: Id,
  accountName: z.string(),
  rows: z.number().int(),
  from: z.string(),
  to: z.string(),
});
export type MonarchFeedOverlap = z.infer<typeof MonarchFeedOverlap>;

/** The user's call on a detected series: it ended (stop watching it) or track it again. */
export const PatchSeriesBody = z.object({ status: z.enum(['ended', 'active']) });
