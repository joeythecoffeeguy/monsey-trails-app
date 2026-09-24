import { AlertTriangle, Ban, Clock3, Route, Signpost } from 'lucide-react';
import type { ServiceDisruption } from '@/providers/live-trip';

const presentation = {
  delay: { label: 'Delay', icon: Clock3, className: 'border-amber-300 bg-amber-50 text-amber-950' },
  detour: { label: 'Detour', icon: Route, className: 'border-sky-300 bg-sky-50 text-sky-950' },
  skipped_stop: { label: 'Skipped stop', icon: Signpost, className: 'border-orange-300 bg-orange-50 text-orange-950' },
  boarding_change: { label: 'Boarding change', icon: Signpost, className: 'border-orange-300 bg-orange-50 text-orange-950' },
  cancellation: { label: 'Cancelled', icon: Ban, className: 'border-red-300 bg-red-50 text-red-950' },
} as const;

export function ServiceDisruptionNotices({
  disruptions,
  compact = false,
}: {
  disruptions: ServiceDisruption[] | undefined;
  compact?: boolean;
}) {
  if (!disruptions?.length) return null;
  return (
    <section className={`space-y-2 ${compact ? 'my-3' : 'mx-auto my-3 w-full max-w-3xl px-3'}`} aria-label="Current service notices">
      {disruptions.map((notice) => {
        const item = presentation[notice.type] ?? { label: 'Service notice', icon: AlertTriangle, className: 'border-amber-300 bg-amber-50 text-amber-950' };
        const Icon = item.icon;
        return (
          <div key={notice.id} className={`flex items-start gap-3 rounded-xl border p-3 ${item.className}`} role="status">
            <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-wide">
                {item.label}
                {notice.delayMinutes ? ` · about ${notice.delayMinutes} minutes` : ''}
                {notice.stopName ? ` · ${notice.stopName}` : ''}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm font-semibold">{notice.message}</p>
            </div>
          </div>
        );
      })}
    </section>
  );
}