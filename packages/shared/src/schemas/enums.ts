import { z } from 'zod';

export const AccountKind = z.enum(['depository', 'credit', 'loan', 'investment', 'other']);
export type AccountKind = z.infer<typeof AccountKind>;

export const AccountSource = z.enum(['simplefin', 'manual']);
export type AccountSource = z.infer<typeof AccountSource>;

export const CategoryGroupKind = z.enum(['income', 'expense']);
export type CategoryGroupKind = z.infer<typeof CategoryGroupKind>;

export const RolloverPolicy = z.enum(['roll', 'return_to_pool']);
export type RolloverPolicy = z.infer<typeof RolloverPolicy>;

export const SpendShape = z.enum(['linear', 'fixed']);
export type SpendShape = z.infer<typeof SpendShape>;

export const PeriodStatus = z.enum(['open', 'closed']);
export type PeriodStatus = z.infer<typeof PeriodStatus>;

export const ReviewState = z.enum(['needs_review', 'reviewed', 'dropped']);
export type ReviewState = z.infer<typeof ReviewState>;

export const TxnSource = z.enum(['simplefin', 'ofx', 'csv', 'manual']);
export type TxnSource = z.infer<typeof TxnSource>;

export const RuleMatchField = z.enum(['descriptor', 'merchant']);
export type RuleMatchField = z.infer<typeof RuleMatchField>;
export const RuleMatchType = z.enum(['contains', 'equals', 'regex']);
export type RuleMatchType = z.infer<typeof RuleMatchType>;

export const RecurringCadence = z.enum(['weekly', 'biweekly', 'monthly', 'annual']);
export const RecurringStatus = z.enum(['active', 'broken', 'ended']);

export const SyncRunStatus = z.enum(['running', 'ok', 'partial', 'failed']);
export const ImportFormat = z.enum(['csv', 'ofx', 'qfx']);
export const SnapshotSource = z.enum(['manual', 'sync']);

export const AppLock = z.enum(['off', 'immediate', '5m', '1h']);
export type AppLock = z.infer<typeof AppLock>;

export const AuditAction = z.enum([
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.passkey_added',
  'auth.totp_enabled',
  'auth.recovery_generated',
  'auth.recovery_used',
  'auth.refresh_reuse_detected',
  'period.closed',
  'period.recalculated',
  'category.deficit_forgiven',
  'rule.created',
  'rule.deleted',
  'account.linked',
  'account.unlinked',
  'data.exported',
]);
export type AuditAction = z.infer<typeof AuditAction>;
