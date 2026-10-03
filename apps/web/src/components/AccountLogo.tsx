import { BRAND_MARKS } from '../lib/brandMarks';
import { accountBadge } from '../lib/institution';
import { Icon } from './primitives/Icon';

/** The round 36px badge left of an account name: the bank's mark, else a quiet stand-in. */
export function AccountLogo({ account }: { account: Parameters<typeof accountBadge>[0] }) {
  const b = accountBadge(account);
  const circle = 'flex size-9 shrink-0 items-center justify-center rounded-full';
  if (b.type === 'brand') {
    const m = BRAND_MARKS[b.mark];
    return (
      <span aria-hidden className={circle} style={{ background: m.color }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
          <path d={m.path} />
        </svg>
      </span>
    );
  }
  if (b.type === 'word') {
    return (
      <span
        aria-hidden
        className={`${circle} font-bold tracking-tight`}
        style={{
          background: b.color,
          color: '#fff',
          fontSize: b.text.length > 4 ? 8.5 : b.text.length > 3 ? 10 : b.text.length > 1 ? 13 : 16,
        }}
      >
        {b.text}
      </span>
    );
  }
  return (
    <span aria-hidden className={`${circle} bg-sage-100 text-sage-700`}>
      {b.type === 'initials' ? (
        <span className="text-[13px] font-semibold">{b.text}</span>
      ) : (
        <Icon name={b.icon} size={18} />
      )}
    </span>
  );
}
