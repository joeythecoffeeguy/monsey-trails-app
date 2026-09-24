import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { Link, Redirect } from 'wouter';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';

type Assignment = {
  id: number;
  busNumber: string;
  driverSubject?: string;
  driverId?: string | null;
  driverName: string | null;
  officialRunKey: string;
  direction: string;
  serviceDate: string;
  endedAt?: string | null;
  completedAt?: string | null;
};

type IncidentEvent = {
  id: string;
  eventType: string;
  note: string;
  actorSubject: string;
  evidenceType: string | null;
  evidenceId: string | null;
  createdAt: string;
};

type Incident = {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  operationalReportId: string | null;
  replacementAssignmentId: number | null;
  openedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
  affectedAssignments: Assignment[];
  events: IncidentEvent[];
};

type OperationalReport = {
  id: string;
  assignmentId: number;
  busNumber: string;
  category: string;
  createdAt: string;
  resolvedAt: string | null;
};

const eventLabels: Record<string, string> = {
  issue_identified: 'Issue identified',
  progress_note: 'Progress note',
  replacement_confirmed: 'Replacement verified',
  driver_instruction_confirmed: 'Driver instruction recorded',
  passenger_notice_confirmed: 'Passenger notice published',
  resolved: 'Incident resolved',
};

function assignmentLabel(item: Assignment) {
  return `Coach ${item.busNumber} · ${item.direction} · ${item.serviceDate}`;
}

export default function AdminIncidents() {
  const { isLoaded, userId, getToken } = useAuth();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [reports, setReports] = useState<OperationalReport[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

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
      throw new Error(body.error || `Request failed (${response.status}).`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }, [getToken]);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [nextIncidents, nextAssignments, communications] = await Promise.all([
        request<Incident[]>('/admin/incidents?includeResolved=true'),
        request<Assignment[]>('/admin/dispatch-assignments'),
        request<{ reports: OperationalReport[] }>('/admin/communications'),
      ]);
      setIncidents(nextIncidents);
      setAssignments(nextAssignments);
      setReports(communications.reports);
      setSelectedId(current => current || nextIncidents.find(item => !item.resolvedAt)?.id || nextIncidents[0]?.id || '');
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Incidents could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [request, userId]);

  useEffect(() => { void load(); }, [load]);

  const selected = incidents.find(item => item.id === selectedId) ?? null;
  const activeAssignments = useMemo(
    () => assignments.filter(item => !item.completedAt && !item.endedAt),
    [assignments],
  );

  async function replaceIncident(updated: Incident) {
    setIncidents(current => current.some(item => item.id === updated.id)
      ? current.map(item => item.id === updated.id ? updated : item)
      : [updated, ...current]);
    setSelectedId(updated.id);
  }

  async function mutate(path: string, body: unknown, action: string) {
    setBusy(action);
    try {
      const updated = await request<Incident>(path, { method: 'POST', body: JSON.stringify(body) });
      await replaceIncident(updated);
      return updated;
    } catch (mutationError) {
      toast.error(mutationError instanceof Error ? mutationError.message : 'The incident could not be updated.');
      return null;
    } finally {
      setBusy('');
    }
  }

  if (!isLoaded) return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!userId) return <Redirect to={`${appUrl('/sign-in')}?redirect_url=${encodeURIComponent(appUrl(APP_ROUTES.adminIncidents))}`} />;

  return (
      <main className="space-y-5 p-5 lg:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black">Guided incident response</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Every consequential step requires confirmation and persisted server evidence. This workflow never cancels, reassigns, starts, or stops a trip automatically.
            </p>
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh evidence
          </Button>
        </div>

        {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div>}

        <CreateIncident
          assignments={assignments}
          reports={reports}
          busy={busy === 'create'}
          onCreate={async body => {
            const created = await mutate('/admin/incidents', body, 'create');
            if (created) toast.success('Incident opened with affected trips recorded.');
          }}
        />

        <div className="grid gap-5 xl:grid-cols-[310px_minmax(0,1fr)]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5" />Incidents</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {incidents.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full rounded-xl border p-3 text-left ${selectedId === item.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/60'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-black">{item.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${item.resolvedAt ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>{item.resolvedAt ? 'Resolved' : item.severity}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.affectedAssignments.length} affected trip{item.affectedAssignments.length === 1 ? '' : 's'} · {new Date(item.openedAt).toLocaleString()}</p>
                </button>
              ))}
              {!incidents.length && !loading && <p className="py-8 text-center text-sm text-muted-foreground">No incidents have been opened.</p>}
            </CardContent>
          </Card>

          {selected ? (
            <IncidentWorkflow
              incident={selected}
              activeAssignments={activeAssignments}
              busy={busy}
              request={request}
              mutate={mutate}
            />
          ) : (
            <Card><CardContent className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">Open or select an incident to begin.</CardContent></Card>
          )}
        </div>
      </main>
  );
}

function CreateIncident({
  assignments,
  reports,
  busy,
  onCreate,
}: {
  assignments: Assignment[];
  reports: OperationalReport[];
  busy: boolean;
  onCreate: (body: unknown) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('high');
  const [reportId, setReportId] = useState('');
  const [affected, setAffected] = useState<number[]>([]);

  function selectReport(value: string) {
    setReportId(value);
    const report = reports.find(item => item.id === value);
    if (report) setAffected(current => current.includes(report.assignmentId) ? current : [...current, report.assignmentId]);
  }

  return (
    <Card>
      <CardHeader><CardTitle>1. Identify the issue and affected existing trips</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <Input value={title} onChange={event => setTitle(event.target.value)} maxLength={160} placeholder="Incident title" aria-label="Incident title" />
          <select className="h-10 rounded-md border bg-background px-3" value={severity} onChange={event => setSeverity(event.target.value)} aria-label="Severity">
            <option value="low">Low severity</option><option value="medium">Medium severity</option><option value="high">High severity</option><option value="critical">Critical severity</option>
          </select>
        </div>
        <Textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} placeholder="What happened? Include observable facts, not assumptions." aria-label="Issue description" />
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <select className="h-10 rounded-md border bg-background px-3" value={reportId} onChange={event => selectReport(event.target.value)} aria-label="Operational report">
            <option value="">No linked operational report</option>
            {reports.map(report => <option key={report.id} value={report.id}>Coach {report.busNumber} · {report.category.replaceAll('_', ' ')} · {new Date(report.createdAt).toLocaleString()}</option>)}
          </select>
          <Button asChild variant="outline"><Link href={APP_ROUTES.adminDispatch}>Open operational reports <ExternalLink className="ml-2 h-4 w-4" /></Link></Button>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-bold">Affected trips</legend>
          <div className="grid max-h-40 gap-2 overflow-auto rounded-xl border p-3 md:grid-cols-2">
            {assignments.map(item => (
              <label key={item.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={affected.includes(item.id)}
                  onChange={event => setAffected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}
                />
                <span>{assignmentLabel(item)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button
          disabled={busy || !title.trim() || !description.trim() || !affected.length}
          onClick={() => {
            if (!window.confirm(`Open this ${severity}-severity incident for ${affected.length} affected trip(s)? No trip will be changed.`)) return;
            void onCreate({ title, description, severity, affectedAssignmentIds: affected, operationalReportId: reportId || undefined });
          }}
        >
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Open incident
        </Button>
      </CardContent>
    </Card>
  );
}

function IncidentWorkflow({
  incident,
  activeAssignments,
  busy,
  request,
  mutate,
}: {
  incident: Incident;
  activeAssignments: Assignment[];
  busy: string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  mutate: (path: string, body: unknown, action: string) => Promise<Incident | null>;
}) {
  const [replacementId, setReplacementId] = useState(incident.replacementAssignmentId ? String(incident.replacementAssignmentId) : '');
  const [instructionAssignmentId, setInstructionAssignmentId] = useState('');
  const [instruction, setInstruction] = useState('');
  const [noticeRunKey, setNoticeRunKey] = useState(incident.affectedAssignments[0]?.officialRunKey || '');
  const [noticeType, setNoticeType] = useState('delay');
  const [noticeMessage, setNoticeMessage] = useState('');
  const [delayMinutes, setDelayMinutes] = useState('15');
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [notNeededStep, setNotNeededStep] = useState('replacement');
  const [notNeededReason, setNotNeededReason] = useState('');
  const completed = new Set(incident.events.map(item => item.eventType));
  const open = !incident.resolvedAt;
  const instructionTargets = [
    ...incident.affectedAssignments,
    ...activeAssignments.filter(item => item.id === incident.replacementAssignmentId),
  ].filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index);
  const replacementChoices = activeAssignments.filter(item => !incident.affectedAssignments.some(affected => affected.id === item.id));

  useEffect(() => {
    setReplacementId(incident.replacementAssignmentId ? String(incident.replacementAssignmentId) : '');
  }, [incident.id, incident.replacementAssignmentId]);

  async function sendInstruction() {
    const assignmentId = Number(instructionAssignmentId);
    if (!assignmentId || !instruction.trim()) return;
    if (!window.confirm('Send this instruction to the selected driver? It will be persisted immediately; delivery and acknowledgement remain visible in Communications.')) return;
    try {
      const created = await request<{ id: string }>('/admin/dispatch-instructions', {
        method: 'POST',
        body: JSON.stringify({ assignmentId, message: instruction.trim() }),
      });
      const updated = await mutate(`/admin/incidents/${incident.id}/confirm-instruction`, { instructionId: created.id }, 'instruction');
      if (updated) {
        setInstruction('');
        toast.success('Driver instruction persisted and recorded as incident evidence.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Driver instruction could not be sent.');
    }
  }

  async function publishNotice() {
    if (!noticeRunKey || !noticeMessage.trim()) return;
    if (!window.confirm('Publish this passenger-facing notice now? This affects live passenger information and does not change the trip assignment or operating state.')) return;
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    try {
      const created = await request<{ id: string }>('/admin/service-disruptions', {
        method: 'POST',
        body: JSON.stringify({
          officialRunKey: noticeRunKey,
          type: noticeType,
          message: noticeMessage.trim(),
          delayMinutes: noticeType === 'delay' ? Number(delayMinutes) : undefined,
          expiresAt,
        }),
      });
      const updated = await mutate(`/admin/incidents/${incident.id}/confirm-notice`, { disruptionId: created.id }, 'notice');
      if (updated) {
        setNoticeMessage('');
        toast.success('Passenger notice published and recorded as incident evidence.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Passenger notice could not be published.');
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <span>{incident.title}</span>
            <span className="rounded-full bg-muted px-3 py-1 text-xs uppercase">{incident.status.replaceAll('_', ' ')}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">{incident.description}</p>
          <div className="flex flex-wrap gap-2">
            {incident.affectedAssignments.map(item => <span key={item.id} className="rounded-full border px-3 py-1 text-xs font-bold">{assignmentLabel(item)}</span>)}
          </div>
          {incident.operationalReportId && <p className="text-xs text-muted-foreground">Linked operational report: {incident.operationalReportId}</p>}
        </CardContent>
      </Card>

      {open && (
        <>
          <StepCard number="2" title="Select and verify a replacement" complete={completed.has('replacement_confirmed') || completed.has('replacement_not_needed')}>
            <p className="text-sm text-muted-foreground">Use Dispatch for any assignment change. Returning here only verifies the resulting active assignment from server records; it does not reassign a coach or driver.</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><Link href={APP_ROUTES.adminDispatch}>Open authorized dispatch <ExternalLink className="ml-2 h-4 w-4" /></Link></Button>
              <select className="h-10 min-w-64 rounded-md border bg-background px-3" value={replacementId} onChange={event => setReplacementId(event.target.value)} aria-label="Verified replacement assignment">
                <option value="">Choose active replacement</option>
                {replacementChoices.map(item => <option key={item.id} value={item.id}>{assignmentLabel(item)}</option>)}
              </select>
              <Button
                disabled={!replacementId || Boolean(busy)}
                onClick={() => {
                  if (!window.confirm('Record this active dispatch assignment as the verified replacement? This does not perform or change any assignment.')) return;
                  void mutate(`/admin/incidents/${incident.id}/confirm-replacement`, { replacementAssignmentId: Number(replacementId) }, 'replacement');
                }}
              >Verify server result</Button>
            </div>
          </StepCard>

          <StepCard number="3" title="Send driver instructions" complete={completed.has('driver_instruction_confirmed') || completed.has('driver_instruction_not_needed')}>
            <div className="grid gap-2 md:grid-cols-[240px_1fr_auto]">
              <select className="h-10 rounded-md border bg-background px-3" value={instructionAssignmentId} onChange={event => setInstructionAssignmentId(event.target.value)} aria-label="Instruction trip">
                <option value="">Choose incident trip</option>
                {instructionTargets.map(item => <option key={item.id} value={item.id}>{assignmentLabel(item)}</option>)}
              </select>
              <Input value={instruction} onChange={event => setInstruction(event.target.value)} maxLength={500} placeholder="Clear, safety-conscious instruction" aria-label="Driver instruction" />
              <Button disabled={!instructionAssignmentId || !instruction.trim() || Boolean(busy)} onClick={() => void sendInstruction()}>
                <Send className="mr-2 h-4 w-4" />Send
              </Button>
            </div>
          </StepCard>

          <StepCard number="4" title="Publish a passenger notice" complete={completed.has('passenger_notice_confirmed') || completed.has('passenger_notice_not_needed')}>
            <div className="grid gap-2 md:grid-cols-2">
              <select className="h-10 rounded-md border bg-background px-3" value={noticeRunKey} onChange={event => setNoticeRunKey(event.target.value)} aria-label="Passenger notice trip">
                {incident.affectedAssignments.map(item => <option key={item.id} value={item.officialRunKey}>{assignmentLabel(item)}</option>)}
              </select>
              <select className="h-10 rounded-md border bg-background px-3" value={noticeType} onChange={event => setNoticeType(event.target.value)} aria-label="Notice type">
                <option value="delay">Delay</option><option value="detour">Detour</option><option value="cancellation">Cancellation notice</option>
              </select>
              {noticeType === 'delay' && <Input type="number" min={1} max={600} value={delayMinutes} onChange={event => setDelayMinutes(event.target.value)} aria-label="Delay minutes" />}
              <Input value={noticeMessage} onChange={event => setNoticeMessage(event.target.value)} placeholder="Passenger-facing plain text" aria-label="Passenger notice" />
            </div>
            <Button disabled={!noticeMessage.trim() || Boolean(busy)} onClick={() => void publishNotice()}>Publish confirmed notice</Button>
          </StepCard>

          <Card>
            <CardHeader><CardTitle>Document an unrelated step</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">Do not create replacement, instruction, or passenger-notice evidence when it is unrelated to this incident. Document why the step is not needed instead.</p>
              <div className="grid gap-2 md:grid-cols-[220px_1fr_auto]">
                <select className="h-10 rounded-md border bg-background px-3" value={notNeededStep} onChange={event => setNotNeededStep(event.target.value)} aria-label="Step not needed">
                  <option value="replacement">Replacement</option>
                  <option value="driver_instruction">Driver instruction</option>
                  <option value="passenger_notice">Passenger notice</option>
                </select>
                <Input value={notNeededReason} onChange={event => setNotNeededReason(event.target.value)} placeholder="Why this step is unrelated or unnecessary" aria-label="Not-needed reason" />
                <Button variant="outline" disabled={notNeededReason.trim().length < 10 || Boolean(busy)} onClick={async () => {
                  const updated = await mutate(`/admin/incidents/${incident.id}/not-needed`, { step: notNeededStep, reason: notNeededReason.trim() }, 'not-needed');
                  if (updated) setNotNeededReason('');
                }}>Record not needed</Button>
              </div>
            </CardContent>
          </Card>

          <StepCard number="5" title="Resolve after evidence is complete" complete={false}>
            <Textarea value={resolution} onChange={event => setResolution(event.target.value)} maxLength={2000} placeholder="Resolution and final operating condition" aria-label="Incident resolution" />
            <Button
              disabled={!resolution.trim() || Boolean(busy)
                || !(completed.has('replacement_confirmed') || completed.has('replacement_not_needed'))
                || !(completed.has('driver_instruction_confirmed') || completed.has('driver_instruction_not_needed'))
                || !(completed.has('passenger_notice_confirmed') || completed.has('passenger_notice_not_needed'))}
              onClick={() => {
                if (!window.confirm('Resolve this incident? This closes the incident record only and does not cancel, reassign, start, or stop any trip.')) return;
                void mutate(`/admin/incidents/${incident.id}/resolve`, { resolution: resolution.trim(), confirmation: 'RESOLVE' }, 'resolve');
              }}
            >Resolve incident</Button>
          </StepCard>
        </>
      )}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" />Durable progress notes</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {open && (
            <div className="flex gap-2">
              <Input value={note} onChange={event => setNote(event.target.value)} maxLength={2000} placeholder="Add an observable update" aria-label="Progress note" />
              <Button
                variant="outline"
                disabled={!note.trim() || Boolean(busy)}
                onClick={async () => {
                  const updated = await mutate(`/admin/incidents/${incident.id}/notes`, { note: note.trim() }, 'note');
                  if (updated) setNote('');
                }}
              >Add note</Button>
            </div>
          )}
          <ol className="space-y-3">
            {[...incident.events].reverse().map(event => (
              <li key={event.id} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-black">
                    {event.eventType !== 'progress_note' && <CheckCircle2 className="h-4 w-4 text-primary" />}
                    {eventLabels[event.eventType] || event.eventType.replaceAll('_', ' ')}
                  </p>
                  <time className="text-xs text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</time>
                </div>
                <p className="mt-1 text-sm">{event.note}</p>
                <p className="mt-1 text-xs text-muted-foreground">Actor {event.actorSubject}{event.evidenceType ? ` · ${event.evidenceType} evidence ${event.evidenceId}` : ''}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function StepCard({ number, title, complete, children }: { number: string; title: string; complete: boolean; children: ReactNode }) {
  return (
    <Card className={complete ? 'border-emerald-300' : ''}>
      <CardHeader><CardTitle className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground">{complete ? '✓' : number}</span>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}