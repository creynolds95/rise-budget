import { z } from 'zod';
import { Cents, Id, IsoDate, PeriodId } from './primitives';
import {
  AccountKind,
  ReviewState,
  RolloverPolicy,
  RuleMatchField,
  RuleMatchType,
  SpendShape,
} from './enums';
import { UserSettings } from './entities';

// ── error contract (ARCHITECTURE §4) ──────────────────────────────────────────

export const ErrorCode = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INSUFFICIENT_POOL',
  'SPLITS_DO_NOT_SUM',
  'PERIOD_NOT_ENDED',
  'PERIOD_NOT_READY',
  'PERIOD_CLOSED',
  'NOTHING_TO_FORGIVE',
  'AMOUNT_MISMATCH',
  'IDEMPOTENCY_CONFLICT',
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

export const PatchSettingsBody = UserSettings.partial();

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

export const PatchAccountBody = CreateAccountBody.partial().extend({
  syncCadenceHours: z.int().positive().nullable().optional(),
});

export const CreateSnapshotBody = z.object({ asOf: IsoDate, balanceCents: Cents });

export const SplitInput = z.object({ categoryId: Id, amountCents: Cents });
export type SplitInput = z.infer<typeof SplitInput>;

export const ReplaceSplitsBody = z.object({ splits: z.array(SplitInput).min(1) });

export const PatchTransactionBody = z.object({
  categoryId: Id.optional(),
  notes: z.string().nullable().optional(),
  merchantDisplay: z.string().nullable().optional(),
  reviewState: ReviewState.optional(),
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

export const PatchPeriodBody = z.object({ expectedIncomeCents: Cents.nonnegative() });

export const ClosePeriodBody = z.object({
  /** Close even though some accounts haven't reported past period end (edge 10c). */
  override: z.boolean().default(false),
});

export const FundingSource = z.object({ fromCategoryId: Id, amountCents: Cents.positive() });
export type FundingSource = z.infer<typeof FundingSource>;

export const PatchAllocationBody = z.object({
  plannedCents: Cents.nonnegative(),
  funding: z.array(FundingSource).default([]),
  note: z.string().max(500).optional(),
});

export const CreateCategoryBody = z.object({
  groupId: Id,
  name: z.string().min(1),
  emoji: z.string().nullable().default(null),
  isBill: z.boolean().default(false),
  /** Omitted → smart default from `isBill` (SPEC §2.2). */
  rolloverPolicy: RolloverPolicy.optional(),
  spendShape: SpendShape.optional(),
});
export type CreateCategoryBody = z.infer<typeof CreateCategoryBody>;

export const PatchCategoryBody = z.object({
  name: z.string().min(1).optional(),
  groupId: Id.optional(),
  rolloverPolicy: RolloverPolicy.optional(),
  spendShape: SpendShape.optional(),
  isBill: z.boolean().optional(),
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

export const TransactionQuery = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  account: Id.optional(),
  category: Id.optional(),
  q: z.string().optional(),
  reviewState: ReviewState.optional(),
  cursor: z.string().optional(),
});

export const PeriodParam = z.object({ id: PeriodId });
