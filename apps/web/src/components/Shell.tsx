import { Link, NavLink, Outlet } from 'react-router';
import { useMe } from '../lib/queries';
import { TABS, type Tab } from '../routes/table';

const ICON: Record<Tab, string> = {
  dashboard: 'M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-4H4zm10-11h6V4h-6z',
  accounts: 'M3 9l9-5 9 5M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18',
  transactions: 'M5 7h14M5 12h14M5 17h9',
  budget: 'M6 20V10M12 20V4M18 20v6',
};

/**
 * Four tabs and an avatar. No drawer (§4). Below `lg` these are a bottom tab bar, as on
 * phone; at `lg` and up they become a persistent left sidebar (H5) — desktop has the width
 * for it to stay visible instead of scrolling out of reach, and a mouse has no thumb-reach
 * reason to keep navigation at the bottom of the screen.
 */
export function Shell() {
  const me = useMe().data;
  const initials = (me?.displayName ?? '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="min-h-dvh pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-72">
      {/* `fixed` rather than `sticky`: pinned to the viewport regardless of how tall the
          content column grows, so it can never be scrolled past. The content column gets
          matching `lg:pl-72` padding instead of being a flex sibling. */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-72 lg:flex-col lg:justify-between lg:border-r lg:border-hairline lg:bg-surface lg:px-4 lg:py-6">
        <div className="flex flex-col gap-7">
          <span className="px-3 font-serif text-xl tracking-tight text-sage-700">Rise</span>
          <nav aria-label="Tabs" className="flex flex-col gap-0.5">
            {TABS.map((t) => (
              <NavLink
                key={t.tab}
                to={t.path}
                end={t.path === '/'}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-card px-3 text-body ${
                    isActive ? 'bg-sage-100 font-semibold text-sage-700' : 'text-ink-muted'
                  }`
                }
              >
                <svg
                  aria-hidden
                  width="20"
                  height="20"
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
            ))}
          </nav>
        </div>
        <Link
          to="/settings"
          className="flex min-h-11 items-center gap-2.5 rounded-card px-3 text-ink-muted"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-sage-100 type-caption font-semibold text-sage-700">
            {initials || '•'}
          </span>
          <span className="type-body">Settings</span>
        </Link>
      </aside>

      <div className="min-w-0">
        <div className="gutter mx-auto flex max-w-2xl items-center justify-between pt-[max(12px,env(safe-area-inset-top))] lg:hidden">
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
      </div>

      <nav
        aria-label="Tabs"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
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
                {({ isActive }) => (
                  <>
                    <span
                      className={`flex size-8 items-center justify-center rounded-full ${
                        isActive ? 'bg-sage-100' : ''
                      }`}
                    >
                      <svg
                        aria-hidden
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        className="fill-none stroke-current"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d={ICON[t.tab]} />
                      </svg>
                    </span>
                    {t.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
