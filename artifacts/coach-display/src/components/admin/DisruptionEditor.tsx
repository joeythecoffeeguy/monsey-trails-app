import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { AlertTriangle, Loader2, Pencil, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { ServiceDisruption } from '@/providers/live-trip';

type DisruptionType = ServiceDisruption['type'];
const labels: Record<DisruptionType, string> = {
  delay: 'Delay',
  detour: 'Detour',
  skipped_stop: 'Skipped stop',
  boarding_change: 'Boarding change',
  cancellation: 'Cancellation',
};

function defaultExpiry() {
  const date = new Date(Date.now() + 4 * 60 * 60_000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function DisruptionEditor({ runKey }: { runKey: string }) {
  const { getToken } = useAuth();
  const [notices, setNotices] = useState<ServiceDisruption[]>([]);
  const [editing, setEditing] = useState<ServiceDisruption | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DisruptionType>('delay');
  const [message, setMessage] = useState('');
  const [delayMinutes, setDelayMinutes] = useState('15');
  const [stopName, setStopName] = useState('');
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [saving, setSaving] = useState(false);

  async function request<T>(path: string, init?: RequestInit) {
    const token = await getToken();
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || `Request failed (${response.status})`);
    }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }

  async function load() {
    try {
      setNotices(await request<ServiceDisruption[]>(`/admin/service-disruptions?runKey=${encodeURIComponent(runKey)}`));
    } catch {
      // The dispatch board's administrator gate already surfaces access failures.
    }
  }

  useEffect(() => { void load(); }, [runKey]);

  function beginEdit(notice?: ServiceDisruption) {
    setEditing(notice ?? null);
    setType(notice?.type ?? 'delay');
    setMessage(notice?.message ?? '');
    setDelayMinutes(notice?.delayMinutes?.toString() ?? '15');
    setStopName(notice?.stopName ?? '');
    if (notice) {
      const date = new Date(notice.expiresAt);
      date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
      setExpiresAt(date.toISOString().slice(0, 16));
    } else {
      setExpiresAt(defaultExpiry());
    }
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      await request(editing ? `/admin/service-disruptions/${editing.id}` : '/admin/service-disruptions', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          officialRunKey: runKey,
          type,
          message,
          expiresAt: new Date(expiresAt).toISOString(),
          delayMinutes: type === 'delay' ? Number(delayMinutes) : null,
          stopName: type === 'skipped_stop' ? stopName : null,
        }),
      });
      setOpen(false);
      toast.success(editing ? 'Service notice updated.' : 'Service notice published.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Service notice could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function clear(notice: ServiceDisruption) {
    try {
      await request(`/admin/service-disruptions/${notice.id}`, { method: 'DELETE' });
      toast.success('Service notice cleared from passenger views.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Service notice could not be cleared.');
    }
  }

  return (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> Service notices
        </p>
        <Button size="sm" variant="outline" onClick={() => beginEdit()}><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button>
      </div>
      {notices.map(notice => (
        <div key={notice.id} className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-950">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-black">{labels[notice.type]}{notice.delayMinutes ? ` · ${notice.delayMinutes} min` : ''}{notice.stopName ? ` · ${notice.stopName}` : ''}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs font-semibold">{notice.message}</p>
              <p className="mt-1 text-[10px]">Expires {new Date(notice.expiresAt).toLocaleString()}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="icon" variant="ghost" aria-label="Edit service notice" onClick={() => beginEdit(notice)}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" aria-label="Clear service notice" onClick={() => void clear(notice)}><X className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>
      ))}
      {open && (
        <div className="mt-3 space-y-2 rounded-xl border bg-background p-3">
          <select aria-label="Notice type" className="h-10 w-full rounded-md border bg-background px-3" value={type} onChange={event => setType(event.target.value as DisruptionType)}>
            {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          {type === 'delay' && <Input aria-label="Delay minutes" type="number" min={1} max={1440} value={delayMinutes} onChange={event => setDelayMinutes(event.target.value)} />}
          {type === 'skipped_stop' && <Input aria-label="Affected stop" maxLength={160} placeholder="Affected stop" value={stopName} onChange={event => setStopName(event.target.value)} />}
          <Textarea aria-label="Passenger notice" maxLength={500} placeholder="Plain-text passenger notice" value={message} onChange={event => setMessage(event.target.value)} />
          <Input aria-label="Notice expiration" type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} />
          <p className="text-xs text-muted-foreground">This appears as a service notice only. It will not replace emergency messaging and clears automatically at expiration.</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={saving || !message.trim() || !expiresAt} onClick={() => void save()}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} {editing ? 'Save changes' : 'Publish notice'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}