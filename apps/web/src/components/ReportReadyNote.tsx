import { useState } from 'react';
import { Link } from 'react-router';
import { monthName } from '../lib/dates';
import { markReportSeen, reportCard, seenReports } from '../lib/reportSeen';
import { useReportReady } from '../lib/queries';

/**
 * "Your October report is ready": a card on the Dashboard from the 1st, until the report is
 * opened or the card dismissed on this device. Switched off under Settings → Alerts.
 */
export function ReportReadyNote() {
  const ready = useReportReady().data?.ready;
  const [seen, setSeen] = useState(seenReports);
  const card = reportCard(ready, seen, (m) => monthName(m, false));
  if (!card || !ready) return null;
  return (
    <section
      aria-label="Monthly report"
      className="mb-4 flex items-center justify-between gap-2 rounded-card bg-sage-100 pl-4 shadow-soft"
    >
      <Link to={card.to} className="min-h-11 flex-1 py-3 type-body font-semibold text-sage-700">
        {card.text} ›
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          markReportSeen(ready.month);
          setSeen(seenReports());
        }}
        className="flex size-11 shrink-0 items-center justify-center text-ink-muted"
      >
        ✕
      </button>
    </section>
  );
}
