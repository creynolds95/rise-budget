import {
  CADENCE_OPTIONS,
  LAST_DAY,
  dayName,
  type Cadence,
  type ScheduleDraft,
} from '../lib/schedule';

const field = 'min-h-11 rounded-input border border-hairline bg-canvas px-2';
const DAYS = [...Array.from({ length: 30 }, (_, i) => i + 1), LAST_DAY];

function DayPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="type-caption text-ink-muted">{label}</span>
      <select
        aria-label={label}
        className={field}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {DAYS.map((d) => (
          <option key={d} value={d}>
            {d === LAST_DAY ? 'Last day' : dayName(d)}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Repeats + the days it lands on. Twice a month and monthly pick days of the month (including
 * "Last day", which follows short months); the rest take a date.
 */
export function ScheduleFields({
  draft,
  onChange,
  dateLabel = 'Next date',
}: {
  draft: ScheduleDraft;
  onChange: (d: ScheduleDraft) => void;
  dateLabel?: string;
}) {
  return (
    <>
      <label className="mt-3 flex flex-col gap-1">
        <span className="type-caption text-ink-muted">Repeats</span>
        <select
          aria-label="Repeats"
          className={field}
          value={draft.cadence}
          onChange={(e) => onChange({ ...draft, cadence: e.target.value as Cadence })}
        >
          {CADENCE_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {draft.cadence === 'semimonthly' ? (
        <div className="mt-3 flex gap-3">
          <DayPicker
            label="First day"
            value={draft.day1}
            onChange={(day1) => onChange({ ...draft, day1 })}
          />
          <DayPicker
            label="Second day"
            value={draft.day2}
            onChange={(day2) => onChange({ ...draft, day2 })}
          />
        </div>
      ) : draft.cadence === 'monthly' ? (
        <div className="mt-3 flex">
          <DayPicker
            label="Day of month"
            value={draft.day1}
            onChange={(day1) => onChange({ ...draft, day1 })}
          />
        </div>
      ) : (
        <label className="mt-3 flex flex-col gap-1">
          <span className="type-caption text-ink-muted">{dateLabel}</span>
          <input
            type="date"
            aria-label={dateLabel}
            value={draft.anchorDate}
            onChange={(e) => onChange({ ...draft, anchorDate: e.target.value })}
            className={field}
          />
        </label>
      )}
    </>
  );
}
