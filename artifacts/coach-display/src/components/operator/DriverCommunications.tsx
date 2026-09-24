import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { AlertTriangle, Check, CircleAlert, Loader2, MessageSquareText, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type ReportCategory = 'stop_blocked' | 'heavy_traffic' | 'coach_issue' | 'passenger_assistance';
type Communications = {
  reports: Array<{ id: string; category: ReportCategory; createdAt: string; resolvedAt: string | null; resolution: string | null }>;
  instructions: Array<{ id: string; message: string; createdAt: string; deliveredAt: string | null; acknowledgedAt: string | null }>;
  safety: { stopped: boolean; reason: string };
};

const REPORTS: Array<{ category: ReportCategory; label: string }> = [
  { category: 'stop_blocked', label: 'Stop blocked' },
  { category: 'heavy_traffic', label: 'Heavy traffic' },
  { category: 'coach_issue', label: 'Coach issue' },
  { category: 'passenger_assistance', label: 'Passenger assistance' },
];

export function DriverCommunications({
  onBriefChange,
}: {
  onBriefChange?: (message: string | null) => void;
}) {
  const { getToken } = useAuth();
  const [data, setData] = useState<Communications | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const token = await getToken();
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || `Communications request failed (${response.status}).`);
    }
    return response.json() as Promise<T>;
  }, [getToken]);

  const load = useCallback(async () => {
    try {
      const next = await request<Communications>('/driver/communications');
      setData(next);
      setError('');
      const undelivered = next.instructions.filter(item => !item.deliveredAt);
      if (undelivered.length) {
        await Promise.all(undelivered.map(item =>
          request(`/driver/dispatch-instructions/${encodeURIComponent(item.id)}/delivered`, { method: 'POST' })));
        setData(current => current ? {
          ...current,
          instructions: current.instructions.map(item =>
            undelivered.some(received => received.id === item.id)
              ? { ...item, deliveredAt: new Date().toISOString() }
              : item),
        } : current);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Communications could not be refreshed.');
    }
  }, [request]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const latest = data?.instructions.find(item => !item.acknowledgedAt) ?? data?.instructions[0];
    onBriefChange?.(latest?.message ?? null);
  }, [data?.instructions, onBriefChange]);

  async function report(category: ReportCategory) {
    setBusy(category);
    try {
      await request('/driver/operational-reports', {
        method: 'POST',
        body: JSON.stringify({ category }),
      });
      toast.success('Dispatch received the operational report.');
      await load();
    } catch (reportError) {
      toast.error(reportError instanceof Error ? reportError.message : 'Report could not be sent.');
    } finally {
      setBusy('');
    }
  }

  async function acknowledge(id: string) {
    setBusy(id);
    try {
      await request(`/driver/dispatch-instructions/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' });
      toast.success('Instruction acknowledged.');
      await load();
    } catch (ackError) {
      toast.error(ackError instanceof Error ? ackError.message : 'Acknowledgment could not be sent.');
    } finally {
      setBusy('');
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-3 text-lg">
          <span className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" /> Dispatch communications</span>
          <Button variant="ghost" size="icon" aria-label="Refresh communications" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span><strong>Updates unavailable.</strong> {error} Nothing will be queued offline.</span>
          </div>
        )}
        <div className={`rounded-xl border p-3 text-sm ${data?.safety.stopped ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
          <p className="font-bold">{data?.safety.stopped ? 'Stopped controls available' : 'Controls locked for safety'}</p>
          <p className="text-muted-foreground">{data?.safety.reason ?? 'Checking fresh GPS speed…'}</p>
        </div>
        <div>
          <p className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">One-tap report</p>
          <div className="grid grid-cols-2 gap-2">
            {REPORTS.map(item => (
              <Button
                key={item.category}
                variant="outline"
                className="h-12 justify-start whitespace-normal text-left"
                disabled={!data?.safety.stopped || Boolean(busy)}
                onClick={() => void report(item.category)}
              >
                {busy === item.category ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-2 h-4 w-4" />}
                {item.label}
              </Button>
            ))}
          </div>
          {data && data.reports.length > 0 && (
            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
              {data.reports.slice(0, 3).map(item => (
                <p key={item.id} className="capitalize">
                  {item.category.replaceAll('_', ' ')} · {item.resolvedAt ? `Resolved — ${item.resolution}` : 'Open with dispatch'}
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Instructions</p>
          {data?.instructions.map(item => (
            <div key={item.id} className="rounded-xl border bg-muted/20 p-3">
              <p className="font-semibold">{item.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                {' · '}{item.acknowledgedAt ? 'Acknowledged' : item.deliveredAt ? 'Delivered' : 'Receiving…'}
              </p>
              {!item.acknowledgedAt && (
                <Button
                  className="mt-3 w-full"
                  disabled={!data.safety.stopped || Boolean(busy)}
                  onClick={() => void acknowledge(item.id)}
                >
                  {busy === item.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  Acknowledge while stopped
                </Button>
              )}
            </div>
          ))}
          {data && data.instructions.length === 0 && <p className="text-sm text-muted-foreground">No dispatch instructions for this assignment.</p>}
        </div>
      </CardContent>
    </Card>
  );
}