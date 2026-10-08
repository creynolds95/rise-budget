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
  ChargeFlag,
  RolloverPolicy,
  RuleMatchField,
  RuleMatchType,
  SnapshotSource,
  SpendShape,
  SyncRunStatus,
  TaxKind,
  TxnSource,
} from './enums';

/** Entity shapes as the API speaks them (camelCase, booleans as booleans). */

/** Dashboard tiles a user can show, hide and reorder. */
export const DASHBOARD_TILES = [
  'review',
  'surplus',
  'budget',
  'spending',
  'transactions',
  'netWorth',
  'comingUp',
  'investments',
  'savings',
  'retirement',
  'debt',
  'mortgageSchedule',
  'mortgageYear',
] as const;
export const DashboardTile = z.enum(DASHBOARD_TILES);
export type DashboardTile = z.infer<typeof DashboardTile>;

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
  /** Yearly swing in returns for the Monte Carlo fan, basis points. */
  volatilityBps: z.int().min(0).max(5000).default(1500),
  /** Monthly benefit at full retirement age (67) from the owner's ssa.gov statement; 0 = none. */
  ssBenefitCents: Cents.min(0).default(0),
  ssClaimAge: z.int().min(62).max(70).default(67),
  /** A spouse's own age and statement, for their check (or half the owner's, if more). */
  spouse: z
    .object({
      age: z.int().min(18).max(100),
      ssBenefitCents: Cents.min(0).default(0),
      ssClaimAge: z.int().min(62).max(70).default(67),
    })
    .nullable()
    .default(null),
  /** Share of promised benefits to count on, for anyone who'd rather plan on a cut. */
  ssHaircutPct: z.int().min(0).max(100).default(100),
  /** One-time money in (positive) or out (negative) at the owner's age, today's dollars. */
  lifeEvents: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        age: z.int().min(18).max(100),
        cents: Cents,
      }),
    )
    .max(30)
    .default([]),
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
  /** What the payment's debit looks like ("mohela"). Any matching debit applies the month,
   * whatever the amount; empty falls back to matching the payment amount exactly. */
  merchant: z
    .string()
    .trim()
    .toLowerCase()
    .max(60)
    .refine((m) => m === '' || m.length >= 3, 'At least 3 characters')
    .default(''),
});
export type DebtLoanPlan = z.infer<typeof DebtLoanPlan>;

/** What the last automatic apply did, so the Debt page can say so and undo it. */
export const DebtAutoRun = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
  /** What left checking, against what the plan said; shown when they differ. */
  debitCents: Cents.min(0).default(0),
  plannedCents: Cents.min(0).default(0),
  loans: z.array(
    z.object({
      accountId: Id,
      beforeCents: Cents.min(0),
      afterCents: Cents.min(0),
      /** The day the balance was written; undo rewrites the same day. */
      asOf: IsoDate,
      prevApplied: z.string().regex(/^\d{4}-\d{2}$/),
    }),
  ),
});
export type DebtAutoRun = z.infer<typeof DebtAutoRun>;

export const DebtPlan = z.object({
  loans: z.array(DebtLoanPlan).default([]),
  /** Apply a month's payments on their own once the matching debit posts. */
  autoApply: z.boolean().default(true),
  lastAuto: DebtAutoRun.nullable().default(null),
  strategy: z.enum(['snowball', 'avalanche']).default('snowball'),
  /** A finished loan's payment moves on to the next loan. */
  rollForward: z.boolean().default(true),
  /** Extra per month, split by strategy across the student loans only. */
  extraCents: Cents.min(0).default(0),
  mortgageExtraCents: Cents.min(0).default(0),
  /** One-time extra principal toward the mortgage, by the month it goes in. */
  mortgageLumps: z
    .array(z.object({ period: PeriodId, cents: Cents.min(1) }))
    .max(240)
    .default([]),
  /** Original term; payments already made are the term less what remains. */
  mortgageTermMonths: z.int().min(12).max(600).default(360),
  /** Manual account whose balance is the home's value, for equity. */
  homeValueAccountId: Id.nullable().default(null),
});
export type DebtPlan = z.infer<typeof DebtPlan>;

/** One savings goal. Saved is the linked account's balance, or a hand-set share of it. */
export const SavingsGoal = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  accountId: Id,
  /** Used when kind is 'goal'; an emergency fund derives it from months × expenses. */
  targetCents: Cents.min(0),
  /** What goes in each month, for the projected date. A what-if, not a rule. */
  monthlyCents: Cents.min(0),
  /** Share of the account that counts toward this goal; null = the whole balance. */
  savedCents: Cents.min(0).nullable().default(null),
  kind: z.enum(['goal', 'emergency']).default('goal'),
  /** Emergency fund only. */
  months: z.int().min(1).max(36).default(6),
  monthlyExpenseCents: Cents.min(0).default(0),
});
export type SavingsGoal = z.infer<typeof SavingsGoal>;

export const SavingsPlan = z.object({ goals: z.array(SavingsGoal).max(50).default([]) });
export type SavingsPlan = z.infer<typeof SavingsPlan>;

/** Most log entries kept; far above what a 45-day window ever holds. */
export const FOLLOW_LOG_MAX = 1000;

/** A manual account whose balance follows matching rows in other accounts (Apple Savings). */
export const FollowRule = z.object({
  accountId: Id,
  /** Text to find in the row's descriptor or merchant. */
  match: z.string().trim().toLowerCase().min(3).max(60),
  /** Only rows posted on or after this day are followed, so history never changes. */
  since: IsoDate,
});
export type FollowRule = z.infer<typeof FollowRule>;

/** What a rule did to a balance, kept so it can be undone and never applied twice. */
export const FollowEntry = z.object({
  txnId: Id,
  accountId: Id,
  deltaCents: z.int(),
  /** The day the balance was written. */
  asOf: IsoDate,
  undone: z.boolean().default(false),
});
export type FollowEntry = z.infer<typeof FollowEntry>;

export const FollowSettings = z.object({
  rules: z.array(FollowRule).max(20).default([]),
  /** Newest last. Entries older than the sync window are pruned by date (never by count,
   * which could let a row drop out of the log while still inside the window and be
   * followed twice); the cap only bounds the settings size. */
  log: z.array(FollowEntry).max(FOLLOW_LOG_MAX).default([]),
});
export type FollowSettings = z.infer<typeof FollowSettings>;

/** Which quiet notices show (SPEC §8.1). Each is the owner's choice; all on to start. */
export const AlertSettings = z.object({
  priceUp: z.boolean().default(true),
  doubleCharge: z.boolean().default(true),
  duplicate: z.boolean().default(true),
  unusual: z.boolean().default(true),
  firstTime: z.boolean().default(true),
});
export type AlertSettings = z.infer<typeof AlertSettings>;
const ALERTS_ON: AlertSettings = {
  priceUp: true,
  doubleCharge: true,
  duplicate: true,
  unusual: true,
  firstTime: true,
};

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
  /** Missed-charge notes dismissed from the Dashboard, by series and the due date missed. A
   * later miss of the same series is a new note. */
  dismissedMisses: z
    .array(z.object({ seriesId: z.string(), dueDate: IsoDate }))
    .max(200)
    .default([]),
  /** Shown tiles in order; null until the user customizes, which keeps the stock layout. */
  dashboard: z.array(DashboardTile).max(DASHBOARD_TILES.length).nullable().default(null),
  retirement: RetirementPlan.nullable().default(null),
  debt: DebtPlan.nullable().default(null),
  savings: SavingsPlan.nullable().default(null),
  follow: FollowSettings.default({ rules: [], log: [] }),
  alerts: AlertSettings.default(ALERTS_ON),
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

/** Outline symbols a user can pick for an account Rise has no logo for. Each name is also an
 *  icon in the web app's Icon set (the editor renders them, so a missing one fails typecheck). */
export const BADGE_ICONS = [
  'home',
  'building',
  'car',
  'bank',
  'card',
  'wallet',
  'coins',
  'chart',
  'briefcase',
  'cap',
  'shield',
  'doc',
] as const;
export const AccountBadgeIcon = z.enum(BADGE_ICONS);
export type AccountBadgeIcon = z.infer<typeof AccountBadgeIcon>;

/** A badge the user chose for an account Rise has no logo for: a symbol, or their own letters
 *  on a color (#rrggbb). */
export const AccountBadgeStyle = z.union([
  z.object({ icon: AccountBadgeIcon }),
  z.object({
    text: z.string().trim().min(1).max(4),
    bg: z.string().regex(/^#[0-9a-f]{6}$/i),
    fg: z.string().regex(/^#[0-9a-f]{6}$/i),
  }),
]);
export type AccountBadgeStyle = z.infer<typeof AccountBadgeStyle>;

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
  badge: AccountBadgeStyle.nullable().default(null),
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
  /** Totals into the year-end tax pack under this heading. */
  taxKind: TaxKind.nullable().default(null),
});
export type Category = z.infer<typeof Category>;

/** A label that cuts across categories: a trip, a project, a side gig. */
export const Tag = z.object({
  id: Id,
  name: z.string().min(1).max(40),
  taxKind: TaxKind.nullable(),
  createdAt: IsoDateTime,
});
export type Tag = z.infer<typeof Tag>;

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
  refundOfId: Id.nullable(),
  reviewState: ReviewState,
  suggestedCategoryId: Id.nullable(),
  suggestionConfidence: z.number().min(0).max(1),
  source: TxnSource,
  sourceId: z.string().nullable(),
  splits: z.array(Split),
  tagIds: z.array(Id).default([]),
  /** A quiet flag until the user says it's fine (SPEC §8.1). */
  flag: ChargeFlag.nullable().default(null),
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
  /** 'manual' = the owner's "Recurring Cash Withdrawal" tag; 'detected' = auto-detected (SPEC §7). */
  source: z.enum(['detected', 'manual']),
  /** Subscription radar (SPEC §7.1), each only for a while after it happened. */
  previousAmountCents: Cents.nullable().default(null),
  priceChangedOn: IsoDate.nullable().default(null),
  doubleChargedOn: IsoDate.nullable().default(null),
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
