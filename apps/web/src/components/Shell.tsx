import { useTabRootTrap } from '../lib/gestures';
import { BackLink } from './BackLink';
import { Floater } from './Floater';
import { MENU_ITEMS, NavDrawer } from './NavDrawer';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, type NavLinkProps } from 'react-router';
import { Icon, PATHS } from './primitives/Icon';
import { HeaderActionsContext } from '../lib/headerActions';
import { useMe } from '../lib/queries';
import { useScrollMemory } from '../lib/scrollMemory';
import { SCROLLER_ID, scrollToY } from '../lib/scroller';
import { PageBarSlotContext } from '../lib/pageBar';
import { isTabRoot } from '../lib/transition';
import { TABS, type Tab } from '../routes/table';

const ICON: Record<Tab, string> = {
  dashboard: 'M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-4H4zm10-11h6V4h-6z',
  accounts: PATHS.bank,
  transactions: 'M5 7h14M5 12h14M5 17h9',
  budget: PATHS.budget,
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
    scrollToY(0, 'smooth');
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
  // A Transactions list opened from a category or account is a pushed screen, not the tab.
  const pushedList =
    location.pathname === '/transactions' && new URLSearchParams(location.search).has('back');
  useTabRootTrap(pushedList ? '/transactions/pushed' : location.pathname);
  useScrollMemory();
  const [menuOpen, setMenuOpen] = useState(false);
  // Created up front and handed to the screens as a stable element, so a title bar portals into
  // it from its very first render; the placeholder below puts it in the page before paint.
  const [barSlot] = useState(() => {
    const el = document.createElement('div');
    el.className =
      'mx-auto w-full max-w-2xl shrink-0 lg:sticky lg:top-[var(--banner-h,0px)] lg:z-10';
    return el;
  });
  const closeMenu = () => setMenuOpen(false);
  const onDashboard = location.pathname === '/';
  const onTabRoot = isTabRoot(location.pathname) && !pushedList;
  // The menu sits on all four tabs. Sliding right from the left side opens it there; pushed
  // screens keep that gesture for going back.
  useEffect(() => {
    if (!onTabRoot) return;
    let start: { x: number; y: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      const el = e.target as Element | null;
      start =
        e.touches.length === 1 &&
        t &&
        t.clientX < window.innerWidth * 0.4 &&
        !el?.closest('[data-zoomable], [data-no-swipe], input, textarea, [role=dialog]')
          ? { x: t.clientX, y: t.clientY }
          : null;
    };
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (!start || !t) return;
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      start = null;
      if (dx > 80 && dx > dy * 2) setMenuOpen(true);
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [onTabRoot]);
  const currentTab = TABS.find((t) =>
    t.path === '/' ? onDashboard : location.pathname.startsWith(t.path),
  );
  // Screens pushed from the Dashboard menu keep the Dashboard tab lit.
  const fromDashboard = /^\/(review|recurring|cash-to-payday|financial-health)\/?$/.test(
    location.pathname,
  );
  const isActiveTab = (path: string) =>
    path === '/' ? onDashboard || fromDashboard : location.pathname.startsWith(path);
  // Pushed screens bring their own banner; the tab title bar is only for the tab roots.
  const showTabHead =
    onTabRoot || location.pathname === '/settings' || location.pathname === '/financial-health';
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
    <PageBarSlotContext.Provider value={barSlot}>
      <div className="flex max-lg:h-[calc(100dvh-var(--banner-h,0px))] min-h-0 flex-col lg:block lg:min-h-dvh lg:pl-72">
        {/* Desktop sidebar is `fixed` so it can never be scrolled past; the content column gets
          matching `lg:pl-72` padding. The phone tab bar is deliberately NOT fixed: it is the
          last item of a full-height column and `sticky`, because iOS can leave a
          fixed-position bar stranded mid-screen after a long session. */}
        <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-72 lg:flex-col lg:justify-between lg:gap-6 lg:overflow-y-auto lg:border-r lg:border-hairline lg:bg-surface lg:px-4 lg:py-6">
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
            {/* Everything the phone's menu reaches; Settings sits at the foot. */}
            <nav aria-label="Menu" className="flex flex-col gap-0.5 border-t border-hairline pt-5">
              {MENU_ITEMS.filter((i) => i.to !== '/settings').map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  className={({ isActive }) =>
                    `flex min-h-10 items-center rounded-card px-3 type-body ${
                      isActive ? 'bg-sage-100 font-semibold text-sage-700' : 'text-ink-muted'
                    }`
                  }
                >
                  {i.label}
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

        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:block">
          <div
            ref={head}
            className={`gutter sticky top-[var(--banner-h,0px)] z-20 mx-auto flex w-full max-w-2xl shrink-0 items-center justify-between banner bg-banner text-banner-ink shadow-soft lg:hidden ${showTabHead ? '' : 'hidden!'}`}
          >
            <div className={`flex items-center gap-1 ${onTabRoot ? '-ml-2' : ''}`}>
              {(location.pathname === '/settings' || location.pathname === '/financial-health') && (
                <BackLink to="/" label="Dashboard" />
              )}
              {onTabRoot && (
                <button
                  type="button"
                  aria-label="Menu"
                  onClick={() => setMenuOpen(true)}
                  className="flex size-11 items-center justify-center rounded-full text-ink-muted active:bg-sage-100"
                >
                  <Icon name="menu" />
                </button>
              )}
              <span className="type-page">
                {currentTab?.label ??
                  (location.pathname === '/settings'
                    ? 'Settings'
                    : location.pathname === '/financial-health'
                      ? 'Financial health'
                      : 'Rise')}
              </span>
            </div>
            <div className="-mr-2 flex items-center">{actions}</div>
          </div>
          {/* Pushed screens' title bars land here (lib/pageBar), outside the scrolling content. */}
          <div
            className="contents"
            ref={(n) => {
              if (n && barSlot.parentNode !== n) n.appendChild(barSlot);
            }}
          />
          <NavDrawer open={menuOpen} onClose={closeMenu} />
          {/* Below lg this is the one thing that scrolls, so the bars around it stay put while it
            bounces at either end (styles.css); from lg up the document scrolls as before. */}
          <div
            id={SCROLLER_ID}
            className="min-h-0 flex-1 max-lg:overflow-y-auto max-lg:overscroll-y-auto max-lg:overscroll-x-none max-lg:pb-[var(--kb,0px)]"
          >
            <main>
              <HeaderActionsContext.Provider value={setActions}>
                <Outlet />
              </HeaderActionsContext.Provider>
            </main>
          </div>
        </div>

        <nav
          aria-label="Tabs"
          className="sticky bottom-0 z-20 border-t border-hairline bg-canvas pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          {/* Rides the sticky tab bar rather than being `fixed`, for the same iOS reason. */}
          <Floater className="absolute inset-x-0 bottom-full mb-3" />
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
        <Floater className="fixed inset-x-0 bottom-6 z-30 hidden lg:flex lg:pl-72" />
      </div>
    </PageBarSlotContext.Provider>
  );
}
