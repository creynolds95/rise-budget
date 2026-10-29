import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { DetailPage } from '../components/detail/DetailPage';
import { Button } from '../components/primitives/Button';
import { Icon } from '../components/primitives/Icon';
import { ApiError, api } from '../lib/api';
import { useAccounts, useInvalidateMoney, useSyncStatus } from '../lib/queries';
import { syncNote, type SyncRunResult } from '../lib/syncOutcome';
import { transitionClick } from '../lib/transition';
import { WELCOME_STEPS, finishWelcome, saveStep, savedStep } from '../lib/welcome';

/** A button-styled link to the screen that does a step's real work. */
function Go({ to, children, quiet = false }: { to: string; children: ReactNode; quiet?: boolean }) {
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      onClick={transitionClick(navigate, to)}
      className={`inline-flex min-h-11 items-center rounded-button px-4 type-body font-medium ${
        quiet ? 'text-sage-700 active:bg-sage-100' : 'bg-sage-600 text-surface active:bg-sage-700'
      }`}
    >
      {children}
    </Link>
  );
}

function BanksStep() {
  const status = useSyncStatus().data;
  const accounts = useAccounts().data;
  const invalidate = useInvalidateMoney();
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => api<SyncRunResult>('POST', '/sync/run', {}),
    onSuccess: (r) => {
      setNote(syncNote(r).text);
      return Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['sync'] })]);
    },
    onError: (e) => setNote(e instanceof ApiError ? e.message : 'Sync failed.'),
  });
  const live = (accounts ?? []).filter((a) => !a.archivedAt).length;
  if (status?.mode === 'off') {
    return (
      <>
        <p>
          Link your banks in SimpleFIN Bridge, then claim its setup token from the computer you
          installed Rise from: <code className="type-caption">pnpm simplefin:claim --yes</code>
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Go to="/settings/sync">Bank connection</Go>
        </div>
      </>
    );
  }
  return (
    <>
      <p>
        {live > 0
          ? `${live} ${live === 1 ? 'account' : 'accounts'} found. Sync again any time.`
          : 'Connected. Pull your accounts in now.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={run.isPending || !status} onClick={() => run.mutate()}>
          {run.isPending ? 'Syncing…' : 'Sync now'}
        </Button>
        {note && <span className="text-ink-muted">{note}</span>}
      </div>
    </>
  );
}

const STEPS: { title: string; body: () => ReactNode }[] = [
  { title: 'Connect your banks', body: () => <BanksStep /> },
  {
    title: 'Add what doesn’t sync',
    body: () => (
      <>
        <p>
          Loans, cash and anything SimpleFIN can’t reach go in by hand. Give each loan its rate and
          payment so payoff dates are real.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Go to="/accounts">Accounts</Go>
          <Go to="/financial-health/debt" quiet>
            Debts
          </Go>
        </div>
      </>
    ),
  },
  {
    title: 'Choose your spending cash',
    body: () => (
      <>
        <p>
          Surplus is the cash on hand until your next paycheck. Pick the checking account your pay
          lands in and the cushion to keep.
        </p>
        <div className="mt-4">
          <Go to="/cash-to-payday">Surplus</Go>
        </div>
      </>
    ),
  },
  {
    title: 'Shape your budget',
    body: () => (
      <>
        <p>
          Starter categories are in. Rename or add your own, then give each a monthly plan. Mark the
          ones whose leftovers should carry into next month.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Go to="/budget">Budget</Go>
          <Go to="/settings/categories" quiet>
            Categories
          </Go>
        </div>
      </>
    ),
  },
];

/** The first-run guide: four steps, each pointing at the screen that does the real work. */
export function Welcome() {
  const navigate = useNavigate();
  const [step, setStep] = useState(savedStep);
  if (STEPS.length !== WELCOME_STEPS) throw new Error('Welcome: step count drifted');
  const go = (n: number) => {
    setStep(n);
    saveStep(n);
  };
  const finish = () => {
    finishWelcome();
    navigate('/', { replace: true });
  };
  const current = (STEPS[step] ?? STEPS[0]) as (typeof STEPS)[number];
  const last = step === STEPS.length - 1;

  return (
    <DetailPage
      header={{
        back: { label: 'Dashboard', to: '/' },
        title: 'Set up Rise',
        action: (
          <button
            type="button"
            onClick={finish}
            className="min-h-11 px-2 font-medium text-ink-muted active:text-ink"
          >
            Skip
          </button>
        ),
      }}
      facts={
        <div className="py-4">
          <ol className="flex gap-1.5" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex-1">
                <button
                  type="button"
                  onClick={() => go(i)}
                  aria-label={`Step ${i + 1}: ${s.title}`}
                  aria-current={i === step ? 'step' : undefined}
                  className={`block h-1.5 w-full rounded-full ${i <= step ? 'bg-sage-600' : 'bg-hairline'}`}
                />
              </li>
            ))}
          </ol>
          <section className="mt-6">
            <p className="type-label text-ink-muted">
              Step <span className="money">{step + 1}</span> of{' '}
              <span className="money">{STEPS.length}</span>
            </p>
            <h2 className="mt-1 type-title">{current.title}</h2>
            <div className="mt-3">{current.body()}</div>
          </section>
          <div className="mt-6 flex items-center justify-between">
            <Button variant="quiet" disabled={step === 0} onClick={() => go(step - 1)}>
              Back
            </Button>
            {last ? (
              <Button onClick={finish}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon name="check" size={18} /> Done
                </span>
              </Button>
            ) : (
              <Button onClick={() => go(step + 1)}>Next</Button>
            )}
          </div>
        </div>
      }
    />
  );
}
