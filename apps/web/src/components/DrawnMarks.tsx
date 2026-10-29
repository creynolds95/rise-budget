/**
 * Badges drawn after institutions with no free vector mark, on a 36px circle. Each keeps the
 * institution's own colors, so they don't follow the theme.
 */
import { DRAWN_COLORS as C } from '../lib/brandMarks';

const svg = { width: 36, height: 36, viewBox: '0 0 36 36' };

function GuideStone() {
  return (
    <svg {...svg}>
      <circle cx="18" cy="18" r="17.5" fill="#fff" stroke={C.guidestoneRing} />
      <g transform="translate(18 18) scale(1.25) skewX(-28) translate(-18 -17.5)">
        <rect x="9" y="12" width="10" height="4.5" rx="0.8" fill={C.guidestoneDark} />
        <rect x="20.5" y="12" width="6" height="4.5" rx="0.8" fill={C.guidestoneLight} />
        <rect x="11" y="18" width="7" height="5" rx="0.8" fill={C.guidestoneMid} />
        <rect x="19.5" y="18" width="7.5" height="5" rx="0.8" fill={C.guidestoneDark} />
      </g>
    </svg>
  );
}

function Mohela() {
  return (
    <svg {...svg}>
      <circle cx="18" cy="18" r="18" fill={C.mohela} />
      <rect x="0" y="13" width="36" height="10" fill="#fff" />
      <text
        x="18"
        y="21"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight="700"
        fontSize="7.4"
        letterSpacing="-0.1"
        fill={C.mohela}
      >
        MOHELA
      </text>
    </svg>
  );
}

function Empower() {
  // White disc, three waving flag stripes (red, red, navy) over the EMPOWER wordmark.
  const wave = (y: number) => `M9.5 ${y}c2.6-2 5.2-2 8.5 0s5.9 2 8.5 0`;
  return (
    <svg {...svg}>
      <circle cx="18" cy="18" r="17.5" fill="#fff" stroke={C.guidestoneRing} />
      <g fill="none" strokeLinecap="round">
        <path d={wave(12.2)} stroke={C.empowerRed} strokeWidth="1.9" />
        <path d={wave(15)} stroke={C.empowerRed} strokeWidth="1.3" />
        <path d={wave(17.6)} stroke={C.empowerBlue} strokeWidth="1.9" />
      </g>
      <text
        x="18"
        y="25.6"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, 'Helvetica Neue', sans-serif"
        fontWeight="700"
        fontSize="5.4"
        textLength="22"
        lengthAdjust="spacingAndGlyphs"
        fill={C.empowerBlue}
      >
        EMPOWER
      </text>
    </svg>
  );
}

export const DRAWN_MARKS = { guidestone: GuideStone, mohela: Mohela, empower: Empower } as const;
