import { Link, useNavigate } from 'react-router';
import { transitionClick } from '../lib/transition';
import { Icon } from './primitives/Icon';

/**
 * The back arrow in the banner's top-left corner, on every screen that isn't a tab. It is
 * only an arrow to the eye; its accessible name still says where it goes.
 */
export function BackLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return (
    <Link
      to={to}
      aria-label={`Back to ${label}`}
      data-transition="back"
      onClick={transitionClick(navigate, to, 'back')}
      className="-ml-2 flex size-11 items-center justify-center justify-self-start rounded-full text-ink active:bg-sage-100"
    >
      <Icon name="back" size={26} />
    </Link>
  );
}
