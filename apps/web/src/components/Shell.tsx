import { useTabRootTrap } from '../lib/gestures';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, type NavLinkProps } from 'react-router';
import { Icon } from './primitives/Icon';
import { HeaderActionsContext } from '../lib/headerActions';
import { useMe } from '../lib/queries';
import { TABS, type Tab } from '../routes/table';

const ICON: Record<Tab, string> = {
  dashboard: 'M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-4H4zm10-11h6V4h-6z',
  accounts: 'M3 9l9-5 9 5M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18',
  transactions: 'M5 7h14M5 12h14M5 17h9',
  budget: 'M6 20V10M12 20V4M18 20v6',
};

/**
 * Tab switches replace the history entry instead of stacking one: a swipe back on a tab
 * root has nowhere to go (it used to drag the page around or land on the previous tab), and
 * the swipe back from a pushed screen still returns to the tab it came from. Tapping the tab
 * you're already on scrolls it to the top.
 */
const tabLink = (path: string, active: boolean): Partial<NavLinkProps> => ({
  replace: true,
  onClick: (e) => {
    if (!active) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },
  to: path,
});

/**
 * Four tabs and an avatar. No drawer (§4). Below `lg` these are a bottom tab bar, as on
 * phone; at `lg` and up they become a persistent left sidebar (H5) — desktop has the width
 * for it to stay visible instead of scrolling out of reach, and a mouse has no thumb-reach
 * reason to keep navigation at the bottom of the screen.
 */
export function Shell() {
  const me = useMe().data;
  const [actions, setActions] = useState<ReactNode>(null);
  const location = useLocation();
  useTabRootTrap(location.pathname);
  const onDashboard = location.pathname === '/';
  const currentTab = TABS.find((t) =>
    t.path === '/' ? onDashboard : location.pathname.startsWith(t.path),
  );
  const isActiveTab = (path: string) =>
    path === '/' ? onDashboard : location.pathname.startsWith(path);
  // Screens that pin something under the tab title (the Transactions search) need its height.
  const head = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = head.current;
    if (!el) return;
    const set = () =>
      document.documentElement.style.setProperty('--tabhead-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const initials = (me?.displayName ?? '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex min-h-dvh flex-col lg:block lg:pl-72">
      {/* Desktop sidebar is `fixed` so it can never be scrolled past; the content column gets
          matching `lg:pl-72` padding. The phone tab bar is deliberately NOT fixed: it is the
          last item of a full-height column and `sticky`, because iOS can leave a
          fixed-position bar stranded mid-screen after a long session. */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-72 lg:flex-col lg:justify-between lg:border-r lg:border-hairline lg:bg-surface lg:px-4 lg:py-6">
        <div className="flex flex-col gap-7">
          <span className="px-3 font-serif text-xl tracking-tight text-sage-700">Rise</span>
          <nav aria-label="Tabs" className="flex flex-col gap-0.5">
            {TABS.map((t) => (
              <NavLink
                key={t.tab}
                {...tabLink(t.path, isActiveTab(t.path))}
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

      <div className="min-w-0 flex-1">
        <div
          ref={head}
          className="gutter sticky top-[var(--banner-h,0px)] z-20 mx-auto flex max-w-2xl items-center justify-between bg-canvas pt-[max(12px,env(safe-area-inset-top))] lg:hidden"
        >
          <span className="type-page">{currentTab?.label ?? 'Rise'}</span>
          <div className="-mr-2 flex items-center">
            {actions ??
              (onDashboard && (
                <Link
                  to="/settings"
                  aria-label="Settings"
                  className="flex size-11 items-center justify-center rounded-full text-ink-muted active:bg-sage-100"
                >
                  <Icon name="gear" />
                </Link>
              ))}
          </div>
        </div>
        <main>
          <HeaderActionsContext.Provider value={setActions}>
            <Outlet />
          </HeaderActionsContext.Provider>
        </main>
      </div>

      <nav
        aria-label="Tabs"
        className="sticky bottom-0 z-20 border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-4">
          {TABS.map((t) => (
            <li key={t.tab}>
              <NavLink
                {...tabLink(t.path, isActiveTab(t.path))}
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
