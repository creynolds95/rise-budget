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
  'RATE_LIMITED',
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
  rollIncomeVariance: z.boolean().optional(),
  appLock: AppLock.optional(),
});

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

export const RunSyncBody = z.object({
  /** Backfill from this date instead of the usual window. */
  since: IsoDate.optional(),
});

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

export const PatchMerchantBody = z.object({
  /** Rename; applies to every past and future transaction. Null clears it. */
  displayName: z.string().trim().min(1).max(100).nullable().optional(),
  /** "No" to a rule offer. */
  suppressRuleOffer: z.boolean().optional(),
});

/** SPEC §4.6: returned after the third identical categorisation. Yes → POST /rules. */
export const RuleOffer = z.object({ merchant: z.string(), categoryId: Id });
export type RuleOffer = z.infer<typeof RuleOffer>;

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
  sortOrder: z.int().default(0),
});
