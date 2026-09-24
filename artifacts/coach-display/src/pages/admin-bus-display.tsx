import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { Redirect } from 'wouter';
import { AlertTriangle, ArrowLeft, Bus, Loader2, LogOut, RefreshCw, Save } from 'lucide-react';
import {
  clearAdminDisplayBusNumber,
  adminDisconnectPassengerScreens,
  ADMIN_DISPLAY_SLIDES,
  getAdminDisplaySettings,
  getAdminDisplayBusNumber,
  listAdminActiveTrips,
  setAdminDisplayBusNumber,
  saveAdminDisplaySettings,
  setAdminEmergencyTakeover,
  type AdminDisplayHealth,
  type AdminActiveTrip,
} from '@/providers/live-trip';
import type { Announcement, DisplayMode } from '@/lib/store';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';
import { useAdminRole, type AdminRole } from '@/components/admin/AdminLayout';

export default function AdminBusDisplay() {
  const role = useAdminRole();
  const { isLoaded, userId } = useAuth();
  const [selectedBus, setSelectedBus] = useState(getAdminDisplayBusNumber);
  const [trips, setTrips] = useState<AdminActiveTrip[]>([]);
  const [loading, setLoading] = useState(!selectedBus);
  const [error, setError] = useState('');
  const [disconnectingBus, setDisconnectingBus] = useState('');
  const [success, setSuccess] = useState('');

  async function loadTrips() {
    setLoading(true);
    setError('');
    try {
      setTrips(await listAdminActiveTrips());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Current trips could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  async function disconnectScreens(busNumber: string) {
    setDisconnectingBus(busNumber);
    setError('');
    setSuccess('');
    try {
      const result = await adminDisconnectPassengerScreens(busNumber);
      setSuccess(result.disconnectedScreenCount === 1
        ? `1 paired screen on bus ${busNumber} was logged out.`
        : `${result.disconnectedScreenCount} paired screens on bus ${busNumber} were logged out.`);
      await loadTrips();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Paired screens could not be logged out.');
    } finally {
      setDisconnectingBus('');
    }
  }

  useEffect(() => {
    if (isLoaded && userId && !selectedBus) void loadTrips();
  }, [isLoaded, userId, selectedBus]);

  if (!isLoaded) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }
  if (!userId) {
    return <Redirect to={`${appUrl('/sign-in')}?redirect_url=${encodeURIComponent(appUrl(APP_ROUTES.adminDisplay))}`} />;
  }
  if (selectedBus) return (
    <DisplayControlPanel
      busNumber={selectedBus}
      role={role}
      onBack={() => {
        clearAdminDisplayBusNumber();
        setSelectedBus('');
      }}
    />
  );

  return (
    <div className="dark flex min-h-[calc(100dvh-8rem)] flex-col bg-background text-foreground">
      <main className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-3xl rounded-[2rem] border border-white/10 bg-secondary/55 p-10 shadow-2xl">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Administrator access</p>
              <h1 className="mt-2 text-4xl font-bold">Choose a current trip</h1>
              <p className="mt-2 text-lg text-muted-foreground">Open the bus-mounted passenger display without a pairing code.</p>
            </div>
            <button
              type="button"
              onClick={() => void loadTrips()}
              aria-label="Refresh current trips"
              className="rounded-full p-3 text-muted-foreground hover:bg-white/10 hover:text-foreground"
            >
              <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {error && <p role="alert" className="mt-8 rounded-xl bg-destructive/15 p-4 font-semibold text-destructive">{error}</p>}
          {success && <p role="status" className="mt-8 rounded-xl bg-primary/15 p-4 font-semibold text-primary">{success}</p>}
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : trips.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-white/10 p-10 text-center text-xl text-muted-foreground">No ready or running trips are available.</div>
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {trips.map((trip) => (
                <div key={trip.busNumber} className="rounded-2xl border border-white/10 bg-background/60 p-3">
                  {role !== 'content' && <button
                    type="button"
                    onClick={() => {
                      clearAdminDisplayBusNumber();
                      setAdminDisplayBusNumber(trip.busNumber);
                      setSelectedBus(trip.busNumber);
                    }}
                    className="flex w-full items-center gap-4 rounded-xl p-2 text-left transition hover:bg-white/5"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><Bus className="h-6 w-6" /></span>
                    <span className="min-w-0">
                      <span className="block text-2xl font-bold">Bus {trip.busNumber}</span>
                      <span className="block truncate text-sm text-muted-foreground">{trip.destinationAddress || (trip.status === 'running' ? 'Trip in progress' : 'Ready to depart')}</span>
                    </span>
                  </button>}
                  <button
                    type="button"
                    disabled={disconnectingBus === trip.busNumber}
                    onClick={() => void disconnectScreens(trip.busNumber)}
                    className="mt-2 flex w-full items-center justify-center rounded-xl border border-white/10 px-3 py-2 text-sm font-bold transition hover:border-primary/60 disabled:opacity-60"
                    aria-label={`Log out paired screens for bus ${trip.busNumber}`}
                  >
                    {disconnectingBus === trip.busNumber
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <LogOut className="mr-2 h-4 w-4" />}
                    Log out paired screens ({trip.pairedScreenCount})
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function DisplayControlPanel({ busNumber, onBack, role }: { busNumber: string; onBack: () => void; role: AdminRole | null }) {
  const [health, setHealth] = useState<AdminDisplayHealth | null>(null);
  const [slides, setSlides] = useState<DisplayMode[]>([]);
  const [language, setLanguage] = useState<'en' | 'yi' | 'he'>('en');
  const [duration, setDuration] = useState(15);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [emergencyText, setEmergencyText] = useState('');
  const [emergencyConfirmation, setEmergencyConfirmation] = useState('');

  async function load() {
    setBusy(true);
    try {
      const next = await getAdminDisplaySettings(busNumber);
      setHealth(next);
      setSlides(next.settings.enabledSlides);
      setLanguage(next.settings.passengerLanguage);
      setDuration(next.settings.rotationIntervalSeconds);
      setAnnouncements(next.settings.announcements);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Display settings could not be loaded.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(); }, [busNumber]);
  useEffect(() => {
    if (!health) return;
    const timer = window.setInterval(() => {
      void getAdminDisplaySettings(busNumber).then(next => setHealth(next)).catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [busNumber, health?.settings.version]);

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const settings = await saveAdminDisplaySettings(busNumber, {
        enabledSlides: slides,
        passengerLanguage: language,
        rotationIntervalSeconds: duration,
        announcements,
      });
      setHealth(current => current ? { ...current, settings } : current);
      setMessage(`Version ${settings.version} saved. Waiting for connected screens to apply it.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Display settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function emergency(enabled: boolean) {
    if (!window.confirm(`${enabled ? 'Take over' : 'Release'} every passenger screen on coach ${busNumber}? This is for a real emergency only.`)) return;
    try {
      await setAdminEmergencyTakeover(busNumber, enabled, emergencyText, emergencyConfirmation);
      setMessage(enabled ? 'Emergency takeover is active.' : 'Emergency takeover has been released.');
      setEmergencyConfirmation('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Emergency takeover could not be changed.');
    }
  }

  if (busy && !health) return <div className="dark flex min-h-[100dvh] items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  return (
    <div className="dark min-h-[100dvh] bg-background p-5 text-foreground">
      <div className="mx-auto max-w-7xl">
        <button type="button" onClick={onBack} className="mb-4 flex items-center gap-2 text-sm font-bold text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Current trips</button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-xs font-black uppercase tracking-widest text-primary">Passenger display controls</p><h1 className="text-3xl font-black">Coach {busNumber}</h1></div>
          <div className="text-right text-sm"><p className="font-bold">Saved version {health?.settings.version ?? 0}</p><p className="text-muted-foreground">{health?.screens.length ?? 0} connected screens</p></div>
        </div>
        {message && <p role="status" className="mt-4 rounded-xl border border-white/10 bg-card p-3 font-semibold">{message}</p>}
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.9fr]">
          {role !== 'dispatcher' && <section className="space-y-5 rounded-2xl border border-white/10 bg-card p-5">
            <div><h2 className="font-black">Enabled slides</h2><p className="text-sm text-muted-foreground">Changes below are a preview until Save is pressed.</p></div>
            <div className="grid gap-2 sm:grid-cols-2">
              {ADMIN_DISPLAY_SLIDES.map(slide => <label key={slide} className="flex items-center gap-2 rounded-lg border border-white/10 p-2 text-sm font-bold capitalize"><input type="checkbox" checked={slides.includes(slide)} onChange={event => setSlides(current => event.target.checked ? [...current, slide] : current.filter(item => item !== slide))} />{slide.replaceAll('-', ' ')}</label>)}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold">Language<select aria-label="Passenger language" value={language} onChange={event => setLanguage(event.target.value as typeof language)} className="mt-1 h-11 w-full rounded-lg border bg-background px-3"><option value="en">English</option><option value="yi">Yiddish</option><option value="he">Hebrew</option></select></label>
              <label className="text-sm font-bold">Seconds per slide<input aria-label="Seconds per slide" type="number" min={5} max={300} value={duration} onChange={event => setDuration(Number(event.target.value))} className="mt-1 h-11 w-full rounded-lg border bg-background px-3" /></label>
            </div>
            <div>
              <div className="flex items-center justify-between"><h2 className="font-black">Approved announcements</h2><button type="button" onClick={() => setAnnouncements(current => [...current, { id: crypto.randomUUID(), title: 'New announcement', message: 'Enter approved passenger wording.', active: true }])} className="text-sm font-bold text-primary">Add</button></div>
              <div className="mt-2 space-y-2">{announcements.map((item, index) => <div key={item.id} className="grid gap-2 rounded-lg border border-white/10 p-3"><label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={item.active} onChange={event => setAnnouncements(current => current.map((value, i) => i === index ? { ...value, active: event.target.checked } : value))} /> Show this approved message</label><input aria-label={`Announcement ${index + 1} title`} value={item.title} onChange={event => setAnnouncements(current => current.map((value, i) => i === index ? { ...value, title: event.target.value } : value))} className="h-9 rounded-md border bg-background px-2 font-bold" /><textarea aria-label={`Announcement ${index + 1} message`} value={item.message} onChange={event => setAnnouncements(current => current.map((value, i) => i === index ? { ...value, message: event.target.value } : value))} className="rounded-md border bg-background p-2" /></div>)}</div>
            </div>
            <button type="button" disabled={saving || slides.length === 0} onClick={() => void save()} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-black text-primary-foreground disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save to passenger screens</button>
          </section>}
          <div className="space-y-5">
            <section className="rounded-2xl border border-white/10 bg-card p-5"><h2 className="font-black">Unsaved preview</h2><div dir={language === 'en' ? 'ltr' : 'rtl'} className="mt-3 aspect-video overflow-hidden rounded-xl bg-slate-950 p-5 text-white"><p className="text-xs uppercase text-sky-300">Coach {busNumber} · {language.toUpperCase()}</p><p className="mt-5 text-2xl font-black">{announcements.find(item => item.active)?.title ?? slides[0]?.replaceAll('-', ' ') ?? 'No slide enabled'}</p><p className="mt-2 text-sm text-slate-300">{announcements.find(item => item.active)?.message ?? `Rotates every ${duration} seconds through ${slides.length} enabled slides.`}</p></div></section>
            <section className="rounded-2xl border border-white/10 bg-card p-5"><div className="flex items-center justify-between"><h2 className="font-black">Connection health</h2><button type="button" onClick={() => void load()} aria-label="Refresh connection health"><RefreshCw className="h-4 w-4" /></button></div><div className="mt-3 space-y-2">{health?.screens.length ? health.screens.map(screen => <div key={screen.id} className="rounded-lg border border-white/10 p-3 text-sm"><p className="font-bold">Screen …{screen.id.slice(-6)}</p><p className={screen.latestReceivedVersion === health.settings.version ? 'text-emerald-400' : 'text-amber-400'}>{screen.latestReceivedVersion === health.settings.version ? `Applied version ${screen.latestReceivedVersion}` : `Latest received: ${screen.latestReceivedVersion ?? 'none'} · current ${health.settings.version}`}</p><p className="text-xs text-muted-foreground">{screen.receivedAt ? new Date(screen.receivedAt).toLocaleString() : 'No measured receipt yet'}</p></div>) : <p className="text-sm text-muted-foreground">No passenger screens are currently connected.</p>}</div></section>
            {role !== 'content' && <section className="rounded-2xl border border-red-500/40 bg-red-950/20 p-5"><h2 className="flex items-center gap-2 font-black text-red-300"><AlertTriangle className="h-5 w-5" /> Emergency takeover</h2><p className="mt-1 text-sm text-red-200/80">Overrides normal slides. Existing driver safety controls remain available.</p><textarea aria-label="Emergency message" value={emergencyText} onChange={event => setEmergencyText(event.target.value)} placeholder="Emergency passenger instruction" className="mt-3 w-full rounded-lg border border-red-500/30 bg-background p-2" /><input aria-label="Emergency confirmation" value={emergencyConfirmation} onChange={event => setEmergencyConfirmation(event.target.value)} placeholder={`Type EMERGENCY ${busNumber}`} className="mt-2 h-10 w-full rounded-lg border border-red-500/30 bg-background px-3" /><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => void emergency(true)} className="rounded-lg bg-red-600 p-2 font-black text-white">Activate</button><button type="button" onClick={() => void emergency(false)} className="rounded-lg border border-red-500/40 p-2 font-black">Release</button></div></section>}
          </div>
        </div>
      </div>
    </div>
  );
}