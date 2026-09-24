import { useState, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/react';
import { Redirect, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  useGetAdminAccess,
  useListAdminScheduleStops,
  useCreateAdminScheduleStop,
  useDeleteAdminScheduleStop,
  useUpdateAdminScheduleStop,
  usePreviewAdminScheduleStopImpact,
  useCreateAdminScheduledStopChange,
  useListAdminScheduledStopChanges,
  useSearchAdminAddresses,
  getListAdminScheduleStopsQueryKey,
  getGetAdminAccessQueryKey,
  getSearchAdminAddressesQueryKey,
  getListAdminScheduledStopChangesQueryKey,
} from '@workspace/api-client-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { 
  Loader2, 
  MapPin, 
  Search, 
  Save, 
  Navigation, 
  Check, 
  AlertCircle,
  RefreshCw,
  Building2,
  Crosshair,
  Map as MapIcon
  , Plus, Trash2
} from 'lucide-react';
import type { AdminScheduleStop, AdminScheduleStopUpdate, AdminAddressSearchResult, AdminStopChangeImpact, ErrorType } from '@workspace/api-client-react';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';
import { useDebounce } from '@/hooks/use-debounce';

const updateStopSchema = z.object({
  address: z.string().max(320).nullable().optional(),
  lat: z.coerce.number().min(-90, 'Must be between -90 and 90').max(90, 'Must be between -90 and 90'),
  lng: z.coerce.number().min(-180, 'Must be between -180 and 180').max(180, 'Must be between -180 and 180'),
  category: z.enum(['pickup', 'dropoff', 'both']),
});

type FormValues = z.infer<typeof updateStopSchema>;

type QueuedStopChange = {
  id: string;
  kind: 'create' | 'update' | 'delete';
  stopKey: string | null;
  change: Record<string, unknown>;
  state: string;
  applyAt: string;
};

const STOP_AREAS = [
  [1, 'New Square'], [2, 'Monsey'], [3, 'Boro Park'], [4, 'Williamsburg'],
  [5, 'Manhattan'], [6, 'Wall Street'], [7, 'Lakewood (Westgate)'],
  [8, 'Lakewood (Sq. Kennedy)'], [9, 'Flatbush'], [10, 'Kiryas Yoel'],
  [11, 'B&H'], [12, 'Crown Heights'],
] as const;

const STOP_CATEGORIES = [
  ['pickup', 'Pickup only'],
  ['dropoff', 'Drop-off only'],
  ['both', 'Pickup & drop-off'],
] as const;

function categoryLabel(category: AdminScheduleStop['category']) {
  return STOP_CATEGORIES.find(([value]) => value === category)?.[1] ?? 'Pickup & drop-off';
}

export function adminStopMatchesRole(
  stop: Pick<AdminScheduleStop, 'category'>,
  role: 'pickup' | 'dropoff',
) {
  return stop.category === 'both' || stop.category === role;
}

export function buildAdminStopUpdate(
  values: FormValues,
  dirty: Partial<Record<keyof FormValues, boolean>>,
): Omit<AdminScheduleStopUpdate, 'confirmedImpactRevision'> {
  const locationDirty = dirty.address || dirty.lat || dirty.lng;
  return {
    ...(locationDirty ? {
      address: values.address || null,
      lat: values.lat,
      lng: values.lng,
    } : {}),
    ...(dirty.category ? { category: values.category } : {}),
  };
}

function ImpactConfirmation({ impact, busy, action, onCancel, onConfirm, onSchedule }: {
  impact: AdminStopChangeImpact;
  busy: boolean;
  action: string;
  onCancel: () => void;
  onConfirm: () => void;
  onSchedule?: (applyAt: string) => void;
}) {
  const [applyAt, setApplyAt] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
      <Card className="max-h-[90dvh] w-full max-w-xl overflow-y-auto shadow-2xl">
        <CardHeader>
          <CardTitle>Review actual impact</CardTitle>
          <CardDescription>This snapshot must still match when the server applies the change.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-muted p-3"><b>{impact.affectedAreas.length}</b><br />area</div>
            <div className="rounded-lg bg-muted p-3"><b>{impact.routes.length}</b><br />routes in server trips</div>
            <div className="rounded-lg bg-muted p-3"><b>{impact.upcomingTrips.length}</b><br />upcoming trips</div>
            <div className="rounded-lg bg-muted p-3"><b>{impact.activeTrips.length}</b><br />active trips</div>
          </div>
          <div className="rounded-lg border p-3">
            <p className="font-bold">Passenger evidence on this server</p>
            <p className="mt-1">{impact.serverEvidence.activeTripAlerts} active trip alerts · {impact.serverEvidence.departureReminders} departure reminders</p>
            <p className="mt-2 text-muted-foreground">Saved journeys and favorites live on passenger devices and cannot be counted by this server.</p>
          </div>
          {onSchedule && (
            <div className="rounded-lg border p-3">
              <label className="grid gap-2 font-bold">
                Optional future change
                <Input type="datetime-local" value={applyAt} onChange={event => setApplyAt(event.target.value)} />
              </label>
              <p className="mt-2 text-xs text-muted-foreground">
                This creates a durable queue item. Hosting may sleep, so an administrator must return and explicitly apply it when due.
              </p>
              <Button className="mt-3" variant="outline" disabled={busy || !applyAt} onClick={() => onSchedule(new Date(applyAt).toISOString())}>
                Queue for administrator review
              </Button>
            </div>
          )}
          {impact.activeTrips.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
              <p className="font-bold">Running coaches are protected</p>
              <p>Their current route and final stop will not change. The edit applies when later routes are built.</p>
            </div>
          )}
          <div className="rounded-lg border p-3">
            <p className="font-bold">Map behavior</p>
            <p className="mt-1 text-muted-foreground">{impact.mapWording}</p>
          </div>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={onCancel} disabled={busy}>Go back</Button>
            <Button variant={action === 'Remove stop' ? 'destructive' : 'default'} onClick={onConfirm} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm and {action.toLowerCase()}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminStops() {
  const { isLoaded, userId } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!userId) {
    return <Redirect to={`${appUrl('/sign-in')}?redirect_url=${encodeURIComponent(appUrl(APP_ROUTES.adminStops))}`} />;
  }

  return <AdminStopsContent userId={userId} />;
}

function AdminStopsContent({ userId }: { userId: string }) {
  const { data: access, isLoading: accessLoading, error: accessError, isError: isAccessError } = useGetAdminAccess({
    query: {
      queryKey: [...getGetAdminAccessQueryKey(), userId],
      retry: false,
      staleTime: 60000,
    }
  });

  if (accessLoading && !access) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const isDenied = isAccessError && accessError && (accessError as ErrorType).status === 403;
  const isUnauthorized = isAccessError && accessError && (accessError as ErrorType).status === 401;
  const isOtherError = isAccessError && !isDenied && !isUnauthorized;

  if (isOtherError || isDenied || isUnauthorized || (access && !access.authorized)) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center p-6 bg-background text-foreground">
        <Card className="w-full max-w-md border-red-200">
          <CardHeader className="bg-red-50 text-red-900 rounded-t-xl border-b border-red-100">
            <CardTitle className="flex items-center gap-2"><AlertCircle className="h-5 w-5" /> Access Denied</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-red-800 mb-4">
              You do not have the required administrator role to access this page, or your session has expired.
            </p>
            <Button asChild className="w-full"><Link href="/operator">Return to driver app</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <AdminStopsBoard />;
}

function AdminStopsBoard() {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: stops = [], isLoading, isError, refetch, isFetching } = useListAdminScheduleStops({
    query: {
      queryKey: getListAdminScheduleStopsQueryKey(),
      staleTime: 5 * 60 * 1000, // 5 mins
    }
  });
  const { data: scheduledData } = useListAdminScheduledStopChanges({
    query: { queryKey: getListAdminScheduledStopChangesQueryKey(), refetchInterval: 60_000 },
  });
  const scheduled = scheduledData as undefined | {
    changes?: QueuedStopChange[];
    dueChangeIds?: string[];
  };
  const queuedChanges = scheduled?.changes?.filter(change => change.state === 'queued') ?? [];
  const [queueBusy, setQueueBusy] = useState<string | null>(null);
  const [queueTimes, setQueueTimes] = useState<Record<string, string>>({});

  async function queueRequest(path: string, init: RequestInit) {
    const response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error || `Request failed (${response.status}).`);
    }
    return response;
  }

  async function cancelQueued(change: QueuedStopChange) {
    setQueueBusy(change.id);
    try {
      await queueRequest(`/admin/scheduled-stop-changes/${change.id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: getListAdminScheduledStopChangesQueryKey() });
      toast.success('Queued stop change cancelled.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The queued change could not be cancelled.');
    } finally {
      setQueueBusy(null);
    }
  }

  async function rescheduleQueued(change: QueuedStopChange) {
    const value = queueTimes[change.id];
    if (!value) return;
    setQueueBusy(change.id);
    try {
      await queueRequest(`/admin/scheduled-stop-changes/${change.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ applyAt: new Date(value).toISOString() }),
      });
      await queryClient.invalidateQueries({ queryKey: getListAdminScheduledStopChangesQueryKey() });
      toast.success('Queued application time updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The queued time could not be updated.');
    } finally {
      setQueueBusy(null);
    }
  }

  async function applyQueued(change: QueuedStopChange) {
    setQueueBusy(change.id);
    try {
      const impactResponse = await queueRequest('/admin/schedule-stops/impact', {
        method: 'POST',
        body: JSON.stringify({ kind: change.kind, key: change.stopKey, change: change.change }),
      });
      const impact = await impactResponse.json() as AdminStopChangeImpact;
      const evidence = `${impact.affectedAreas.length} areas, ${impact.upcomingTrips.length} upcoming trips, ${impact.activeTrips.length} active trips`;
      if (!window.confirm(`Fresh impact: ${evidence}. Apply this due change now?`)) return;
      await queueRequest(`/admin/scheduled-stop-changes/${change.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'applied', confirmedImpactRevision: impact.revision }),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAdminScheduledStopChangesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAdminScheduleStopsQueryKey() }),
      ]);
      toast.success('Due stop change applied.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The due change could not be applied.');
    } finally {
      setQueueBusy(null);
    }
  }

  const filteredStops = useMemo(() => {
    if (!searchQuery.trim()) return stops;
    const query = searchQuery.toLowerCase();
    return stops.filter(stop => 
      stop.sourceLabel.toLowerCase().includes(query) ||
      stop.canonicalLabel.toLowerCase().includes(query) ||
      stop.areaName.toLowerCase().includes(query) ||
      (stop.address && stop.address.toLowerCase().includes(query))
    );
  }, [stops, searchQuery]);

  // Group filtered stops by area
  const stopsByArea = useMemo(() => {
    const groups = new Map<string, AdminScheduleStop[]>();
    for (const stop of filteredStops) {
      if (!groups.has(stop.areaName)) {
        groups.set(stop.areaName, []);
      }
      groups.get(stop.areaName)!.push(stop);
    }
    // Sort areas by name
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredStops]);

  const selectedStop = useMemo(() => stops.find(s => s.key === selectedKey), [stops, selectedKey]);

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[520px] flex-col bg-muted/30 text-foreground overflow-hidden">
      {queuedChanges.length > 0 && (
        <div className="flex-none space-y-2 border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs text-amber-950">
          <p><b>{queuedChanges.length} stop {queuedChanges.length === 1 ? 'change is' : 'changes are'} durably queued.</b> A sleeping browser or server timer will not apply them automatically.</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {queuedChanges.map(change => {
              const due = scheduled?.dueChangeIds?.includes(change.id) ?? false;
              return (
                <div key={change.id} className="min-w-72 rounded-lg border border-amber-300 bg-white p-2 shadow-sm">
                  <p className="font-bold">{change.kind.toUpperCase()} · {change.stopKey || String(change.change.canonicalLabel || 'new stop')}</p>
                  <p className="mt-1">{due ? 'Due now — fresh impact confirmation required.' : `Due ${new Date(change.applyAt).toLocaleString()}`}</p>
                  <div className="mt-2 flex items-center gap-1">
                    {due ? (
                      <Button size="sm" disabled={queueBusy === change.id} onClick={() => void applyQueued(change)}>Review & apply</Button>
                    ) : (
                      <>
                        <Input className="h-8" type="datetime-local" value={queueTimes[change.id] ?? ''} onChange={event => setQueueTimes(current => ({ ...current, [change.id]: event.target.value }))} />
                        <Button size="sm" variant="outline" disabled={queueBusy === change.id || !queueTimes[change.id]} onClick={() => void rescheduleQueued(change)}>Save</Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" disabled={queueBusy === change.id} onClick={() => void cancelQueued(change)}>Cancel</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <main className="flex-1 flex overflow-hidden">
        {/* Left pane: Stop list */}
        <div className={`flex flex-col w-full md:w-1/3 lg:w-[400px] border-r bg-card shrink-0 ${selectedKey || adding ? 'hidden md:flex' : 'flex'}`}>
          <div className="p-4 border-b space-y-3">
            <Button size="sm" className="w-full" onClick={() => { setSelectedKey(null); setAdding(true); }}>
              <Plus className="mr-1.5 h-4 w-4" /> Add stop
            </Button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search stops..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{stops.length} integrated stops</span>
              <button 
                onClick={() => void refetch()} 
                disabled={isFetching}
                className="flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
          
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <div className="p-4 text-sm text-destructive text-center">
                Failed to load stops.
              </div>
            ) : stopsByArea.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No stops found.
              </div>
            ) : (
              <div className="p-2 space-y-6">
                {stopsByArea.map(([areaName, areaStops]) => (
                  <section key={areaName} className="space-y-3">
                    <h3 className="px-2 text-xs font-bold uppercase tracking-wider text-muted-foreground sticky top-0 bg-card/95 backdrop-blur py-1 z-10">
                      {areaName}
                    </h3>
                    <AdminStopRoleSection
                      title="Pickup route"
                      role="pickup"
                      stops={areaStops.filter(stop => adminStopMatchesRole(stop, 'pickup'))}
                      selectedKey={selectedKey}
                      onSelect={key => { setAdding(false); setSelectedKey(key); }}
                    />
                    <AdminStopRoleSection
                      title="Drop-off route"
                      role="dropoff"
                      stops={areaStops.filter(stop => adminStopMatchesRole(stop, 'dropoff'))}
                      selectedKey={selectedKey}
                      onSelect={key => { setAdding(false); setSelectedKey(key); }}
                    />
                  </section>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right pane: Editor */}
        <div className={`flex-1 flex flex-col bg-background relative overflow-hidden ${!selectedKey && !adding ? 'hidden md:flex items-center justify-center' : 'flex'}`}>
          {adding ? (
            <AddStopEditor onClose={() => setAdding(false)} onCreated={stop => {
              setAdding(false);
              setSelectedKey(stop.key);
            }} />
          ) : !selectedKey ? (
            <div className="text-center space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <MapIcon className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-lg font-bold text-muted-foreground">Select a stop to edit</p>
              <p className="text-sm text-muted-foreground max-w-sm px-6">
                Accurate coordinates ensure correct arrival estimates and trigger automatic passenger announcements.
              </p>
            </div>
          ) : selectedStop ? (
            <StopEditor 
              key={selectedStop.key} 
              stop={selectedStop} 
               onClose={() => setSelectedKey(null)}
               onDeleted={() => setSelectedKey(null)}
            />
          ) : (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function AdminStopRoleSection({
  title,
  role,
  stops,
  selectedKey,
  onSelect,
}: {
  title: string;
  role: 'pickup' | 'dropoff';
  stops: AdminScheduleStop[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const isPickup = role === 'pickup';
  return (
    <div className={`overflow-hidden rounded-2xl border ${
      isPickup ? 'border-emerald-200 bg-emerald-50/40' : 'border-orange-200 bg-orange-50/40'
    }`}>
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${isPickup ? 'bg-emerald-500' : 'bg-orange-500'}`} />
          <h4 className={`text-xs font-black uppercase tracking-[0.12em] ${
            isPickup ? 'text-emerald-800' : 'text-orange-800'
          }`}>
            {title}
          </h4>
        </div>
        <span className="text-[11px] font-bold text-muted-foreground">{stops.length} stops</span>
      </div>
      <div className="space-y-1 border-t border-inherit p-1.5">
        {stops.map(stop => (
          <button
            key={`${role}-${stop.key}`}
            type="button"
            onClick={() => onSelect(stop.key)}
            className={`w-full rounded-xl border px-3 py-3 text-left transition-all duration-200 ${
              selectedKey === stop.key
                ? 'border-primary/30 bg-primary/10 ring-1 ring-primary/20 shadow-sm'
                : 'border-transparent bg-background hover:border-border hover:bg-muted/50'
            }`}
          >
            <div className="line-clamp-1 text-sm font-semibold">{stop.address || stop.canonicalLabel}</div>
            <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
              {categoryLabel(stop.category)}
            </span>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {stop.isCustom ? (
                <span className="inline-flex items-center gap-0.5 rounded-sm bg-blue-50 px-1 font-medium text-blue-700"><Plus className="h-3 w-3" /> Custom</span>
              ) : stop.manuallyOverridden ? (
                <span className="inline-flex items-center gap-0.5 rounded-sm bg-amber-50 px-1 font-medium text-amber-600"><MapPin className="h-3 w-3" /> Overridden</span>
              ) : (
                <span className="inline-flex items-center gap-0.5 opacity-70"><MapPin className="h-3 w-3" /> System</span>
              )}
              <span className="truncate">{stop.address && stop.address !== stop.sourceLabel
                ? `Official: ${stop.sourceLabel}`
                : stop.sourceLabel}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function StopEditor({ stop, onClose, onDeleted }: { stop: AdminScheduleStop, onClose: () => void, onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [addressQuery, setAddressQuery] = useState('');
  const [pending, setPending] = useState<{ kind: 'update' | 'delete'; impact: AdminStopChangeImpact; payload?: Omit<AdminScheduleStopUpdate, 'confirmedImpactRevision'> } | null>(null);
  const debouncedAddressQuery = useDebounce(addressQuery, 400);

  const form = useForm<FormValues>({
    resolver: zodResolver(updateStopSchema),
    defaultValues: {
      address: stop.address || '',
      lat: stop.lat,
      lng: stop.lng,
      category: stop.category,
    },
  });

  const { data: searchResults, isFetching: isSearching } = useSearchAdminAddresses(
    { q: debouncedAddressQuery, areaId: stop.areaId },
    { 
      query: { 
        queryKey: getSearchAdminAddressesQueryKey({ q: debouncedAddressQuery, areaId: stop.areaId }),
        enabled: debouncedAddressQuery.length >= 3,
        staleTime: 60000 
      } 
    }
  );

  const updateMutation = useUpdateAdminScheduleStop();
  const deleteMutation = useDeleteAdminScheduleStop();
  const previewMutation = usePreviewAdminScheduleStopImpact();
  const scheduleMutation = useCreateAdminScheduledStopChange();

  function onSubmit(values: FormValues) {
    const payload = buildAdminStopUpdate(values, form.formState.dirtyFields);
    previewMutation.mutate({ data: { kind: 'update', key: stop.key, change: payload } }, {
      onSuccess: impact => setPending({ kind: 'update', impact, payload }),
      onError: () => toast.error('The stop impact could not be checked. Nothing was saved.'),
    });
  }

  function confirmUpdate() {
    if (!pending?.payload || pending.kind !== 'update') return;
    updateMutation.mutate(
      { key: stop.key, data: { ...pending.payload, confirmedImpactRevision: pending.impact.revision } },
      {
        onSuccess: (updatedStop) => {
          toast.success('Coordinates found and stop updated successfully');
          form.reset({
            address: updatedStop.address || '',
            lat: updatedStop.lat,
            lng: updatedStop.lng,
            category: updatedStop.category,
          });
          // Patch cache directly to avoid layout jump
          queryClient.setQueryData(
            getListAdminScheduleStopsQueryKey(), 
            (old: AdminScheduleStop[] | undefined) => {
              if (!old) return old;
              return old.map(s => s.key === stop.key ? updatedStop : s);
            }
          );
          setPending(null);
        },
        onError: (err) => {
          const e = err as ErrorType<{ error?: string }>;
          toast.error(e.data?.error || 'Failed to update stop');
        }
      }
    );
  }

  function applySearchResult(result: AdminAddressSearchResult) {
    form.setValue('address', result.address, { shouldDirty: true });
    form.setValue('lat', result.lat, { shouldDirty: true });
    form.setValue('lng', result.lng, { shouldDirty: true });
    setAddressQuery(''); // clear search
    toast.success('Coordinates applied from search');
  }

  function deleteStop() {
    previewMutation.mutate({ data: { kind: 'delete', key: stop.key, change: {} } }, {
      onSuccess: impact => setPending({ kind: 'delete', impact }),
      onError: () => toast.error('The stop impact could not be checked. Nothing was removed.'),
    });
  }

  function confirmDelete() {
    if (!pending || pending.kind !== 'delete') return;
    deleteMutation.mutate({ key: stop.key, params: { confirmedImpactRevision: pending.impact.revision } }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListAdminScheduleStopsQueryKey() });
        toast.success('Stop removed from system routes. Official website syncing remains active.');
        onDeleted();
      },
      onError: (err) => {
        const error = err as ErrorType<{ error?: string }>;
        toast.error(error.data?.error || 'Stop could not be removed.');
      },
    });
  }

  function scheduleChange(applyAt: string) {
    if (!pending) return;
    scheduleMutation.mutate({ data: {
      kind: pending.kind,
      key: stop.key,
      change: pending.payload ?? {},
      applyAt,
      confirmedImpactRevision: pending.impact.revision,
    } }, {
      onSuccess: () => {
        setPending(null);
        void queryClient.invalidateQueries({ queryKey: getListAdminScheduledStopChangesQueryKey() });
        toast.success('Change queued. An administrator must return to apply it when due.');
      },
      onError: () => toast.error('The change could not be queued. Review its impact again.'),
    });
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {pending && (
        <ImpactConfirmation
          impact={pending.impact}
          busy={updateMutation.isPending || deleteMutation.isPending || scheduleMutation.isPending}
          action={pending.kind === 'delete' ? 'Remove stop' : 'Save stop'}
          onCancel={() => setPending(null)}
          onConfirm={pending.kind === 'delete' ? confirmDelete : confirmUpdate}
          onSchedule={scheduleChange}
        />
      )}
      <div className="border-b bg-card px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div>
          <button onClick={onClose} className="md:hidden text-sm font-bold text-primary mb-2 flex items-center gap-1">
            ← Back to list
          </button>
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground mb-1">
            <span>{stop.areaName}</span>
            <span>•</span>
            <span className="font-mono text-xs">{stop.key}</span>
          </div>
          <h2 className="text-2xl font-black">{stop.address || stop.canonicalLabel}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Source: {stop.sourceLabel}</p>
          {stop.isCustom && (
            <p className="mt-2 inline-flex rounded-md bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">
              {stop.officialSiteNote}
            </p>
          )}
        </div>
      </div>

      <div className="p-6 max-w-3xl w-full mx-auto space-y-8 pb-24">
        
        {/* Address Search Section */}
        <Card className="border-primary/20 shadow-sm overflow-visible">
          <CardHeader className="bg-primary/5 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Search className="h-5 w-5 text-primary" />
              Find precise coordinates
            </CardTitle>
            <CardDescription>
               Search for an address, intersection, or latitude and longitude to verify the location.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Address, intersection, or 40.68048, -73.95332"
                className="pl-9 h-12 text-base font-medium"
                value={addressQuery}
                onChange={e => setAddressQuery(e.target.value)}
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>

            {debouncedAddressQuery.length >= 3 && searchResults && (
              <div className="bg-card border rounded-lg shadow-sm overflow-hidden divide-y">
                {searchResults.length === 0 ? (
                  <div className="p-4 text-sm text-center text-muted-foreground">No results found for "{debouncedAddressQuery}"</div>
                ) : (
                  searchResults.map(result => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => applySearchResult(result)}
                      className="w-full text-left p-3 hover:bg-muted transition-colors flex items-start gap-3 group"
                    >
                      <div className="mt-0.5 text-muted-foreground group-hover:text-primary transition-colors">
                        {result.type === 'intersection' ? <Crosshair className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                      </div>
                      <div>
                        <div className="font-semibold text-sm">{result.address}</div>
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">
                          {result.lat.toFixed(5)}, {result.lng.toFixed(5)}
                        </div>
                      </div>
                      <div className="ml-auto mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded">Apply</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Manual Edit Form */}
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Navigation className="h-5 w-5 text-muted-foreground" />
              Stop Definition
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-bold">Stop category</FormLabel>
                      <FormControl>
                        <select {...field} className="h-10 w-full rounded-md border bg-background px-3 font-medium">
                          {STOP_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-bold">Display Address (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Name shown on every app and display" {...field} value={field.value || ''} className="font-medium bg-muted/30" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="lat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-bold">Latitude</FormLabel>
                        <FormControl>
                          <Input type="number" step="any" {...field} className="font-mono bg-muted/30" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lng"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-bold">Longitude</FormLabel>
                        <FormControl>
                          <Input type="number" step="any" {...field} className="font-mono bg-muted/30" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="pt-4 flex items-center justify-between border-t">
                  <div className="text-sm">
                    {stop.manuallyOverridden ? (
                      <span className="flex items-center gap-1.5 text-amber-600 font-semibold bg-amber-50 px-2 py-1 rounded">
                        <AlertCircle className="h-4 w-4" /> Customized
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Check className="h-4 w-4" /> Using system default
                      </span>
                    )}
                  </div>
                  
                  <Button 
                    type="submit" 
                    size="lg" 
                    disabled={updateMutation.isPending || previewMutation.isPending || !form.formState.isDirty}
                    className="font-bold shadow-sm"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save stop
                  </Button>
                </div>
                <div className="flex justify-end border-t pt-4">
                  <Button type="button" variant="destructive" onClick={deleteStop} disabled={deleteMutation.isPending}>
                    {deleteMutation.isPending
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Trash2 className="mr-2 h-4 w-4" />}
                    Remove stop
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

function AddStopEditor({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (stop: AdminScheduleStop) => void;
}) {
  const queryClient = useQueryClient();
  const [areaId, setAreaId] = useState(4);
  const [canonicalLabel, setCanonicalLabel] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [category, setCategory] = useState<AdminScheduleStop['category']>('both');
  const [addressQuery, setAddressQuery] = useState('');
  const [impact, setImpact] = useState<AdminStopChangeImpact | null>(null);
  const debouncedQuery = useDebounce(addressQuery, 400);
  const createMutation = useCreateAdminScheduleStop();
  const previewMutation = usePreviewAdminScheduleStopImpact();
  const scheduleMutation = useCreateAdminScheduledStopChange();
  const { data: results = [], isFetching } = useSearchAdminAddresses(
    { q: debouncedQuery, areaId },
    { query: {
      queryKey: getSearchAdminAddressesQueryKey({ q: debouncedQuery, areaId }),
      enabled: debouncedQuery.length >= 3,
      staleTime: 60000,
    } },
  );

  function applyResult(result: AdminAddressSearchResult) {
    setAddress(result.address);
    setLat(String(result.lat));
    setLng(String(result.lng));
    if (!canonicalLabel.trim()) setCanonicalLabel(result.address.split(',')[0] || result.address);
    setAddressQuery('');
  }

  function createStop() {
    const change = {
      areaId,
      canonicalLabel: canonicalLabel.trim(),
      address: address.trim() || null,
      lat: Number(lat),
      lng: Number(lng),
      category,
    };
    previewMutation.mutate({ data: { kind: 'create', change } }, {
      onSuccess: setImpact,
      onError: () => toast.error('The stop impact could not be checked. Nothing was added.'),
    });
  }

  function confirmCreate() {
    if (!impact) return;
    createMutation.mutate({
      data: {
        areaId,
        canonicalLabel: canonicalLabel.trim(),
        address: address.trim() || null,
        lat: Number(lat),
        lng: Number(lng),
        category,
        confirmedImpactRevision: impact.revision,
      },
    }, {
      onSuccess: async stop => {
        await queryClient.invalidateQueries({ queryKey: getListAdminScheduleStopsQueryKey() });
        toast.success('Custom stop added to every trip serving this area.');
        onCreated(stop);
      },
      onError: err => {
        const error = err as ErrorType<{ error?: string }>;
        toast.error(error.data?.error || 'Stop could not be added.');
      },
    });
  }

  function scheduleCreate(applyAt: string) {
    if (!impact) return;
    scheduleMutation.mutate({ data: {
      kind: 'create',
      change: {
        areaId,
        canonicalLabel: canonicalLabel.trim(),
        address: address.trim() || null,
        lat: Number(lat),
        lng: Number(lng),
        category,
      },
      applyAt,
      confirmedImpactRevision: impact.revision,
    } }, {
      onSuccess: () => {
        setImpact(null);
        void queryClient.invalidateQueries({ queryKey: getListAdminScheduledStopChangesQueryKey() });
        toast.success('Stop addition queued. An administrator must return to apply it when due.');
      },
      onError: () => toast.error('The stop addition could not be queued.'),
    });
  }

  const valid = canonicalLabel.trim().length >= 2
    && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
    && lat !== '' && lng !== '';

  return (
    <div className="h-full overflow-y-auto">
      {impact && (
        <ImpactConfirmation
          impact={impact}
          busy={createMutation.isPending || scheduleMutation.isPending}
          action="Add stop"
          onCancel={() => setImpact(null)}
          onConfirm={confirmCreate}
          onSchedule={scheduleCreate}
        />
      )}
      <div className="sticky top-0 z-10 border-b bg-card px-6 py-4">
        <button onClick={onClose} className="mb-2 text-sm font-bold text-primary">← Back to stops</button>
        <h2 className="text-2xl font-black">Add a custom stop</h2>
        <p className="mt-1 text-sm text-muted-foreground">The stop will be added to every trip serving its selected area.</p>
      </div>
      <div className="mx-auto max-w-3xl space-y-5 p-6 pb-24">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">Not yet on the official Monsey Trails website</p>
          <p className="mt-1">This custom stop remains active while official schedules continue syncing normally.</p>
        </div>
        <Card>
          <CardHeader><CardTitle>Stop details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <label className="grid gap-2 text-sm font-bold">
              Stop category
              <select className="h-10 rounded-md border bg-background px-3 font-normal" value={category} onChange={event => setCategory(event.target.value as AdminScheduleStop['category'])}>
                {STOP_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold">
              Service area
              <select className="h-10 rounded-md border bg-background px-3 font-normal" value={areaId} onChange={event => setAreaId(Number(event.target.value))}>
                {STOP_AREAS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-bold">
              Passenger-facing stop name
              <Input value={canonicalLabel} onChange={event => setCanonicalLabel(event.target.value)} placeholder="Bedford Avenue & New Stop Street" />
            </label>
            <div className="relative">
              <label className="grid gap-2 text-sm font-bold">
                Search for an address
                <Input value={addressQuery} onChange={event => setAddressQuery(event.target.value)} placeholder="Search an intersection or landmark..." />
              </label>
              {isFetching && <Loader2 className="absolute bottom-3 right-3 h-4 w-4 animate-spin" />}
            </div>
            {debouncedQuery.length >= 3 && results.length > 0 && (
              <div className="divide-y rounded-lg border">
                {results.map(result => (
                  <button key={result.id} type="button" onClick={() => applyResult(result)} className="block w-full p-3 text-left text-sm hover:bg-muted">
                    {result.address}
                  </button>
                ))}
              </div>
            )}
            <label className="grid gap-2 text-sm font-bold">
              Saved address
              <Input value={address} onChange={event => setAddress(event.target.value)} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold">Latitude<Input type="number" step="any" value={lat} onChange={event => setLat(event.target.value)} /></label>
              <label className="grid gap-2 text-sm font-bold">Longitude<Input type="number" step="any" value={lng} onChange={event => setLng(event.target.value)} /></label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={createStop} disabled={!valid || createMutation.isPending || previewMutation.isPending}>
                {(createMutation.isPending || previewMutation.isPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add stop
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
