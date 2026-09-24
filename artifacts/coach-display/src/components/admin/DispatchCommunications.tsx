import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import { CheckCircle2, CircleAlert, Loader2, MessageSquareText, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { DispatchAssignment } from '@/pages/admin-dispatch';

type Communications = {
  reports: Array<{
    id: string; assignmentId: number; busNumber: string; category: string; createdAt: string;
    resolvedAt: string | null; resolution: string | null; location: { lat: number; lng: number }; locationObservedAt: string;
  }>;
  instructions: Array<{
    id: string; assignmentId: number; busNumber: string; message: string; createdAt: string;
    deliveredAt: string | null; acknowledgedAt: string | null;
  }>;
};

const categoryLabel = (category: string) => category.replaceAll('_', ' ');

export function DispatchCommunications({ assignments }: { assignments: DispatchAssignment[] }) {
  const { getToken } = useAuth();
  const [data, setData] = useState<Communications | null>(null);
  const [error, setError] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [message, setMessage] = useState('');
  const [resolutionByReport, setResolutionByReport] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const activeAssignments = useMemo(() => assignments.filter(item => !item.completedAt), [assignments]);

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
      setData(await request<Communications>('/admin/communications'));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Dispatch communications could not be refreshed.');
    }
  }, [request]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function sendInstruction() {
    const selected = Number(assignmentId);
    if (!Number.isInteger(selected) || !message.trim()) return;
    setBusy('send');
    try {
      await request('/admin/dispatch-instructions', {
        method: 'POST',
        body: JSON.stringify({ assignmentId: selected, message: message.trim() }),
      });
      setMessage('');
      toast.success('Instruction saved for the selected active assignment.');
      await load();
    } catch (sendError) {
      toast.error(sendError instanceof Error ? sendError.message : 'Instruction could not be sent.');
    } finally {
      setBusy('');
    }
  }

  async function resolveReport(id: string) {
    const resolution = resolutionByReport[id]?.trim();
    if (!resolution) return;
    setBusy(id);
    try {
      await request(`/admin/operational-reports/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution }),
      });
      toast.success('Operational report resolved.');
      await load();
    } catch (resolveError) {
      toast.error(resolveError instanceof Error ? resolveError.message : 'Report could not be resolved.');
    } finally {
      setBusy('');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" /> Driver reports & instructions</span>
          <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span><strong>Polling failed.</strong> {error} Delivery state may be out of date.</span>
          </div>
        )}
        <div className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
          <select className="h-10 rounded-md border bg-background px-3" value={assignmentId} onChange={event => setAssignmentId(event.target.value)}>
            <option value="">Choose active assignment</option>
            {activeAssignments.map(item => <option key={item.id} value={item.id}>Coach {item.busNumber} · {item.driverName || item.driverId}</option>)}
          </select>
          <Input
            aria-label="Dispatch instruction"
            placeholder="Instruction to the selected driver"
            maxLength={500}
            value={message}
            onChange={event => setMessage(event.target.value)}
          />
          <Button disabled={!assignmentId || !message.trim() || Boolean(busy)} onClick={() => void sendInstruction()}>
            {busy === 'send' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Send
          </Button>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Operational reports</p>
            {data?.reports.map(report => (
              <div key={report.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-black capitalize">{categoryLabel(report.category)}</p>
                    <p className="text-sm text-muted-foreground">Coach {report.busNumber} · {new Date(report.createdAt).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">
                      GPS {report.location.lat.toFixed(5)}, {report.location.lng.toFixed(5)} · observed {new Date(report.locationObservedAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-bold ${report.resolvedAt ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>{report.resolvedAt ? 'Resolved' : 'Open'}</span>
                </div>
                {report.resolvedAt ? <p className="mt-2 text-sm">{report.resolution}</p> : (
                  <div className="mt-3 flex gap-2">
                    <Input aria-label={`Resolution for ${categoryLabel(report.category)}`} placeholder="Resolution note" maxLength={240} value={resolutionByReport[report.id] || ''} onChange={event => setResolutionByReport(current => ({ ...current, [report.id]: event.target.value }))} />
                    <Button variant="outline" disabled={!resolutionByReport[report.id]?.trim() || Boolean(busy)} onClick={() => void resolveReport(report.id)}>
                      {busy === report.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Resolve'}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {data && data.reports.length === 0 && <p className="text-sm text-muted-foreground">No operational reports.</p>}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Instruction delivery</p>
            {data?.instructions.map(item => (
              <div key={item.id} className="rounded-xl border p-3">
                <p className="font-semibold">{item.message}</p>
                <p className="mt-1 text-sm text-muted-foreground">Coach {item.busNumber} · {new Date(item.createdAt).toLocaleString()}</p>
                <p className="mt-2 flex items-center gap-1 text-xs font-bold">
                  {item.acknowledgedAt ? <><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Acknowledged {new Date(item.acknowledgedAt).toLocaleTimeString()}</>
                    : item.deliveredAt ? <><CheckCircle2 className="h-4 w-4 text-blue-600" /> Delivered {new Date(item.deliveredAt).toLocaleTimeString()}</>
                      : 'Sent · awaiting client delivery'}
                </p>
              </div>
            ))}
            {data && data.instructions.length === 0 && <p className="text-sm text-muted-foreground">No dispatch instructions.</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}