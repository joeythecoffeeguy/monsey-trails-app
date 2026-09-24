import type { OfficialScheduleRun } from '@/providers/official-schedules';

export function ScheduleKeyBadges({
  keys,
  legend,
  className = '',
}: {
  keys: OfficialScheduleRun['displayKeys'] | undefined;
  legend: ReadonlyArray<{ key: string; meaning: string }>;
  className?: string;
}) {
  if (!keys?.length) return null;
  return (
    <span className={`inline-flex flex-wrap gap-1 ${className}`} aria-label={`Schedule keys ${keys.join(', ')}`}>
      {keys.map(key => {
        const meaning = legend.find(item => item.key === key)?.meaning;
        return meaning ? (
          <details key={key} className="group relative">
            <summary
              aria-label={`Schedule key ${key}: ${meaning}`}
              className="inline-flex h-6 min-w-6 cursor-pointer list-none items-center justify-center rounded-md border border-[#f59e0b] bg-[#facc15] px-1.5 text-xs font-black text-[#111827] shadow-sm [&::-webkit-details-marker]:hidden"
            >
              {key}
            </summary>
            <span className="absolute left-0 top-8 z-30 w-56 rounded-lg bg-[#0f172a] px-3 py-2 text-left text-xs font-semibold leading-relaxed text-white shadow-xl">
              <strong className="mr-1">{key}</strong>{meaning}
            </span>
          </details>
        ) : (
          <span
            key={key}
            aria-label={`Schedule key ${key}`}
            className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-[#f59e0b] bg-[#facc15] px-1.5 text-xs font-black text-[#111827] shadow-sm"
          >
            {key}
          </span>
        );
      })}
    </span>
  );
}

export function ScheduleKeyLegend({
  legend,
  className = '',
}: {
  legend: ReadonlyArray<{ key: string; meaning: string }> | undefined;
  className?: string;
}) {
  if (!legend?.length) return null;
  return (
    <details className={`rounded-xl border border-[#dbe3e8] bg-white p-3 text-[#0f172a] ${className}`}>
      <summary className="cursor-pointer text-sm font-black">Schedule key meanings</summary>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        {legend.map(item => (
          <div key={item.key} className="flex items-start gap-2">
            <dt className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-brand-ink px-1.5 font-black text-white">{item.key}</dt>
            <dd className="pt-1 font-semibold text-[#475569]">{item.meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}