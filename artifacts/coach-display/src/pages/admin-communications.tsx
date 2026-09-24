import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/react';
import { Link, Redirect } from 'wouter';
import { Eye, Loader2, Pencil, Radio, RefreshCw, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';
import {
  BUS_LINES,
  SERVICE_AREAS,
  createOfficialRunKey,
  fetchOfficialSchedule,
  type OfficialSchedule,
} from '@/providers/official-schedules';

type TemplateType = 'delay' | 'cancellation' | 'detour' | 'boarding_change';
type Communication = {
  id: string;
  officialRunKey: string;
  officialRunKeys: string[];
  type: TemplateType;
  message: string;
  delayMinutes: number | null;
  stopName: string | null;
  targetCoachNumbers: string[];
  startsAt: string;
  expiresAt: string;
  publicationStatus: 'scheduled' | 'published' | 'expired' | 'withdrawn';
  affectedRunCount: number;
  measuredReceipt: { status: 'not_measured'; passengerReadCount: null; explanation: string };
};
type Preview = {
  approvalToken: string;
  approvalExpiresAt: string;
  preview: Omit<Communication, 'id' | 'officialRunKey' | 'targetCoachNumbers' | 'publicationStatus' | 'measuredReceipt'>;
  target: {
    affectedRuns: Array<{
      canonicalRunKey: string;
      scheduledDepartureAt: string;
      selectedCoaches: string[];
      assignedCoaches: string[];
    }>;
    affectedRunCount: number;
    selectedCoachCount: number;
  };
  affectedRunCount: number;
  publicationStatus: string;
  measuredReceipt: { status: 'not_measured'; passengerReadCount: null };
};

const templates: Record<TemplateType, { label: string; message: string }> = {
  delay: { label: 'Delay', message: 'This trip is delayed. Please allow extra travel time.' },
  cancellation: { label: 'Cancellation', message: 'This trip has been cancelled. Please choose another departure.' },
  detour: { label: 'Detour', message: 'This trip is operating on a detour. Scheduled travel may take longer.' },
  boarding_change: { label: 'Boarding change', message: 'Boarding for this trip has moved. Please use the location shown in this notice.' },
};
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const localInput = (date: Date) => {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
};

export default function AdminCommunications() {
  const { isLoaded, userId, getToken } = useAuth();
  const [date, setDate] = useState(today);
  const [line, setLine] = useState(1);
  const [origin, setOrigin] = useState(3);
  const [destination, setDestination] = useState(2);
  const [schedule, setSchedule] = useState<OfficialSchedule | null>(null);
  const [runId, setRunId] = useState('');
  const [targetScope, setTargetScope] = useState<'trip' | 'route'>('trip');
  const [pendingRunId, setPendingRunId] = useState('');
  const [type, setType] = useState<TemplateType>('delay');
  const [message, setMessage] = useState(templates.delay.message);
  const [delayMinutes, setDelayMinutes] = useState('15');
  const [stopName, setStopName] = useState('');
  const [coaches, setCoaches] = useState('');
  const [startsAt, setStartsAt] = useState(() => localInput(new Date()));
  const [expiresAt, setExpiresAt] = useState(() => localInput(new Date(Date.now() + 4 * 60 * 60_000)));
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [approved, setApproved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const areas = useMemo(() => SERVICE_AREAS.filter(area => area.lines.includes(line)), [line]);
  const runKey = runId ? createOfficialRunKey({ date, line, origin, destination, runId }) : '';

  async function request<T>(path: string, init?: RequestInit) {
    const token = await getToken();
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body as T;
  }

  async function loadHistory() {
    setCommunications(await request<Communication[]>('/admin/passenger-communications'));
  }

  useEffect(() => {
    if (!userId) return;
    void loadHistory().catch(error => toast.error(error instanceof Error ? error.message : 'Communications could not be loaded.'));
  }, [userId]);

  useEffect(() => {
    setSchedule(null);
    setRunId('');
    setPreview(null);
  }, [date, line, origin, destination]);

  function payload() {
    const selectedRunKeys = targetScope === 'route'
      ? (schedule?.runs ?? []).map(run => createOfficialRunKey({ date, line, origin, destination, runId: run.id }))
      : runKey ? [runKey] : [];
    return {
      communicationGroupId: editingId,
      officialRunKeys: selectedRunKeys,
      type,
      message,
      delayMinutes: type === 'delay' ? Number(delayMinutes) : null,
      stopName: type === 'boarding_change' ? stopName : null,
      targetCoachNumbers: coaches.split(',').map(value => value.trim()).filter(Boolean),
      startsAt: new Date(startsAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async function loadRuns() {
    setBusy(true);
    try {
      const result = await fetchOfficialSchedule(line, origin, destination, date);
      setSchedule(result);
      setRunId(result.runs.some(run => run.id === pendingRunId) ? pendingRunId : result.runs[0]?.id ?? '');
      setPendingRunId('');
      setPreview(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Published trips could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  async function createPreview() {
    setBusy(true);
    try {
      setPreview(await request<Preview>('/admin/passenger-communications/preview', {
        method: 'POST',
        body: JSON.stringify(payload()),
      }));
      setApproved(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Preview could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!preview || !approved) return;
    setBusy(true);
    try {
      await request('/admin/passenger-communications/publish', {
        method: 'POST',
        body: JSON.stringify({ approvalToken: preview.approvalToken }),
      });
      toast.success(editingId ? 'Passenger communication updated.' : 'Passenger communication published.');
      setPreview(null);
      setApproved(false);
      setEditingId(null);
      await loadHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Communication could not be published.');
    } finally {
      setBusy(false);
    }
  }

  function edit(item: Communication) {
    const [itemDate, itemLine, itemOrigin, itemDestination, itemRunId] = item.officialRunKey.split('|');
    setDate(itemDate);
    setLine(Number(itemLine));
    setOrigin(Number(itemOrigin));
    setDestination(Number(itemDestination));
    setPendingRunId(itemRunId);
    setSchedule(null);
    setTargetScope(item.officialRunKeys.length > 1 ? 'route' : 'trip');
    setType(item.type);
    setMessage(item.message);
    setDelayMinutes(String(item.delayMinutes ?? 15));
    setStopName(item.stopName ?? '');
    setCoaches(item.targetCoachNumbers.join(', '));
    setStartsAt(localInput(new Date(item.startsAt)));
    setExpiresAt(localInput(new Date(item.expiresAt)));
    setEditingId(item.id);
    setPreview(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function withdraw(id: string) {
    setBusy(true);
    try {
      await request(`/admin/passenger-communications/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast.success('Communication withdrawn from passenger views.');
      await loadHistory();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Communication could not be withdrawn.');
    } finally {
      setBusy(false);
    }
  }

  if (!isLoaded) return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!userId) return <Redirect to={`${appUrl('/sign-in')}?redirect_url=${encodeURIComponent(appUrl(APP_ROUTES.adminCommunications))}`} />;

  return (
    <div className="min-h-[100dvh] bg-muted/30 text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-primary">Passenger information</p><h1 className="text-2xl font-black">Communications center</h1></div>
          <nav className="flex gap-2"><Button asChild variant="outline"><Link href={APP_ROUTES.adminDispatch}>Dispatch</Link></Button><Button asChild variant="outline"><Link href={APP_ROUTES.adminOperations}>Exceptions</Link></Button></nav>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl gap-5 px-5 py-6 lg:grid-cols-[1.1fr_.9fr]">
        <Card>
          <CardHeader><CardTitle>{editingId ? 'Edit communication' : 'Create communication'}</CardTitle><p className="text-sm text-muted-foreground">Choose one exact published departure. No route-wide run records are changed.</p></CardHeader>
          <CardContent className="space-y-5">
            <section className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-bold">Service date<Input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
              <label className="text-sm font-bold">Route<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={line} onChange={event => setLine(Number(event.target.value))}>{BUS_LINES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="text-sm font-bold">From<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={origin} onChange={event => setOrigin(Number(event.target.value))}>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <label className="text-sm font-bold">To<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={destination} onChange={event => setDestination(Number(event.target.value))}>{areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </section>
            <Button variant="outline" disabled={busy || origin === destination} onClick={() => void loadRuns()}><RefreshCw className="mr-2 h-4 w-4" />Resolve published trips</Button>
            {schedule && <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant={targetScope === 'trip' ? 'default' : 'outline'} onClick={() => { setTargetScope('trip'); setPreview(null); }}>One departure</Button>
                <Button type="button" variant={targetScope === 'route' ? 'default' : 'outline'} onClick={() => { setTargetScope('route'); setPreview(null); }}>All {schedule.runs.length} route departures</Button>
              </div>
              {targetScope === 'trip' && <label className="block text-sm font-bold">Exact departure<select className="mt-1 h-10 w-full rounded-md border bg-background px-3" value={runId} onChange={event => { setRunId(event.target.value); setPreview(null); }}>{schedule.runs.map(run => <option key={run.id} value={run.id}>{run.scheduledTime} · {run.routeCode}</option>)}</select></label>}
              {targetScope === 'route' && <p className="rounded-md border bg-muted/40 p-3 text-sm">Targets only the {schedule.runs.length} resolved departures for {schedule.date}, {schedule.origin.name} → {schedule.destination.name}. Other dates and routes are not included.</p>}
            </div>}
            {editingId && !schedule && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Resolve the published trip again before previewing this edit.</p>}
            <section className="space-y-3 border-t pt-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(templates).map(([value, item]) => <Button key={value} type="button" variant={type === value ? 'default' : 'outline'} onClick={() => { setType(value as TemplateType); setMessage(item.message); setPreview(null); }}>{item.label}</Button>)}</div>
              {type === 'delay' && <label className="block text-sm font-bold">Expected delay (minutes)<Input type="number" min={1} max={1440} value={delayMinutes} onChange={event => setDelayMinutes(event.target.value)} /></label>}
              {type === 'boarding_change' && <label className="block text-sm font-bold">New boarding location<Input maxLength={160} value={stopName} onChange={event => setStopName(event.target.value)} /></label>}
              <label className="block text-sm font-bold">Passenger message<Textarea className="mt-1" maxLength={500} value={message} onChange={event => { setMessage(event.target.value); setPreview(null); }} /></label>
              <label className="block text-sm font-bold">Selected coaches <span className="font-normal text-muted-foreground">(optional, comma-separated)</span><Input placeholder="215, 318" value={coaches} onChange={event => { setCoaches(event.target.value); setPreview(null); }} /><span className="mt-1 block text-xs font-normal text-muted-foreground">Selected coaches must already be assigned to this exact departure. Leave empty for every passenger following this departure.</span></label>
              <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold">Starts<Input type="datetime-local" value={startsAt} onChange={event => { setStartsAt(event.target.value); setPreview(null); }} /></label><label className="text-sm font-bold">Expires<Input type="datetime-local" value={expiresAt} onChange={event => { setExpiresAt(event.target.value); setPreview(null); }} /></label></div>
              <Button disabled={busy || !runKey || !message.trim()} onClick={() => void createPreview()}><Eye className="mr-2 h-4 w-4" />Preview exact audience</Button>
            </section>
          </CardContent>
        </Card>
        <div className="space-y-5">
          <Card className={preview ? 'border-primary' : ''}>
            <CardHeader><CardTitle>Approval preview</CardTitle></CardHeader>
            <CardContent>
              {!preview ? <p className="text-sm text-muted-foreground">Resolve a trip and preview before publishing. Publishing is never automatic.</p> : <div className="space-y-4">
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><p className="text-xs font-black uppercase">{templates[preview.preview.type].label}</p><p className="mt-1 font-semibold">{preview.preview.message}</p>{preview.preview.stopName && <p className="mt-2 text-sm">Boarding: {preview.preview.stopName}</p>}</div>
                <dl className="grid gap-2 text-sm"><div><dt className="text-muted-foreground">Resolved affected runs</dt><dd className="font-bold">{preview.affectedRunCount} departure{preview.affectedRunCount === 1 ? '' : 's'}</dd></div><div><dt className="text-muted-foreground">Exact runs</dt><dd className="space-y-1 font-mono text-xs font-bold">{preview.target.affectedRuns.map(run => <span className="block" key={run.canonicalRunKey}>{run.canonicalRunKey}{run.selectedCoaches.length ? ` · coaches ${run.selectedCoaches.join(', ')}` : ''}</span>)}</dd></div><div><dt className="text-muted-foreground">Audience</dt><dd className="font-bold">{coaches.trim() ? `${preview.target.selectedCoachCount} selected coach${preview.target.selectedCoachCount === 1 ? '' : 'es'} across matching runs` : 'All passengers following the resolved runs'}</dd></div><div><dt className="text-muted-foreground">Window</dt><dd className="font-bold">{new Date(preview.preview.startsAt).toLocaleString()} — {new Date(preview.preview.expiresAt).toLocaleString()}</dd></div></dl>
                <label className="flex items-start gap-3 rounded-lg border p-3 text-sm font-semibold"><input className="mt-1" type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />I approve this exact message, trip, audience, start, and expiry.</label>
                <Button className="w-full" disabled={!approved || busy} onClick={() => void publish()}><Send className="mr-2 h-4 w-4" />{editingId ? 'Approve and publish edit' : 'Approve and publish'}</Button>
                <p className="text-xs text-muted-foreground">Published means eligible passenger views can receive the notice. This system does not measure or claim that a passenger read it.</p>
              </div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Publication history</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {communications.map(item => <article key={item.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-2 text-xs font-black uppercase"><Radio className="h-3.5 w-3.5" />{templates[item.type]?.label ?? item.type}<span className="rounded-full bg-muted px-2 py-0.5">{item.publicationStatus}</span></p><p className="mt-1 text-sm font-semibold">{item.message}</p><p className="mt-2 text-xs font-bold">{item.affectedRunCount} affected departure{item.affectedRunCount === 1 ? '' : 's'}</p><p className="mt-1 break-all text-xs text-muted-foreground">{item.officialRunKeys.join(' · ')}{item.targetCoachNumbers.length ? ` · coaches ${item.targetCoachNumbers.join(', ')}` : ''}</p><p className="mt-1 text-xs text-muted-foreground">Receipt/read status: not measured</p></div>{item.publicationStatus !== 'withdrawn' && item.publicationStatus !== 'expired' && <div className="flex"><Button variant="ghost" size="icon" aria-label="Edit communication" onClick={() => edit(item)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" aria-label="Withdraw communication" onClick={() => void withdraw(item.id)}><X className="h-4 w-4" /></Button></div>}</div>
              </article>)}
              {!communications.length && <p className="text-sm text-muted-foreground">No passenger communications have been published.</p>}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}