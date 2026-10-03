/**
 * Badges drawn after institutions with no free vector mark, on a 36px circle. Each keeps the
 * institution's own colors, so they don't follow the theme.
 */
const svg = { width: 36, height: 36, viewBox: '0 0 36 36' };

function GuideStone() {
  return (
    <svg {...svg}>
      <circle cx="18" cy="18" r="17.5" fill="#fff" stroke="#d6d6d6" />
      <g transform="translate(18 18) scale(1.25) skewX(-28) translate(-18 -17.5)">
        <rect x="9" y="12" width="10" height="4.5" rx="0.8" fill="#1f6b3a" />
        <rect x="20.5" y="12" width="6" height="4.5" rx="0.8" fill="#8cc63f" />
        <rect x="11" y="18" width="7" height="5" rx="0.8" fill="#3d8b45" />
        <rect x="19.5" y="18" width="7.5" height="5" rx="0.8" fill="#1f6b3a" />
      </g>
    </svg>
  );
}

function Mohela() {
  return (
    <svg {...svg}>
      <circle cx="18" cy="18" r="18" fill="#22553a" />
      <rect x="0" y="13" width="36" height="10" fill="#fff" />
      <text
        x="18"
        y="21"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight="700"
        fontSize="7.4"
        letterSpacing="-0.1"
        fill="#22553a"
      >
        MOHELA
      </text>
    </svg>
  );
}

function Empower() {
  return (
    <svg {...svg}>
      <circle cx="18" cy="18" r="18" fill="#1b2d5b" />
      <path d="M0 26h36v10H0z" fill="#c8102e" />
      <path d="M0 24.5h36V26H0z" fill="#fff" />
      <text
        x="18"
        y="21"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontWeight="800"
        fontSize="15"
        fill="#fff"
      >
        E
      </text>
    </svg>
  );
}

export const DRAWN_MARKS = { guidestone: GuideStone, mohela: Mohela, empower: Empower } as const;
