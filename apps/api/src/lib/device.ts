/**
 * A short, human name for the device behind a User-Agent — "iPhone · Safari" — for the
 * signed-in devices and passkeys lists (C17). A label, never an identity check.
 */
export function deviceLabel(ua: string | undefined): string | null {
  if (!ua) return null;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\/|FxiOS/.test(ua)
      ? 'Firefox'
      : /Chrome\/|CriOS/.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const parts = [os, browser].filter((p): p is string => p !== null);
  return parts.length ? parts.join(' · ') : null;
}
