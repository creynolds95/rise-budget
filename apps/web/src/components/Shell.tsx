import { Link, NavLink, Outlet } from 'react-router';
import { useMe } from '../lib/queries';
import { TABS, type Tab } from '../routes/table';

const ICON: Record<Tab, string> = {
  dashboard: 'M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-4H4zm10-11h6V4h-6z',
  accounts: 'M3 9l9-5 9 5M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18',
  transactions: 'M5 7h14M5 12h14M5 17h9',
  budget: 'M4 7h16M4 12h10M4 17h6',
};

/** Four tabs and an avatar. No drawer (§4). */
export function Shell() {
  const me = useMe().data;
  const initials = (me?.displayName ?? '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="min-h-dvh pb-[calc(64px+env(safe-area-inset-bottom))]">
      <div className="gutter mx-auto flex max-w-2xl items-center justify-between pt-[max(12px,env(safe-area-inset-top))]">
        <span className="font-serif text-xl tracking-tight text-sage-700">Rise</span>
        <Link
          to="/settings"
          aria-label="Settings"
          className="flex size-11 items-center justify-center rounded-full bg-sage-100 type-caption font-semibold text-sage-700"
        >
          {initials || '•'}
        </Link>
      </div>
      <main>
        <Outlet />
      </main>
      <nav
        aria-label="Tabs"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-4">
          {TABS.map((t) => (
            <li key={t.tab}>
              <NavLink
                to={t.path}
                end={t.path === '/'}
                className={({ isActive }) =>
                  `flex min-h-14 flex-col items-center justify-center gap-0.5 type-caption ${
                    isActive ? 'font-semibold text-sage-700' : 'text-ink-muted'
                  }`
                }
              >
                <svg
                  aria-hidden
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  className="fill-none stroke-current"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={ICON[t.tab]} />
                </svg>
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
