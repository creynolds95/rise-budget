import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, IconButton, type IconName } from './Icon';

export interface MenuItem {
  label: string;
  icon: IconName;
  onSelect: () => void;
  disabled?: boolean;
  hint?: string | undefined;
}

/** The ⋯ menu: a small card of actions under the button, dismissed by a tap anywhere else. */
export function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus();
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <IconButton
        icon="more"
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="animate-pop-in absolute top-12 right-0 z-30 w-64 overflow-hidden rounded-card bg-surface shadow-[0_8px_30px_rgba(25,28,22,0.14)] ring-1 ring-hairline"
        >
          {items.map((it) => (
            <MenuRow
              key={it.label}
              item={it}
              onDone={() => {
                setOpen(false);
                it.onSelect();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuRow({ item, onDone }: { item: MenuItem; onDone: () => void }): ReactNode {
  return (
    <button
      role="menuitem"
      disabled={item.disabled}
      onClick={onDone}
      className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-hairline px-4 py-2 text-left last:border-b-0 active:bg-sage-100 disabled:opacity-50"
    >
      <span>
        {item.label}
        {item.hint && <span className="block type-caption text-ink-faint">{item.hint}</span>}
      </span>
      <span className="text-ink-muted">
        <Icon name={item.icon} size={20} />
      </span>
    </button>
  );
}
