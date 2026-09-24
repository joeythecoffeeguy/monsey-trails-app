import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BellRing, Loader2, Pencil, Trash2 } from 'lucide-react';
import type { DepartureReminder, DepartureReminderInput } from '@workspace/api-client-react';
import {
  DEFAULT_DEPARTURE_REMINDER_LEAD_MINUTES,
  departureReminderPermissionState,
  prepareWebDepartureReminderDelivery,
  webDepartureReminderApi,
  webDepartureRemindersSupported,
} from '@/lib/departure-reminders';

const DAYS = [
  { value: 1, short: 'M', long: 'Monday' }, { value: 2, short: 'T', long: 'Tuesday' },
  { value: 3, short: 'W', long: 'Wednesday' }, { value: 4, short: 'T', long: 'Thursday' },
  { value: 5, short: 'F', long: 'Friday' }, { value: 6, short: 'S', long: 'Saturday' },
  { value: 7, short: 'S', long: 'Sunday' },
] as const;
const LEADS = [5, 15, 30, 60] as const;

function messageFor(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  const value = error as { data?: { error?: string }; message?: string } | null;
  return value?.data?.error ?? value?.message ?? fallback;
}

function weekdayFor(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day || 7;
}

function occurrenceLabel(value: string | null) {
  if (!value) return 'Checking next published service';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

export function DepartureReminderPanel({ runKey }: { runKey: string }) {
  const parts = runKey.split('|');
  const selectedTrip = useMemo(() => parts.length === 5 ? {
    serviceDate: parts[0],
    line: Number(parts[1]),
    origin: Number(parts[2]),
    destination: Number(parts[3]),
    runId: parts[4],
  } : null, [runKey]);
  const [reminders, setReminders] = useState<DepartureReminder[]>([]);
  const [kind, setKind] = useState<'once' | 'weekly'>('once');
  const [weekdays, setWeekdays] = useState<number[]>(() => selectedTrip ? [weekdayFor(selectedTrip.serviceDate)] : []);
  const [leadMinutes, setLeadMinutes] = useState(DEFAULT_DEPARTURE_REMINDER_LEAD_MINUTES);
  const [editing, setEditing] = useState<DepartureReminder | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [permission, setPermission] = useState(() => departureReminderPermissionState());

  const load = useCallback(async () => {
    try {
      setReminders((await webDepartureReminderApi.list()).reminders);
    } catch (error) {
      setMessage(messageFor(error, 'Could not load reminders.'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!selectedTrip) return null;
  const relevant = reminders.filter(reminder =>
    reminder.line === selectedTrip.line && reminder.origin === selectedTrip.origin
    && reminder.destination === selectedTrip.destination && reminder.runId === selectedTrip.runId
    && (reminder.kind === 'weekly' || reminder.serviceDate === selectedTrip.serviceDate)
    && reminder.state !== 'cancelled',
  );

  const toggleDay = (day: number) => setWeekdays(current => current.includes(day)
    ? current.filter(value => value !== day)
    : [...current, day].sort((a, b) => a - b));

  const edit = (reminder: DepartureReminder) => {
    setEditing(reminder);
    setKind(reminder.kind);
    setWeekdays(reminder.weekdays.length ? reminder.weekdays : [weekdayFor(selectedTrip.serviceDate)]);
    setLeadMinutes(reminder.leadMinutes);
    setMessage('');
  };

  const save = async () => {
    if (kind === 'weekly' && !weekdays.length) {
      setMessage('Choose at least one weekday.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const delivery = await prepareWebDepartureReminderDelivery();
      setPermission('granted');
      const input: Omit<DepartureReminderInput, 'deviceId'> = {
        ...selectedTrip,
        line: selectedTrip.line as 1 | 2 | 3,
        kind,
        ...(kind === 'weekly' ? { weekdays } : {}),
        leadMinutes,
        delivery,
      };
      const result = editing
        ? await webDepartureReminderApi.update(editing.id, input)
        : await webDepartureReminderApi.create(input);
      setReminders(current => [result.reminder, ...current.filter(item => item.id !== result.reminder.id)]);
      setMessage(editing ? 'Reminder updated.' : 'Departure reminder set.');
      setEditing(null);
    } catch (error) {
      setPermission(departureReminderPermissionState());
      setMessage(messageFor(error, 'Could not save the reminder.'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (reminder: DepartureReminder) => {
    setBusy(true);
    setMessage('');
    try {
      await webDepartureReminderApi.cancel(reminder.id);
      setReminders(current => current.filter(item => item.id !== reminder.id));
      if (editing?.id === reminder.id) setEditing(null);
      setMessage('Reminder cancelled.');
    } catch (error) {
      setMessage(messageFor(error, 'Could not cancel the reminder.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-sm" aria-labelledby="departure-reminder-title">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          {relevant.length ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="departure-reminder-title" className="text-base font-black text-foreground">Departure reminder</h2>
          <p className="text-xs font-semibold leading-relaxed text-muted-foreground">Server push, rechecked against the published schedule before every alert.</p>
        </div>
      </div>

      {relevant.map(reminder => (
        <div key={reminder.id} className="mt-3 flex items-center gap-2 rounded-xl bg-muted/50 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-black text-foreground">
              {reminder.kind === 'once' ? 'One trip' : `Weekly · ${reminder.weekdays.map(day => DAYS[day - 1]?.short).join(' ')}`} · {reminder.leadMinutes} min before
            </p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-muted-foreground">{occurrenceLabel(reminder.nextOccurrenceAt)}</p>
          </div>
          <button type="button" onClick={() => edit(reminder)} aria-label="Edit departure reminder" className="rounded-full border border-border p-2 text-primary"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => void cancel(reminder)} disabled={busy} aria-label="Cancel departure reminder" className="rounded-full border border-border p-2 text-destructive disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}

      <div className="mt-4 grid grid-cols-2 rounded-xl bg-muted p-1">
        {(['once', 'weekly'] as const).map(value => (
          <button key={value} type="button" role="radio" aria-checked={kind === value} onClick={() => setKind(value)} className={`rounded-lg px-3 py-2 text-xs font-black ${kind === value ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'}`}>
            {value === 'once' ? 'This trip' : 'Selected weekdays'}
          </button>
        ))}
      </div>

      {kind === 'weekly' && (
        <div className="mt-3 flex justify-between gap-1" aria-label="Repeat weekdays">
          {DAYS.map(day => (
            <button key={day.value} type="button" aria-label={day.long} aria-pressed={weekdays.includes(day.value)} onClick={() => toggleDay(day.value)} className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-black ${weekdays.includes(day.value) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground'}`}>{day.short}</button>
          ))}
        </div>
      )}

      <p className="mb-2 mt-4 text-xs font-black text-foreground">Alert me before departure</p>
      <div className="grid grid-cols-4 gap-1.5">
        {LEADS.map(value => (
          <button key={value} type="button" role="radio" aria-checked={leadMinutes === value} onClick={() => setLeadMinutes(value)} className={`rounded-lg border px-2 py-2 text-xs font-black ${leadMinutes === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground'}`}>{value < 60 ? `${value} min` : '1 hr'}</button>
        ))}
      </div>

      <button type="button" onClick={() => void save()} disabled={busy || permission === 'unsupported'} data-testid="save-departure-reminder" className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? 'Saving…' : editing ? 'Save changes' : 'Set reminder'}
      </button>
      {editing && <button type="button" onClick={() => setEditing(null)} className="mt-2 w-full text-xs font-bold text-muted-foreground">Cancel editing</button>}

      {message && <p role="alert" className={`mt-3 text-xs font-bold ${/Could not|blocked|Choose|require/i.test(message) ? 'text-destructive' : 'text-primary'}`}>{message}</p>}
      {permission === 'denied' && <p className="mt-1 text-xs font-semibold text-destructive">Notifications are blocked. Allow notifications in your browser or installed app settings, then try again.</p>}
      {permission === 'unsupported' && <p className="mt-3 text-xs font-semibold text-destructive">{webDepartureRemindersSupported() ? 'Push is unavailable.' : 'Install this web app in a browser that supports background notifications. On iPhone, add it to the Home Screen first.'}</p>}
      <p className="mt-3 text-[11px] font-semibold leading-relaxed text-muted-foreground">{relevant[0]?.policy ?? 'Weekly reminders only fire when this trip is actually published. Changed times replace old times; removed trips send a cancellation. A rare duplicate is possible if the server crashes after push acceptance; stable notification tags help collapse duplicates.'}</p>
      <p className="mt-1 text-[10px] font-bold leading-relaxed text-amber-800">Background reminders require always-on or externally scheduled server processing. This deployment may scale to zero while idle, so reminders can be delayed until processing resumes.</p>
      <p className="mt-1 text-[10px] font-medium leading-relaxed text-muted-foreground">Delivery also depends on your network and the browser notification service. No open-tab timer is used.</p>
    </section>
  );
}