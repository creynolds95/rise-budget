import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { LockGate } from './components/LockGate';
import { OfflineBar } from './components/OfflineBar';
import { Shell } from './components/Shell';
import { Skeleton } from './components/primitives/Skeleton';
import { useAuth } from './lib/auth';
import { useAppBadge } from './lib/badge';
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

/**
 * A split-off page. Once its code is in it renders straight away, without suspending, so a
 * screen slide (lib/transition.ts) never starts on the placeholder.
 */
function lazyPage(load: () => Promise<ComponentType>) {
  let Loaded: ComponentType | undefined;
  const preload = () => load().then((C) => (Loaded = C));
  const Lazy = lazy(() => preload().then((C) => ({ default: C })));
  function Page() {
    // Fixed for the life of the screen, so one that opened lazily never remounts.
    const [Screen] = useState(() => Loaded ?? Lazy);
    return <Screen />;
  }
  return Object.assign(Page, { preload });
}

// The planning pages are rarely opened, so they aren't in the main bundle; they load once the
// app is idle after signing in. The service worker precaches their chunks with the rest of the
// shell, so they still open offline.
const Retirement = lazyPage(() => import('./routes/Retirement').then((m) => m.Retirement));
const Debt = lazyPage(() => import('./routes/Debt').then((m) => m.Debt));
const Mortgage = lazyPage(() => import('./routes/Mortgage').then((m) => m.Mortgage));
const Savings = lazyPage(() => import('./routes/Savings').then((m) => m.Savings));
const Binder = lazyPage(() => import('./routes/Binder').then((m) => m.Binder));
const Taxes = lazyPage(() => import('./routes/Taxes').then((m) => m.Taxes));
const PLANNING = [Retirement, Debt, Mortgage, Savings, Binder, Taxes];
const Welcome = lazy(() => import('./routes/Welcome').then((m) => ({ default: m.Welcome })));

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

/** Mounted only when signed in, so the badge query never fires on the login screen. */
function BadgeKeeper() {
  useAppBadge();
  return null;
}

/** Loads the planning pages' code a few seconds after the signed-in app opens. */
function PlanningPreload() {
  useEffect(() => {
    const t = window.setTimeout(() => PLANNING.forEach((p) => void p.preload()), 3000);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}

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
      <BadgeKeeper />
      <PlanningPreload />
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
            path="financial-health/binder"
            element={
              <Later>
                <Binder />
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
          <Route
            path="welcome"
            element={
              <Later>
                <Welcome />
              </Later>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LockGate>
  );
}
