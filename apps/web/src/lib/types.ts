/**
 * Response shapes. Entities come from the shared Zod schemas; these only add what routes
 * compose around them.
 */
import type { PeriodView, Staleness } from '@rise/shared/budget';
import type { NetWorthPoint } from '@rise/shared/networth';
import type { Account, Period, RuleOffer, Transaction } from '@rise/shared/schemas';

export type AccountWithStaleness = Account & { staleness: Staleness };

export interface CloseStatus {
  ended: boolean;
  readiness: {
    ready: boolean;
    waitingOn: { accountId: string; name: string; lastSyncedDate: string | null }[];
  };
}

export type PeriodResponse = { period: Period; close: CloseStatus } & Omit<
  PeriodView,
  'periodId' | 'status'
>;

export interface TransactionPage {
  items: Transaction[];
  nextCursor: string | null;
}

export type PatchedTransaction = Transaction & { ruleOffer: RuleOffer | null };

export interface NetWorthResponse {
  from: string;
  to: string;
  points: NetWorthPoint[];
}

export interface SyncStatus {
  mode: 'live' | 'mock' | 'off';
  runs: {
    id: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    accountsTouched: number;
    rowsInserted: number;
    rowsUpdated: number;
    errors: { accountId: string | null; message: string }[];
  }[];
}

export interface MerchantView {
  merchantNormalized: string;
  displayName: string | null;
  suppressRuleOffer: boolean;
  topCategoryIds: string[];
}

export interface CashToPaydayResponse {
  points: { date: string; balanceCents: number; label: string }[];
  lowestPoint: { date: string; balanceCents: number; label: string };
  freeToMoveCents: number;
  paySchedules: {
    merchant: string;
    displayName: string;
    series: {
      cadence: string;
      expectedAmountCents: number;
      nextExpectedDate: string;
      anchorDays: [number, number] | null;
    };
    isManual: boolean;
  }[];
  cashAccounts: { id: string; name: string }[];
  cushionCents: number;
}

export interface ManualCashEvent {
  id: string;
  label: string;
  kind: 'income' | 'expense';
  amountCents: number;
  cadence: string;
  nextExpectedDate: string;
}
