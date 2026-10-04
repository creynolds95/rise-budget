/**
 * The app's motion tokens, mirrored from styles.css's `--motion-*` (motion.test.ts keeps the
 * two in step). Screens, sheets and the menu all move on the same clock and curve, so nothing
 * snaps faster than its neighbour.
 */
export const MOTION_EASE = 'cubic-bezier(0.25, 0.8, 0.25, 1)';
/** Something arriving: a pushed screen, a sheet rising, the menu sliding in. */
export const MOTION_IN_MS = 400;
/** Something leaving: a sheet dropping, the menu closing, a backdrop fading. */
export const MOTION_OUT_MS = 280;
