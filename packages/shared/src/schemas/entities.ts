import { z } from 'zod';
import { Cents, Id, IsoDate, IsoDateTime, PeriodId } from './primitives';
import {
  AccountKind,
  AccountSource,
  AppLock,
  AuditAction,
  CategoryGroupKind,
  ImportFormat,
  RecurringCadence,
  RecurringStatus,
  ReviewState,
  RolloverPolicy,
  RuleMatchField,
  RuleMatchType,
  SnapshotSource,
  SpendShape,
  SyncRunStatus,
  TxnSource,
} from './enums';

/** Entity shapes as the API speaks them (camelCase, booleans as booleans). */

/** Retirement plan, all in today's dollars. One household age; contributions are entered by hand. */
export const RetirementPlan = z.object({
  currentAge: z.int().min(18).max(100),
  goalAge: z.int().min(40).max(90),
  /** Monthly spend wanted in retirement, in today's dollars. The needed balance is derived from it. */
  spendTargetCents: Cents.min(0),
  /** What goes in each month, per retirement account, match included. */
  contributions: z.array(z.object({ accountId: Id, monthlyCents: Cents.min(0) })).default([]),
  /** Real (after-inflation) growth, basis points. Conservative default. */
  realGrowthBps: z.int().min(0).max(1000).default(400),
  /** Safe-withdrawal rate, basis points. Conservative default. */
  withdrawalBps: z.int().min(100).max(1000).default(350),
});
export type RetirementPlan = z.infer<typeof RetirementPlan>;

/** One account in the payoff plan. Manual and edited by hand; nothing here is guessed. */
export const DebtLoanPlan = z.object({
  accountId: Id,
  /** Annual rate in thousandths of a percent: 5.875% is 5875. */
  aprMilliPct: z.int().min(0).max(100_000),
  paymentCents: Cents.min(0),
  /** Day of the month the payment is due (clamped to short months). */
  dueDay: z.int().min(1).max(31),
  /** Student loans pool together; the mortgage never joins them. */
  group: z.enum(['student', 'mortgage']),
  /** The last month ("2026-10") whose payment is already in the account's balance. */
  appliedThrough: z.string().regex(/^\d{4}-\d{2}$/),
});
export type DebtLoanPlan = z.infer<typeof DebtLoanPlan>;

export const DebtPlan = z.object({
  loans: z.array(DebtLoanPlan).default([]),
  strategy: z.enum(['snowball', 'avalanche']).default('snowball'),
  /** A finished loan's payment moves on to the next loan. */
  rollForward: z.boolean().default(true),
  /** Extra per month, split by strategy across the student loans only. */
  extraCents: Cents.min(0).default(0),
  mortgageExtraCents: Cents.min(0).default(0),
  /** Manual account whose balance is the home's value, for equity. */
  homeValueAccountId: Id.nullable().default(null),
});
export type DebtPlan = z.infer<typeof DebtPlan>;

export const UserSettings = z.object({
  appLock: AppLock.default('off'),
  /** SPEC §2.9: where the plan editor's "apply to all future months" starts. */
  planChangesApplyToFuture: z.boolean().default(false),
  /** Cash-to-payday: how much of the checking balance is never counted as free to move. */
  cushionCents: Cents.default(50_000),
  /** Cash-to-payday: which accounts count as spendable cash. Empty = every budgeted depository account. */
  cashAccountIds: z.array(Id).default([]),
  /** Cash-to-payday: detected merchants to stop treating as a recurring pay/bill, with the
   * name shown at dismiss time (detection skips a dismissed merchant, so there's no other
   * way to label it if the user wants to undo). */
  dismissedPayMerchants: z
    .array(z.object({ merchant: z.string(), displayName: z.string() }))
    .default([]),
  retirement: RetirementPlan.nullable().default(null),
  debt: DebtPlan.nullable().default(null),
});
export type UserSettings = z.infer<typeof UserSettings>;

export const User = z.object({
  id: Id,
  email: z.email(),
  displayName: z.string().min(1),
  timezone: z.string().default('America/Chicago'),
  settings: UserSettings,
  createdAt: IsoDateTime,
});
export type User = z.infer<typeof User>;

export const Account = z.object({
  id: Id,
  name: z.string().min(1),
  kind: AccountKind,
  source: AccountSource,
  sourceAccountId: z.string().nullable(),
  institutionName: z.string().nullable(),
  mask: z.string().nullable(),
  currency: z.string().length(3).default('USD'),
  balanceCents: Cents,
  includeInNetWorth: z.boolean(),
  includeInBudget: z.boolean(),
  expectedPaymentCents: Cents.nullable(),
  paymentDay: z.int().min(1).max(31).nullable(),
  syncCadenceHours: z.int().positive().nullable(),
  lastSyncedAt: IsoDateTime.nullable(),
  archivedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type Account = z.infer<typeof Account>;

export const BalanceSnapshot = z.object({
  id: Id,
  accountId: Id,
  asOf: IsoDate,
  balanceCents: Cents,
  source: SnapshotSource,
  createdAt: IsoDateTime,
});
export type BalanceSnapshot = z.infer<typeof BalanceSnapshot>;

export const CategoryGroup = z.object({
  id: Id,
  name: z.string().min(1),
  kind: CategoryGroupKind,
  sortOrder: z.int(),
});
export type CategoryGroup = z.infer<typeof CategoryGroup>;

export const Category = z.object({
  id: Id,
  groupId: Id,
  name: z.string().min(1),
  emoji: z.string().nullable(),
  rolloverPolicy: RolloverPolicy,
  spendShape: SpendShape,
  isBill: z.boolean(),
  typicalPostDay: z.int().min(1).max(31).nullable(),
  archivedAt: IsoDateTime.nullable(),
  sortOrder: z.int(),
  /** SPEC §2.9: the plan for months with no allocation row, from `planDefaultFrom` on. */
  planDefaultCents: Cents.nullable(),
  planDefaultFrom: PeriodId.nullable(),
  /** H1: the one category a transaction with no real signal falls back to. Exactly one per user. */
  isCatchall: z.boolean(),
  /** Whether a split filed here counts as spending (pre-deploy-todo A4). Transfer-like
   * categories default to false; everything else defaults to true. */
  budgeted: z.boolean(),
});
export type Category = z.infer<typeof Category>;

export const Period = z.object({
  id: PeriodId,
  expectedIncomeCents: Cents,
});
export type Period = z.infer<typeof Period>;

export const Allocation = z.object({
  id: Id,
  periodId: PeriodId,
  categoryId: Id,
  plannedCents: Cents,
  carriedInCents: Cents,
});
export type Allocation = z.infer<typeof Allocation>;

export const Reallocation = z.object({
  id: Id,
  periodId: PeriodId,
  fromCategoryId: Id.nullable(),
  toCategoryId: Id.nullable(),
  amountCents: Cents.positive(),
  note: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type Reallocation = z.infer<typeof Reallocation>;

export const Split = z.object({
  id: Id,
  txnId: Id,
  categoryId: Id,
  amountCents: Cents,
  periodId: PeriodId,
  sortOrder: z.int(),
});
export type Split = z.infer<typeof Split>;

export const Transaction = z.object({
  id: Id,
  accountId: Id,
  postedAt: IsoDate,
  amountCents: Cents,
  descriptorRaw: z.string(),
  merchantNormalized: z.string(),
  merchantDisplay: z.string().nullable(),
  notes: z.string().nullable(),
  isPending: z.boolean(),
  isTransfer: z.boolean(),
  transferPairId: Id.nullable(),
  reviewState: ReviewState,
  suggestedCategoryId: Id.nullable(),
  suggestionConfidence: z.number().min(0).max(1),
  source: TxnSource,
  sourceId: z.string().nullable(),
  splits: z.array(Split),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Transaction = z.infer<typeof Transaction>;

export const Rule = z.object({
  id: Id,
  matchField: RuleMatchField,
  matchType: RuleMatchType,
  matchValue: z.string().min(1),
  categoryId: Id,
  priority: z.int(),
  createdAt: IsoDateTime,
});
export type Rule = z.infer<typeof Rule>;

export const MerchantMemory = z.object({
  merchantNormalized: z.string(),
  categoryId: Id,
  count: z.int().nonnegative(),
  lastUsedAt: IsoDateTime.nullable(),
});
export type MerchantMemory = z.infer<typeof MerchantMemory>;

export const MerchantMeta = z.object({
  merchantNormalized: z.string(),
  displayName: z.string().nullable(),
  suppressRuleOffer: z.boolean(),
  consecutiveSame: z.int().nonnegative(),
  consecutiveCategoryId: Id.nullable(),
});
export type MerchantMeta = z.infer<typeof MerchantMeta>;

export const RecurringSeries = z.object({
  /** `<userId>|<merchant>` — longer than `Id`'s 64 for any merchant over ~27 characters. */
  id: z.string().min(1),
  merchantNormalized: z.string(),
  categoryId: Id.nullable(),
  cadence: RecurringCadence,
  expectedAmountCents: Cents,
  nextExpectedDate: IsoDate.nullable(),
  status: RecurringStatus,
  updatedAt: IsoDateTime,
  /** 'manual' = Caleb's "Recurring Cash Withdrawal" tag; 'detected' = auto-detected (SPEC §7). */
  source: z.enum(['detected', 'manual']),
});
export type RecurringSeries = z.infer<typeof RecurringSeries>;

export const SyncRun = z.object({
  id: Id,
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
  status: SyncRunStatus,
  accountsTouched: z.int().nonnegative(),
  rowsInserted: z.int().nonnegative(),
  rowsUpdated: z.int().nonnegative(),
  errors: z.array(z.object({ accountId: Id.nullable(), message: z.string() })),
});
export type SyncRun = z.infer<typeof SyncRun>;

export const ImportBatch = z.object({
  id: Id,
  accountId: Id,
  filename: z.string(),
  format: ImportFormat,
  rowsTotal: z.int().nonnegative(),
  rowsImported: z.int().nonnegative(),
  rowsDuplicate: z.int().nonnegative(),
  createdAt: IsoDateTime,
});
export type ImportBatch = z.infer<typeof ImportBatch>;

export const AuditEntry = z.object({
  id: Id,
  action: AuditAction,
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  createdAt: IsoDateTime,
});
export type AuditEntry = z.infer<typeof AuditEntry>;
