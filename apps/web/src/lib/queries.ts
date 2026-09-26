import type { DevicesResponse } from '@rise/shared/schemas';
import type {
  CashFlowReport,
  Category,
  CategoryGroup,
  MoneyFlowReport,
  RecurringSeries,
  Rule,
  SpendingReport,
  Transaction,
  User,
} from '@rise/shared/schemas';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api, get } from './api';
import { localToday } from './dates';
import type {
  AccountWithStaleness,
  CashToPaydayResponse,
  ManualCashEvent,
  NetWorthResponse,
  PatchedTransaction,
  PeriodResponse,
  SyncStatus,
  TransactionPage,
} from './types';

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => get<User>('/me'), staleTime: 5 * 60_000 });

/** T46: whether the nightly backup is actually running, for Settings. */
export const useBackupStatus = () =>
  useQuery({
    queryKey: ['backups'],
    queryFn: () =>
      get<{ latest: { date: string; bytes: number } | null; count: number }>('/export/backups'),
    staleTime: 60_000,
  });

/** C17: passkeys and signed-in devices, for Settings > Security. */
export const useDevices = () =>
  useQuery({ queryKey: ['devices'], queryFn: () => get<DevicesResponse>('/devices') });

/** Today in the user's own timezone. */
export function useToday(): string {
  return localToday(useMe().data?.timezone);
}

export const useAccounts = () =>
  useQuery({ queryKey: ['accounts'], queryFn: () => get<AccountWithStaleness[]>('/accounts') });
export const useGroups = () =>
  useQuery({ queryKey: ['groups'], queryFn: () => get<CategoryGroup[]>('/category-groups') });
export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => get<Category[]>('/categories') });
export const useRules = () =>
  useQuery({ queryKey: ['rules'], queryFn: () => get<Rule[]>('/rules') });
export const useRecurring = () =>
  useQuery({ queryKey: ['recurring'], queryFn: () => get<RecurringSeries[]>('/recurring') });
export const useSyncStatus = () =>
  useQuery({ queryKey: ['sync'], queryFn: () => get<SyncStatus>('/sync/status') });
export const useCashToPayday = () =>
  useQuery({
    queryKey: ['cash-to-payday'],
    queryFn: () => get<CashToPaydayResponse>('/cash-to-payday'),
  });
export const useManualCashEvents = () =>
  useQuery({
    queryKey: ['cash-to-payday', 'manual-events'],
    queryFn: () => get<ManualCashEvent[]>('/cash-to-payday/manual-events'),
  });

export const usePeriod = (id: string) =>
  useQuery({
    queryKey: ['period', id],
    queryFn: () => get<PeriodResponse>(`/periods/${id}`),
    placeholderData: keepPreviousData,
  });

/** T41: per-day spending for this and last month, and the last six months' totals. */
export const useSpendingReport = (month: string) =>
  useQuery({
    queryKey: ['reports', 'spending', month],
    queryFn: () => get<SpendingReport>(`/reports/spending?month=${month}`),
    placeholderData: keepPreviousData,
  });

/** The Budget tab's "money flow" screen: income → expense groups → categories. */
export const useMoneyFlow = (month: string) =>
  useQuery({
    queryKey: ['reports', 'money-flow', month],
    queryFn: () => get<MoneyFlowReport>(`/reports/money-flow?month=${month}`),
    placeholderData: keepPreviousData,
  });

/** Reports tab's Cash Flow "Bar" option: income vs. expense for the last six months. */
export const useCashFlowReport = (month: string) =>
  useQuery({
    queryKey: ['reports', 'cash-flow', month],
    queryFn: () => get<CashFlowReport>(`/reports/cash-flow?month=${month}`),
    placeholderData: keepPreviousData,
  });

export const useTransaction = (id: string) =>
  useQuery({ queryKey: ['txn', id], queryFn: () => get<Transaction>(`/transactions/${id}`) });

/** Query-string filters, exactly as `GET /transactions` takes them. */
export type TxnFilters = Partial<
  Record<
    | 'q'
    | 'account'
    | 'category'
    | 'reviewState'
    | 'from'
    | 'to'
    | 'direction'
    | 'min'
    | 'max'
    | 'sort',
    string
  >
>;

export function useTransactions(f: TxnFilters) {
  return useInfiniteQuery({
    queryKey: ['txns', f],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
      if (pageParam) qs.set('cursor', pageParam);
      return get<TransactionPage>(`/transactions?${qs}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export const useNetWorth = (from: string, to: string) =>
  useQuery({
    queryKey: ['networth', from, to],
    queryFn: () => get<NetWorthResponse>(`/networth?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
  });

/** Anything touching money or transactions refreshes every view derived from them. */
export function useInvalidateMoney() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      [
        'period',
        'txns',
        'txn',
        'accounts',
        'recurring',
        'networth',
        'categories',
        'groups',
        'cash-to-payday',
        'reports',
      ].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    );
}

export function usePatchTransaction() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      categoryId?: string;
      notes?: string | null;
      reviewState?: 'reviewed' | 'needs_review';
    }) => api<PatchedTransaction>('PATCH', `/transactions/${id}`, body),
    onSuccess: invalidate,
  });
}
