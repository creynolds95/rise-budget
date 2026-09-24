import { Navigate, Route, Routes } from 'react-router';
import { LockGate } from './components/LockGate';
import { OfflineBar } from './components/OfflineBar';
import { Shell } from './components/Shell';
import { Skeleton } from './components/primitives/Skeleton';
import { useAuth } from './lib/auth';
import { AccountDetail } from './routes/AccountDetail';
import { Accounts } from './routes/Accounts';
import { Budget } from './routes/Budget';
import { CashToPayday } from './routes/CashToPayday';
import { CategoryDetail } from './routes/CategoryDetail';
import { Dashboard } from './routes/Dashboard';
import { Login, Register } from './routes/Login';
import { Review } from './routes/Review';
import { Settings, SettingsSection } from './routes/Settings';
import { TransactionDetail } from './routes/TransactionDetail';
import { Transactions } from './routes/Transactions';

export function App() {
  const { status } = useAuth();
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
        </Route>
        <Route path="review" element={<Review />} />
        <Route path="accounts/:id" element={<AccountDetail />} />
        <Route path="transactions/:id" element={<TransactionDetail />} />
        <Route path="budget/:categoryId" element={<CategoryDetail />} />
        <Route path="cash-to-payday" element={<CashToPayday />} />
        <Route path="settings/:section" element={<SettingsSection />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LockGate>
  );
}
