import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { LockGate } from './components/LockGate';
import { OfflineBar } from './components/OfflineBar';
import { Shell } from './components/Shell';
import { Skeleton } from './components/primitives/Skeleton';
import { useAuth } from './lib/auth';
import { useLinkTransitions } from './lib/gestures';
import { AccountDetail } from './routes/AccountDetail';
import { Accounts } from './routes/Accounts';
import { Budget } from './routes/Budget';
import { FinancialHealth } from './routes/FinancialHealth';
import { CashToPayday } from './routes/CashToPayday';
import { CategoryDetail } from './routes/CategoryDetail';
import { Dashboard } from './routes/Dashboard';
import { Login, Register } from './routes/Login';
import { Recurring } from './routes/Recurring';
import { Review } from './routes/Review';
import { Settings, SettingsSection } from './routes/Settings';
import { TransactionDetail } from './routes/TransactionDetail';
import { Transactions } from './routes/Transactions';

// The planning pages are rarely opened, so they load on first visit; the service worker
// precaches their chunks with the rest of the shell, so they still open offline.
const Retirement = lazy(() =>
  import('./routes/Retirement').then((m) => ({ default: m.Retirement })),
);
const Debt = lazy(() => import('./routes/Debt').then((m) => ({ default: m.Debt })));
const Mortgage = lazy(() => import('./routes/Mortgage').then((m) => ({ default: m.Mortgage })));
const Savings = lazy(() => import('./routes/Savings').then((m) => ({ default: m.Savings })));
const Taxes = lazy(() => import('./routes/Taxes').then((m) => ({ default: m.Taxes })));

/** Stand-in while a split-off page's code loads. */
export function PageFallback() {
  return (
    <div className="gutter mx-auto max-w-2xl pt-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-6 h-24 w-full" />
      <Skeleton className="mt-4 h-40 w-full" />
    </div>
  );
}

const Later = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<PageFallback />}>{children}</Suspense>
);

export function App() {
  const { status } = useAuth();
  useLinkTransitions();
  if (status === 'loading') {
    return (
      <div className="gutter mx-auto max-w-2xl pt-16">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="mt-6 h-24 w-full" />
      </div>
    );
  }
  if (status === 'signedOut') {
    return (
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <LockGate>
      <OfflineBar />
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="budget" element={<Budget />} />
          <Route path="settings" element={<Settings />} />
          <Route path="review" element={<Review />} />
          <Route path="recurring" element={<Recurring />} />
          <Route path="accounts/:id" element={<AccountDetail />} />
          <Route path="transactions/:id" element={<TransactionDetail />} />
          <Route path="budget/:categoryId" element={<CategoryDetail />} />
          <Route path="cash-to-payday" element={<CashToPayday />} />
          <Route path="financial-health" element={<FinancialHealth />} />
          <Route
            path="financial-health/retirement"
            element={
              <Later>
                <Retirement />
              </Later>
            }
          />
          <Route
            path="financial-health/debt"
            element={
              <Later>
                <Debt />
              </Later>
            }
          />
          <Route
            path="financial-health/mortgage"
            element={
              <Later>
                <Mortgage />
              </Later>
            }
          />
          <Route
            path="financial-health/savings"
            element={
              <Later>
                <Savings />
              </Later>
            }
          />
          <Route
            path="financial-health/taxes"
            element={
              <Later>
                <Taxes />
              </Later>
            }
          />
          <Route path="reports" element={<Navigate to="/settings/reports" replace />} />
          <Route path="settings/:section" element={<SettingsSection />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LockGate>
  );
}
