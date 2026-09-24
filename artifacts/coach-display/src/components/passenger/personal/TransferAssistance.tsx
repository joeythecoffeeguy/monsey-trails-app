import { useState } from 'react';
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, Route } from 'lucide-react';
import { useSearchPassengerTransfers } from '@workspace/api-client-react';
import { formatJourneyTime } from './journeyTime';

export function TransferAssistance({
  runKey,
  serviceDate,
}: {
  runKey: string;
  serviceDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [bufferMinutes, setBufferMinutes] = useState(15);
  const search = useSearchPassengerTransfers();

  function findTransfers() {
    search.mutate({ data: { runKey, minimumBufferMinutes: bufferMinutes } });
  }

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-label="Transfer assistance">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          if (!open && !search.data && !search.isPending) findTransfers();
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="rounded-xl bg-secondary/10 p-2 text-secondary"><Route className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black text-foreground">Need another bus?</span>
          <span className="block text-xs font-medium text-muted-foreground">Check possible transfers from the published schedule</span>
        </span>
        <span className="text-xs font-black text-secondary">{open ? 'Hide' : 'Check'}</span>
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <div className="flex items-center gap-2">
            <label htmlFor="transfer-buffer" className="text-xs font-bold text-muted-foreground">Minimum buffer</label>
            <select
              id="transfer-buffer"
              value={bufferMinutes}
              onChange={(event) => setBufferMinutes(Number(event.target.value))}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs font-black"
            >
              {[10, 15, 20, 30, 45].map((minutes) => (
                <option key={minutes} value={minutes}>{minutes} min</option>
              ))}
            </select>
            <button
              type="button"
              onClick={findTransfers}
              disabled={search.isPending}
              className="ml-auto flex items-center gap-1.5 rounded-full bg-secondary px-3 py-2 text-xs font-black text-secondary-foreground disabled:opacity-60"
            >
              {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Search
            </button>
          </div>

          {search.isPending && !search.data && (
            <div className="flex items-center justify-center gap-2 py-7 text-sm font-bold text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking exact published runs…
            </div>
          )}
          {search.isError && (
            <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs font-bold text-destructive" role="alert">
              Transfer search is temporarily unavailable. Try again.
            </div>
          )}
          {search.data && (
            <div className="mt-3 space-y-3">
              <p className="text-xs font-medium leading-relaxed text-muted-foreground">{search.data.message}</p>
              {search.data.options.map((option) => (
                <article
                  key={option.runKey}
                  className={`rounded-xl border p-3 ${
                    option.connectionStatus === 'at_risk'
                      ? 'border-red-300 bg-red-50'
                      : option.connectionStatus === 'tight'
                        ? 'border-amber-300 bg-amber-50'
                        : 'border-emerald-200 bg-emerald-50/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-foreground">
                        {option.origin.name} <ArrowRight className="mx-1 inline h-3.5 w-3.5" /> {option.destination.name}
                      </p>
                      <p className="mt-1 text-xs font-bold text-muted-foreground">
                        Published departure {formatJourneyTime(option.departureAt, option.serviceDate)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-white/80 px-2 py-1 text-[10px] font-black uppercase text-foreground">
                      {option.bufferMinutes} min
                    </span>
                  </div>
                  <p className="mt-2 text-xs font-bold text-foreground">Same published stop: {option.sharedStop.label}</p>
                  <p className="mt-1 text-xs font-medium text-muted-foreground">
                    Incoming {option.arrivalBasis === 'live' ? 'live estimate' : 'published arrival'}: {formatJourneyTime(option.arrivalBasisAt, serviceDate)}
                  </p>
                  <div className="mt-2 flex items-start gap-1.5 text-xs font-semibold leading-relaxed text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{option.warning}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}