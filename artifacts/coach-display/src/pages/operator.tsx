import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useSettingsStore, type Announcement } from '@/lib/store';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link } from 'wouter';
import {
  MonitorPlay, Settings, ShieldAlert, Bus, Wifi, WifiOff, MapPin,
  Navigation, CheckCircle2, Clock, AlertTriangle, Plus, Trash2, VolumeX,
  Activity, Play, Square, Pause, ExternalLink, Eye, Map, Megaphone, Volume2, LogOut, RefreshCw, FileCheck2, Maximize2, X, ArrowUp, ArrowDown
} from 'lucide-react';
import { MOCK_ROUTES } from '@/providers/api-interfaces';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEffect, useId, useRef, useState } from 'react';
import {
  arriveAtNextDestination, clearTripRoute, configureTripRoute, connectOperatorToBus, getOperatorBusNumber, getOperatorPairingCode, logoutPairedScreens, publishTripLocation,
  resolveDestination, startLiveTrip, stopLiveTrip, suggestDestinations, testPassengerChime,
  LIVE_TRIP_REFRESH_INTERVAL_MS, updateEmergencySettings, updateTripAnnouncements, updateTripDisplaySettings, useLiveTrip, useLiveTripRefreshStatus
} from '@/providers/live-trip';
import { clearOperatorSession } from '@/providers/live-trip';
import { createPassengerQrInvite } from '@/providers/live-trip';
import { QRCodeSVG } from 'qrcode.react';
import type { AddressSuggestion } from '@/providers/live-trip';
import { ThemeToggle } from '@/components/theme-toggle';
import { NavigationCockpit } from '@/components/operator/NavigationCockpit';
import { OperatorMap } from '@/components/operator/OperatorMap';
import { DesktopTabNavigation, OperatorTabNavigation, type OperatorTab } from '@/components/operator/OperatorTabNavigation';
import { AssignedScheduledTrips } from '@/components/operator/AssignedScheduledTrips';
import { DriverCommunications } from '@/components/operator/DriverCommunications';
import { cn } from '@/lib/utils';
import { appUrl } from '@/lib/app-routes';
import { GeolocationRequestError, requestCurrentPosition } from '@/lib/geolocation';
import { DriverOfflineProtection } from '@/components/operator/DriverOfflineRoute';
import {
  approvePassengerInfo,
  authorizePassengerInfo,
  checkPassengerInfoWebsite,
  getPassengerInfo,
  type PassengerInfo,
} from '@/providers/passenger-info';

const settingsSchema = z.object({
  brandName: z.string().min(2),
  routeId: z.string(),
  displayMode: z.enum(['auto', 'welcome', 'map', 'next-stop', 'weather', 'traffic', 'daf', 'jewish-calendar', 'announcements', 'destinations-info', 'fares-info', 'passenger-guide', 'contact-info', 'charging-amenities', 'safety']),
  passengerLanguage: z.enum(['en', 'yi', 'he']),
  rotationIntervalSeconds: z.coerce.number().min(5).max(300),
  arrivalSoundsEnabled: z.boolean(),
});

interface StopDraft {
  id: string;
  address: string;
  suggestion: AddressSuggestion | null;
}

function stopDraftsFromTrip(stops: Array<{ id: string; address: string; lat: number; lng: number }>): StopDraft[] {
  return stops.map((stop) => ({
    id: stop.id,
    address: stop.address,
    suggestion: {
      id: stop.id,
      label: stop.address,
      lat: stop.lat,
      lng: stop.lng,
      type: 'saved',
    },
  }));
}

function gpsErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? Number((error as { code: unknown }).code)
    : 0;
  if (code === 1) return 'Location permission is blocked. Allow location access in the browser, then retry.';
  if (code === 2) return 'This device cannot determine its current location. Move to an area with a clearer GPS signal, then retry.';
  if (code === 3) return 'GPS timed out before a location was found. Retry when the device has a clear signal.';
  return error instanceof Error && error.message
    ? error.message
    : 'GPS location is unavailable.';
}

function validCoordinates(coords: Pick<GeolocationCoordinates, 'latitude' | 'longitude'>) {
  return Number.isFinite(coords.latitude)
    && Number.isFinite(coords.longitude)
    && Math.abs(coords.latitude) <= 90
    && Math.abs(coords.longitude) <= 180;
}

function StopAddressInput({
  stop,
  position,
  disabled,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  stop: StopDraft;
  position: number;
  disabled: boolean;
  onChange: (stop: StopDraft) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failureMessage, setFailureMessage] = useState('');
  const skipLookup = useRef(false);

  useEffect(() => {
    const query = stop.address.trim();
    if (skipLookup.current) {
      skipLookup.current = false;
      return;
    }
    if (stop.suggestion && query === stop.suggestion.label) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      setFailureMessage('');
      return;
    }
    if (disabled || query.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFailureMessage('');
      try {
        setSuggestions(await suggestDestinations(query, controller.signal));
        setOpen(true);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setSuggestions([]);
          setFailureMessage(error instanceof Error ? error.message : 'Address suggestions are temporarily unavailable.');
          setOpen(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 600);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [disabled, stop.address]);

  function selectSuggestion(suggestion: AddressSuggestion) {
    skipLookup.current = true;
    onChange({ ...stop, address: suggestion.label, suggestion });
    setSuggestions([]);
    setOpen(false);
    setLoading(false);
    setFailureMessage('');
  }

  return (
    <div className="relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-[16px] border border-border/70 bg-background p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <div className="mt-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
        {position}
      </div>
      <div className="relative min-w-0 flex-1">
        <Input
          value={stop.address}
          onChange={(event) => {
            onChange({ ...stop, address: event.target.value, suggestion: null });
            setOpen(true);
            setFailureMessage('');
          }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Enter an address, intersection, or Plus Code"
          disabled={disabled}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          className="h-11 pr-3"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'Enter' && open) event.preventDefault();
          }}
        />
        {(open || loading) && (
          <div id={listId} role="listbox" className="absolute z-50 mt-2 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
            {loading && <div className="px-4 py-3 text-sm text-muted-foreground">Searching addresses…</div>}
            {!loading && suggestions.length === 0 && (
              <div className="px-4 py-3 text-sm text-muted-foreground">
                {failureMessage || 'No matching address, street corner, or Plus Code found.'}
              </div>
            )}
            {!loading && suggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                role="option"
                aria-selected="false"
                className="flex w-full items-start gap-3 border-t border-border/60 px-4 py-3 text-left text-sm first:border-t-0 hover:bg-accent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(suggestion)}
              >
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="line-clamp-2">{suggestion.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
          <span className="text-[11px] font-semibold text-muted-foreground">
            {stop.suggestion ? 'Address or Plus Code selected' : 'Choose a suggestion to set the stop'}
          </span>
          {stop.suggestion && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-label="Address or Plus Code selected" />}
        </div>
      </div>
      <div className="col-start-2 flex shrink-0 justify-end gap-1 sm:col-start-auto sm:flex-col">
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={onMoveUp} disabled={disabled || !onMoveUp} aria-label={`Move stop ${position} earlier`}>
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={onMoveDown} disabled={disabled || !onMoveDown} aria-label={`Move stop ${position} later`}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onRemove} disabled={disabled} aria-label={`Remove stop ${position}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
import { DriverProfileGate } from '@/components/driver-profile-gate';
import { useDriverProfileQuery } from '@/providers/driver-profile';
import { useClerk, useUser } from '@clerk/react';
import { useGetAdminAccess, getGetAdminAccessQueryKey } from '@workspace/api-client-react';

export default function OperatorPanel() {
  const { user } = useUser();
  return (
    <DriverOfflineProtection driverSubject={user?.id ?? ''}>
      <DriverProfileGate><OperatorConsole /></DriverProfileGate>
    </DriverOfflineProtection>
  );
}

function OperatorConsole() {
  const store = useSettingsStore();
  const liveTrip = useLiveTrip();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { data: profile } = useDriverProfileQuery();
  const { data: adminAccess } = useGetAdminAccess({
    query: {
      queryKey: [...getGetAdminAccessQueryKey(), user?.id],
      retry: false,
      staleTime: 60000,
      enabled: !!user?.id,
    }
  });
  const [navigationMode, setNavigationMode] = useState(false);
  const [dispatchBrief, setDispatchBrief] = useState<string | null>(null);
  const refreshStatus = useLiveTripRefreshStatus();
  const [destinationAddress, setDestinationAddress] = useState('');
  const [selectedDestination, setSelectedDestination] = useState<AddressSuggestion | null>(null);
  const [routeStops, setRouteStops] = useState<StopDraft[]>([]);
  const [routeStopsDirty, setRouteStopsDirty] = useState(false);
  const [officialRunKey, setOfficialRunKey] = useState<string | null>(null);
  const [arrivalNotice, setArrivalNotice] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');
  const [destinationEditing, setDestinationEditing] = useState(false);
  const skipSuggestionLookup = useRef(false);
  const [tripBusy, setTripBusy] = useState(false);
  const [chimeTestBusy, setChimeTestBusy] = useState(false);
  const [busNumber, setBusNumber] = useState(getOperatorBusNumber);
  const [paired, setPaired] = useState(() => Boolean(getOperatorBusNumber()));
  const [pairingCode, setPairingCode] = useState(getOperatorPairingCode);
  const [qrInvite, setQrInvite] = useState<{ url: string; expiresAt: string } | null>(null);
  const [qrInviteOpen, setQrInviteOpen] = useState(false);
  const [passengerInfo, setPassengerInfo] = useState<PassengerInfo | null>(null);
  const [passengerInfoDraft, setPassengerInfoDraft] = useState('');
  const [passengerInfoBusy, setPassengerInfoBusy] = useState(false);
  const [passengerInfoKey, setPassengerInfoKey] = useState('');
  const [announcementsDirty, setAnnouncementsDirty] = useState(false);
  const [announcementsSaving, setAnnouncementsSaving] = useState(false);
  const [configurationSaveStatus, setConfigurationSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [gpsState, setGpsState] = useState<'waiting' | 'acquiring' | 'live' | 'error'>('waiting');
  const [gpsCoordinates, setGpsCoordinates] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsLastUpdatedAt, setGpsLastUpdatedAt] = useState<number | null>(null);
  const [gpsMessage, setGpsMessage] = useState('Start the trip to begin GPS tracking.');
  const [activeTab, setActiveTab] = useState<OperatorTab>('home');
  useEffect(() => {
    if (!paired || routeStopsDirty || destinationEditing || !liveTrip.officialRunKey || !liveTrip.destination) return;
    skipSuggestionLookup.current = true;
    setOfficialRunKey(liveTrip.officialRunKey);
    setDestinationAddress(liveTrip.destinationAddress);
    setSelectedDestination({
      id: 'saved-destination',
      label: liveTrip.destinationAddress,
      lat: liveTrip.destination.lat,
      lng: liveTrip.destination.lng,
      type: 'saved',
    });
    setRouteStops(stopDraftsFromTrip(liveTrip.intermediateStops));
  }, [paired, routeStopsDirty, destinationEditing, liveTrip.officialRunKey, liveTrip.destinationAddress, liveTrip.destination?.lat, liveTrip.destination?.lng, liveTrip.intermediateStops, liveTrip.updatedAt]);
  const passengerDisplays = liveTrip.passengerDisplays ?? [];
  const blockedPassengerDisplays = passengerDisplays.filter((display) => !display.audioReady);
  const automaticArrivalInFlight = useRef(false);
  const watchId = useRef<number | null>(null);
  const lastLocationPublish = useRef(0);
  const latestPosition = useRef<GeolocationCoordinates | null>(null);
  const latestPositionAt = useRef(0);
  const locationTimer = useRef<number | null>(null);
  const locationRetryTimer = useRef<number | null>(null);
  const locationPublishInFlight = useRef(false);
  const locationResumeInFlight = useRef(false);
  const lastGpsErrorNotice = useRef(0);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    if (locationTimer.current !== null) window.clearInterval(locationTimer.current);
    if (locationRetryTimer.current !== null) window.clearTimeout(locationRetryTimer.current);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getPassengerInfo(controller.signal).then((info) => {
      setPassengerInfo(info);
      setPassengerInfoDraft(JSON.stringify(info.content, null, 2));
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  async function handlePassengerInfoCheck() {
    setPassengerInfoBusy(true);
    try {
      const info = await checkPassengerInfoWebsite();
      setPassengerInfo(info);
      toast.success(info.changesDetected ? 'Website changes detected. Review before publishing.' : 'No website changes detected.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Website check failed.');
    } finally {
      setPassengerInfoBusy(false);
    }
  }

  async function handlePassengerInfoApproval() {
    setPassengerInfoBusy(true);
    try {
      const content = JSON.parse(passengerInfoDraft) as PassengerInfo['content'];
      const info = await approvePassengerInfo(content);
      setPassengerInfo(info);
      setPassengerInfoDraft(JSON.stringify(info.content, null, 2));
      toast.success('Passenger information approved and published.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Passenger information could not be approved.');
    } finally {
      setPassengerInfoBusy(false);
    }
  }

  async function handlePassengerInfoAuthorization() {
    setPassengerInfoBusy(true);
    try {
      const info = await authorizePassengerInfo(passengerInfoKey);
      setPassengerInfo(info);
      setPassengerInfoDraft(JSON.stringify(info.content, null, 2));
      setPassengerInfoKey('');
      toast.success('Staff review access unlocked.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Staff authorization failed.');
    } finally {
      setPassengerInfoBusy(false);
    }
  }

  useEffect(() => {
    const query = destinationAddress.trim();
    if (skipSuggestionLookup.current) {
      skipSuggestionLookup.current = false;
      return;
    }
    if (!paired || !destinationEditing || liveTrip.status === 'running' || query.length < 3) {
      setAddressSuggestions([]);
      setSuggestionsOpen(false);
      setSuggestionsLoading(false);
      setSuggestionsError('');
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSuggestionsLoading(true);
      setSuggestionsError('');
      try {
        const results = await suggestDestinations(query, controller.signal);
        setAddressSuggestions(results);
        setSuggestionsOpen(true);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setAddressSuggestions([]);
          setSuggestionsError(error instanceof Error ? error.message : 'Address suggestions are temporarily unavailable.');
          setSuggestionsOpen(true);
        }
      } finally {
        if (!controller.signal.aborted) setSuggestionsLoading(false);
      }
    }, 600);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [destinationAddress, destinationEditing, liveTrip.status, paired]);

  function selectAddressSuggestion(suggestion: AddressSuggestion) {
    skipSuggestionLookup.current = true;
    setDestinationAddress(suggestion.label);
    setSelectedDestination(suggestion);
    setAddressSuggestions([]);
    setSuggestionsOpen(false);
    setSuggestionsLoading(false);
    setSuggestionsError('');
  }

  function beginDestinationEdit() {
    if (!liveTrip.destination) return;
    setDestinationAddress(liveTrip.destinationAddress);
    setSelectedDestination({
      id: 'saved-destination',
      label: liveTrip.destinationAddress,
      lat: liveTrip.destination.lat,
      lng: liveTrip.destination.lng,
      type: 'saved',
    });
    setDestinationEditing(true);
  }

  function cancelDestinationEdit() {
    if (liveTrip.destination) {
      setDestinationAddress(liveTrip.destinationAddress);
      setSelectedDestination({
        id: 'saved-destination',
        label: liveTrip.destinationAddress,
        lat: liveTrip.destination.lat,
        lng: liveTrip.destination.lng,
        type: 'saved',
      });
    }
    setAddressSuggestions([]);
    setSuggestionsOpen(false);
    setSuggestionsError('');
    setDestinationEditing(false);
  }

  async function saveDestinationEdit() {
    if (!selectedDestination || !liveTrip.destination || !officialRunKey) {
      toast.error('Choose an address or Plus Code suggestion before saving the destination.');
      return;
    }
    if (!window.confirm('Change the final navigation point? The official departure assignment will stay the same.')) return;
    setTripBusy(true);
    try {
      await configureTripRoute(
        {
          id: selectedDestination.id,
          address: selectedDestination.label,
          lat: selectedDestination.lat,
          lng: selectedDestination.lng,
        },
        liveTrip.intermediateStops.map((stop) => ({
          id: stop.id,
          address: stop.address,
          lat: stop.lat,
          lng: stop.lng,
        })),
        officialRunKey,
      );
      setDestinationEditing(false);
      toast.success('Final navigation point saved. The official departure assignment was kept.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the final destination.');
    } finally {
      setTripBusy(false);
    }
  }

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      brandName: store.brandName,
      routeId: store.routeId,
      displayMode: store.displayMode,
      passengerLanguage: liveTrip.passengerLanguage,
      rotationIntervalSeconds: store.rotationIntervalSeconds,
      arrivalSoundsEnabled: liveTrip.arrivalSoundsEnabled,
    },
  });
  const lastSyncedSettingsVersion = useRef('');

  useEffect(() => {
    if (!paired || liveTrip.updatedAt === new Date(0).toISOString()) return;
    if (lastSyncedSettingsVersion.current === liveTrip.updatedAt) return;
    lastSyncedSettingsVersion.current = liveTrip.updatedAt;
    const syncedSettings = {
      routeId: liveTrip.routeId,
      displayMode: liveTrip.displayMode,
      passengerLanguage: liveTrip.passengerLanguage,
      rotationIntervalSeconds: liveTrip.rotationIntervalSeconds,
      arrivalSoundsEnabled: liveTrip.arrivalSoundsEnabled,
    };
    form.reset(
      { ...form.getValues(), ...syncedSettings },
      { keepDirtyValues: true },
    );
    store.updateSettings({
      ...syncedSettings,
      ...(!announcementsDirty ? { announcements: liveTrip.announcements ?? [] } : {}),
    });
  }, [
    form,
    liveTrip.arrivalSoundsEnabled,
    liveTrip.announcements,
    liveTrip.displayMode,
    liveTrip.passengerLanguage,
    liveTrip.rotationIntervalSeconds,
    liveTrip.routeId,
    liveTrip.updatedAt,
    announcementsDirty,
    paired,
    store,
  ]);

  function updateAnnouncementDraft(next: Announcement[]) {
    store.updateSettings({ announcements: next });
    setAnnouncementsDirty(true);
  }

  async function saveAnnouncements() {
    if (!paired) {
      toast.error('Connect to a bus before updating passenger announcements.');
      return;
    }
    setAnnouncementsSaving(true);
    try {
      await updateTripAnnouncements(store.announcements);
      setAnnouncementsDirty(false);
      toast.success('Announcements saved for the optional passenger slide.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save passenger announcements.');
    } finally {
      setAnnouncementsSaving(false);
    }
  }

  function addAnnouncement() {
    updateAnnouncementDraft([
      ...store.announcements,
      {
        id: crypto.randomUUID(),
        title: 'New Announcement',
        message: 'Enter details here',
        active: true,
      },
    ]);
  }

  function editAnnouncement(id: string, update: Partial<Announcement>) {
    updateAnnouncementDraft(
      store.announcements.map((announcement) =>
        announcement.id === id ? { ...announcement, ...update } : announcement),
    );
  }

  function deleteAnnouncement(id: string) {
    updateAnnouncementDraft(
      store.announcements.filter((announcement) => announcement.id !== id),
    );
  }

  async function onSubmit(values: z.infer<typeof settingsSchema>) {
    if (!paired) {
      toast.error('Connect to a bus before updating the passenger display.');
      return;
    }
    setConfigurationSaveStatus('saving');
    try {
      await updateTripDisplaySettings({
        routeId: values.routeId,
        displayMode: values.displayMode,
        passengerLanguage: values.passengerLanguage,
        rotationIntervalSeconds: values.rotationIntervalSeconds,
        arrivalSoundsEnabled: values.arrivalSoundsEnabled,
      });
      store.updateSettings(values);
      setConfigurationSaveStatus('saved');
      toast.success('Configuration saved.');
    } catch (error) {
      setConfigurationSaveStatus('error');
      toast.error(error instanceof Error ? error.message : 'Could not update the passenger display.');
    }
  }

  async function handleConnectBus(requestedBusNumber?: string) {
    const normalized = (requestedBusNumber ?? busNumber).trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(normalized)) {
      toast.error('Dispatch assigned an invalid coach number. Ask dispatch to use 1–6 letters or numbers.');
      return;
    }
    setTripBusy(true);
    try {
      setBusNumber(normalized);
      const result = await connectOperatorToBus(normalized);
      const syncedSettings = {
        routeId: result.trip.routeId,
        displayMode: result.trip.displayMode,
        passengerLanguage: result.trip.passengerLanguage,
        rotationIntervalSeconds: result.trip.rotationIntervalSeconds,
        arrivalSoundsEnabled: result.trip.arrivalSoundsEnabled,
      };
      store.updateSettings(syncedSettings);
      form.reset({ ...form.getValues(), ...syncedSettings });
      if (result.trip.destination) {
        const savedDestination: AddressSuggestion = {
          id: 'saved-destination',
          label: result.trip.destinationAddress,
          lat: result.trip.destination.lat,
          lng: result.trip.destination.lng,
          type: 'saved',
        };
        setDestinationAddress(savedDestination.label);
        setSelectedDestination(savedDestination);
      }
      setRouteStops(stopDraftsFromTrip(result.trip.intermediateStops));
      setRouteStopsDirty(false);
      setOfficialRunKey(result.trip.officialRunKey ?? null);
      setArrivalNotice('');
      setPaired(true);
      setPairingCode(result.pairingCode);
      toast.success(`Connected to bus ${normalized}.`);
    } catch (error) {
      setPaired(false);
      toast.error(error instanceof Error ? error.message : 'Could not connect to that bus.');
    } finally {
      setTripBusy(false);
    }
  }

  async function handleAccountSignOut() {
    setTripBusy(true);
    try {
      const response = await fetch('/api/driver/release-coaches', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to release coaches');
      }
      clearOperatorSession();
      window.dispatchEvent(new CustomEvent('driver-account-changed'));
      await signOut({ redirectUrl: appUrl('/sign-in') });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sign out completely.');
    } finally {
      setTripBusy(false);
    }
  }

  async function handleLogout() {
    setTripBusy(true);
    try {
      const result = await logoutPairedScreens();
      setPairingCode(result.pairingCode);
      setQrInvite(null);
      setQrInviteOpen(false);
      toast.success('All paired passenger screens were logged out.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not log out paired screens.');
    } finally {
      setTripBusy(false);
    }
  }

  useEffect(() => {
    if (!paired || !pairingCode) {
      setQrInvite(null);
      setQrInviteOpen(false);
      return;
    }
    let cancelled = false;
    let refreshTimer: number | null = null;
    const refreshInvite = async () => {
      try {
        const { token, expiresAt } = await createPassengerQrInvite();
        if (cancelled) return;
        const url = new URL(`${import.meta.env.BASE_URL}bus-display`, window.location.origin);
        url.searchParams.set('join', token);
        setQrInvite({ url: url.toString(), expiresAt });
        refreshTimer = window.setTimeout(
          refreshInvite,
          Math.max(30_000, new Date(expiresAt).getTime() - Date.now() - 30_000),
        );
      } catch {
        if (!cancelled) {
          setQrInvite(null);
          refreshTimer = window.setTimeout(refreshInvite, 30_000);
        }
      }
    };
    void refreshInvite();
    return () => {
      cancelled = true;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [paired, pairingCode]);

  useEffect(() => {
    if (!qrInviteOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQrInviteOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [qrInviteOpen]);

  async function handleEmergencyChange(emergencyOverride: boolean, emergencyMessage: string) {
    if (!paired) {
      toast.error('Connect to a bus first.');
      return;
    }
    try {
      await updateEmergencySettings(emergencyOverride, emergencyMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the emergency message.');
    }
  }

  async function handleTestChime() {
    if (!paired) {
      toast.error('Connect to a bus before testing the passenger chime.');
      return;
    }
    setChimeTestBusy(true);
    try {
      await testPassengerChime();
      toast.success('Test chime sent to the passenger display.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not test the passenger chime.');
    } finally {
      setChimeTestBusy(false);
    }
  }

  function beginLocationPublishing() {
    if (watchId.current !== null) return;
    if (!navigator.geolocation) {
      setGpsState('error');
      setGpsMessage('This device does not support GPS location.');
      return;
    }
    const publishLatestPosition = async () => {
      const coords = latestPosition.current;
      if (!coords || Date.now() - latestPositionAt.current > 30_000 || locationPublishInFlight.current) return;
      if (!validCoordinates(coords)) {
        setGpsState('error');
        setGpsMessage('The device returned invalid GPS coordinates.');
        return;
      }
      locationPublishInFlight.current = true;
      try {
        await publishTripLocation(
          { lat: coords.latitude, lng: coords.longitude },
          coords.speed === null ? null : coords.speed * 2.23694,
        );
        lastLocationPublish.current = Date.now();
        setGpsCoordinates({ lat: coords.latitude, lng: coords.longitude });
        setGpsAccuracy(Number.isFinite(coords.accuracy) ? coords.accuracy : null);
        setGpsLastUpdatedAt(Date.now());
        setGpsState('live');
        setGpsMessage('GPS is live and updating automatically.');
      } catch (error) {
        setGpsState('error');
        setGpsMessage(`The GPS fix was found, but it could not be sent: ${error instanceof Error ? error.message : 'request failed'}`);
        throw error;
      } finally {
        locationPublishInFlight.current = false;
      }
    };
    watchId.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) => {
        if (!validCoordinates(coords)) {
          setGpsState('error');
          setGpsMessage('The device returned invalid GPS coordinates.');
          return;
        }
        latestPosition.current = coords;
        latestPositionAt.current = Date.now();
        setGpsCoordinates({ lat: coords.latitude, lng: coords.longitude });
        setGpsState('acquiring');
        setGpsMessage('GPS signal found. Sending the latest position…');
        const cadence = coords.speed != null && coords.speed > 1.4 ? 5_000 : 15_000;
        if (Date.now() - lastLocationPublish.current >= cadence) {
          void publishLatestPosition().catch(() => undefined);
        }
      },
      (error) => {
        setGpsState('error');
        setGpsMessage(gpsErrorMessage(error));
        const permissionDenied = error.code === 1;
        if (permissionDenied) {
          setGpsCoordinates(null);
          setGpsLastUpdatedAt(null);
        }
        if (watchId.current !== null) {
          navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
        }
        if (Date.now() - lastGpsErrorNotice.current >= 60_000) {
          lastGpsErrorNotice.current = Date.now();
          toast.error(permissionDenied
            ? 'GPS permission is blocked. Enable location access in the browser, then retry GPS.'
            : 'GPS signal paused. Tracking will retry automatically.');
        }
        if (!permissionDenied && locationRetryTimer.current === null) {
          locationRetryTimer.current = window.setTimeout(() => {
            locationRetryTimer.current = null;
            void resumeLocationPublishing();
          }, 15_000);
        }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );
    if (locationTimer.current === null) {
      locationTimer.current = window.setInterval(() => {
        void publishLatestPosition().catch(() => undefined);
      }, 5_000);
    }
  }

  async function resumeLocationPublishing() {
    if (!paired || liveTrip.status !== 'running' || locationResumeInFlight.current) return;
    locationResumeInFlight.current = true;
    setGpsState('acquiring');
    setGpsMessage('Requesting a fresh GPS position…');
    try {
      const position = await requestCurrentPosition();
      if (!validCoordinates(position.coords)) throw new Error('The device returned invalid GPS coordinates.');
      latestPosition.current = position.coords;
      latestPositionAt.current = Date.now();
       setGpsAccuracy(Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null);
       await publishTripLocation(
        { lat: position.coords.latitude, lng: position.coords.longitude },
        position.coords.speed === null ? null : position.coords.speed * 2.23694,
      );
      lastLocationPublish.current = Date.now();
      setGpsCoordinates({ lat: position.coords.latitude, lng: position.coords.longitude });
      setGpsLastUpdatedAt(Date.now());
      setGpsState('live');
      setGpsMessage('GPS is live and updating automatically.');
      beginLocationPublishing();
    } catch (error) {
      setGpsState('error');
      setGpsMessage(error instanceof GeolocationRequestError
        ? gpsErrorMessage(error)
        : `GPS signal found, but the position could not be sent: ${error instanceof Error ? error.message : 'request failed'}`);
      const permissionDenied = error instanceof GeolocationRequestError && error.code === 1;
      if (!permissionDenied && locationRetryTimer.current === null) {
        locationRetryTimer.current = window.setTimeout(() => {
          locationRetryTimer.current = null;
          void resumeLocationPublishing();
        }, 15_000);
      }
    } finally {
      locationResumeInFlight.current = false;
    }
  }

  useEffect(() => {
    if (!paired || liveTrip.status !== 'running') return;

    const resume = () => {
      if (document.visibilityState === 'hidden') return;
      void resumeLocationPublishing();
    };
    void resumeLocationPublishing();
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [liveTrip.status, paired]);

  async function handleStartTrip() {
    if (!liveTrip.officialRunKey || !liveTrip.destination) {
      toast.error('Choose a dispatch-assigned trip first.');
      return;
    }
    setTripBusy(true);
    setArrivalNotice('');
    setGpsState('acquiring');
    setGpsMessage('Starting trip. GPS permission will be requested next…');
    try {
      await startLiveTrip();
      setNavigationMode(true);
      setGpsMessage('Trip started. Requesting a fresh GPS position…');
      toast.success('Trip started. You can complete stops manually while GPS connects.');
    } catch (error) {
      setGpsState('error');
      setGpsMessage(`The trip could not start: ${error instanceof Error ? error.message : 'request failed'}`);
      toast.error(error instanceof Error ? error.message : 'Could not start the trip.');
    } finally {
      setTripBusy(false);
    }
  }

  function addRouteStop() {
    setRouteStops((current) => [
      ...current,
      { id: crypto.randomUUID(), address: '', suggestion: null },
    ]);
    setRouteStopsDirty(true);
  }

  function updateRouteStop(index: number, next: StopDraft) {
    setRouteStops((current) => current.map((stop, stopIndex) => stopIndex === index ? next : stop));
    setRouteStopsDirty(true);
  }

  function removeRouteStop(index: number) {
    setRouteStops((current) => current.filter((_, stopIndex) => stopIndex !== index));
    setRouteStopsDirty(true);
  }

  function moveRouteStop(index: number, direction: -1 | 1) {
    setRouteStops((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered;
    });
    setRouteStopsDirty(true);
  }

  function resetRouteStopEdits() {
    setRouteStops(stopDraftsFromTrip(liveTrip.intermediateStops));
    setRouteStopsDirty(false);
  }

  async function saveRouteStopEdits() {
    if (!selectedDestination || !liveTrip.destination || !officialRunKey) {
      toast.error('The assigned run is still loading. Try again before changing stops.');
      return;
    }
    const unselectedStop = routeStops.find((stop) => !stop.suggestion);
    if (unselectedStop) {
      toast.error('Choose an address suggestion for every stop before saving.');
      return;
    }

    setTripBusy(true);
    try {
      await configureTripRoute(
        {
          id: selectedDestination.id,
          address: liveTrip.destinationAddress,
          lat: liveTrip.destination.lat,
          lng: liveTrip.destination.lng,
        },
        routeStops.map((stop) => ({
          id: stop.id,
          address: stop.suggestion!.label,
          lat: stop.suggestion!.lat,
          lng: stop.suggestion!.lng,
        })),
        officialRunKey,
      );
      setRouteStopsDirty(false);
      toast.success('Stops saved. The assigned run and final destination were kept.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save stops. Your edits were kept.');
    } finally {
      setTripBusy(false);
    }
  }

  async function handleResumeTracking() {
    setTripBusy(true);
    setGpsState('acquiring');
    setGpsMessage('Requesting a fresh GPS position…');
    try {
      const position = await requestCurrentPosition();
      if (!validCoordinates(position.coords)) throw new Error('The device returned invalid GPS coordinates.');
      latestPosition.current = position.coords;
      latestPositionAt.current = Date.now();
      await publishTripLocation(
        { lat: position.coords.latitude, lng: position.coords.longitude },
        position.coords.speed === null ? null : position.coords.speed * 2.23694,
      );
      lastLocationPublish.current = Date.now();
      setGpsCoordinates({ lat: position.coords.latitude, lng: position.coords.longitude });
      setGpsLastUpdatedAt(Date.now());
      setGpsState('live');
      setGpsMessage('GPS is live and updating automatically.');
      beginLocationPublishing();
      toast.success('Live GPS updates resumed.');
    } catch (error) {
      setGpsState('error');
      setGpsMessage(error instanceof GeolocationRequestError
        ? gpsErrorMessage(error)
        : `GPS signal found, but the position could not be sent: ${error instanceof Error ? error.message : 'request failed'}`);
      toast.error(error instanceof Error ? error.message : 'Could not resume GPS updates.');
    } finally {
      setTripBusy(false);
    }
  }

  async function handleStopTrip() {
    setTripBusy(true);
    try {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      if (locationTimer.current !== null) {
        window.clearInterval(locationTimer.current);
        locationTimer.current = null;
      }
      latestPosition.current = null;
      latestPositionAt.current = 0;
      setGpsState('waiting');
      setGpsCoordinates(null);
      setGpsLastUpdatedAt(null);
      setGpsMessage('Start the trip to begin GPS tracking.');
      if (locationRetryTimer.current !== null) {
        window.clearTimeout(locationRetryTimer.current);
        locationRetryTimer.current = null;
      }
      await stopLiveTrip();
      if (liveTrip.displayMode === 'next-stop') {
        await updateTripDisplaySettings({
          routeId: liveTrip.routeId,
          displayMode: 'auto',
          passengerLanguage: liveTrip.passengerLanguage,
          rotationIntervalSeconds: liveTrip.rotationIntervalSeconds,
          arrivalSoundsEnabled: liveTrip.arrivalSoundsEnabled,
        });
        store.updateSettings({ displayMode: 'auto' });
      }
      setArrivalNotice('');
      toast.success('Trip stopped.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not stop the trip.');
    } finally {
      setTripBusy(false);
    }
  }

  async function handleClearRoute() {
    setTripBusy(true);
    try {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      if (locationTimer.current !== null) {
        window.clearInterval(locationTimer.current);
        locationTimer.current = null;
      }
      if (locationRetryTimer.current !== null) {
        window.clearTimeout(locationRetryTimer.current);
        locationRetryTimer.current = null;
      }
      latestPosition.current = null;
      latestPositionAt.current = 0;
      await clearTripRoute();
      setDestinationAddress('');
      setSelectedDestination(null);
      setRouteStops([]);
      setRouteStopsDirty(false);
      setOfficialRunKey(null);
      setAddressSuggestions([]);
      setSuggestionsOpen(false);
      setArrivalNotice('');
      store.updateSettings({ displayMode: 'auto' });
      form.setValue('displayMode', 'auto');
      toast.success('Route cleared from passenger displays.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not clear the route.');
    } finally {
      setTripBusy(false);
    }
  }

  async function handleArrive(requestedStopIdentity?: string) {
    if (automaticArrivalInFlight.current) return;
    const stop = liveTrip.intermediateStops[0];
    const expectedStopIdentity = requestedStopIdentity
      ?? stop?.id
      ?? (liveTrip.destination ? `${liveTrip.destination.lat}:${liveTrip.destination.lng}` : '');
    const expectedStartedAt = liveTrip.startedAt;
    if (!expectedStopIdentity || !expectedStartedAt) {
      toast.error('The active trip is still synchronizing. Wait a moment and try again.');
      return;
    }
    automaticArrivalInFlight.current = true;
    setTripBusy(true);
    try {
      const result = await arriveAtNextDestination(
        expectedStopIdentity,
        expectedStartedAt,
      );
      setRouteStops(stopDraftsFromTrip(result.trip.intermediateStops));
      if (result.tripComplete) {
        if (watchId.current !== null) {
          navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
        }
        if (locationTimer.current !== null) {
          window.clearInterval(locationTimer.current);
          locationTimer.current = null;
        }
        latestPosition.current = null;
        latestPositionAt.current = 0;
        if (locationRetryTimer.current !== null) {
          window.clearTimeout(locationRetryTimer.current);
          locationRetryTimer.current = null;
        }
        if (result.trip.displayMode === 'next-stop') {
          await updateTripDisplaySettings({
            routeId: result.trip.routeId,
            displayMode: 'auto',
            passengerLanguage: result.trip.passengerLanguage,
            rotationIntervalSeconds: result.trip.rotationIntervalSeconds,
            arrivalSoundsEnabled: result.trip.arrivalSoundsEnabled,
          });
          store.updateSettings({ displayMode: 'auto' });
        }
        const message = `Arrived at ${result.arrivedAt.split(',')[0]}. Trip complete.`;
        setArrivalNotice(message);
        toast.success(message);
        return;
      }

      const coords = latestPosition.current;
      if (coords) {
        await publishTripLocation(
          { lat: coords.latitude, lng: coords.longitude },
          coords.speed === null ? null : coords.speed * 2.23694,
        );
      }
      const message = `Arrived at ${result.arrivedAt.split(',')[0]}. Continuing to ${result.nextDestination?.split(',')[0]}.`;
      setArrivalNotice(message);
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not mark this stop as arrived.');
    } finally {
      automaticArrivalInFlight.current = false;
      setTripBusy(false);
    }
  }

  async function handleNextStopTakeover() {
    const nextMode = liveTrip.displayMode === 'next-stop' ? 'auto' : 'next-stop';
    setTripBusy(true);
    try {
      await updateTripDisplaySettings({
        routeId: liveTrip.routeId,
        displayMode: nextMode,
        passengerLanguage: liveTrip.passengerLanguage,
        rotationIntervalSeconds: liveTrip.rotationIntervalSeconds,
        arrivalSoundsEnabled: liveTrip.arrivalSoundsEnabled,
      });
      store.updateSettings({ displayMode: nextMode });
      toast.success(nextMode === 'next-stop' ? 'Showing the next stop to passengers.' : 'Passenger slides resumed.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change the passenger display.');
    } finally {
      setTripBusy(false);
    }
  }

  if (navigationMode && liveTrip.status === 'running') {
    return (
      <NavigationCockpit
        onExit={() => setNavigationMode(false)}
        onEmergencyAccess={() => {
          setNavigationMode(false);
          setActiveTab('more');
        }}
        gpsAccuracy={gpsAccuracy}
        dispatchMessage={dispatchBrief}
      />
    );
  }


  return (
    <div className="operator-theme min-h-[100dvh] bg-background text-foreground selection:bg-primary/20 flex flex-col font-sans pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">
      {/* Mobile Header */}
      <header className="sticky top-0 z-40 bg-card border-b border-border shadow-sm px-4 h-14 flex items-center justify-between sm:hidden">
         <div className="flex items-center gap-3">
            <img src={`${import.meta.env.BASE_URL}monsey-trails-logo.png`} alt="Monsey Trails" className="h-6 w-auto" />
            <h1 className="text-base font-black tracking-tight leading-none text-foreground capitalize">{activeTab}</h1>
         </div>
      </header>

      {/* Desktop Header */}
      <header className="hidden sm:flex sticky top-0 z-40 bg-card border-b border-border shadow-sm px-6 h-16 items-center justify-between">
          <div className="flex items-center gap-4">
             <img src={`${import.meta.env.BASE_URL}monsey-trails-logo.png`} alt="Monsey Trails" className="h-8 w-auto" />
            <div>
              <h1 className="text-lg font-black tracking-tight leading-none text-foreground">Operator Console</h1>
              <p className="text-xs font-bold text-muted-foreground">
                 {profile?.username || 'Driver'} • {paired ? `Coach ${busNumber}` : 'Choose a dispatch assignment'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6">
              <DesktopTabNavigation activeTab={activeTab} onTabChange={setActiveTab} />
              <div className="flex items-center gap-2">
                {adminAccess?.authorized && (
                  <Link href="/admin">
                    <Button variant="ghost" size="sm" className="flex text-amber-600 hover:text-amber-500 hover:bg-amber-500/10 rounded-full font-bold px-2 sm:px-3" title="Administrator">
                      <ShieldAlert className="h-4 w-4 sm:mr-2" /> <span className="hidden sm:inline">Admin</span>
                    </Button>
                  </Link>
                )}
                <Link
                  href="/?fullscreen=1"
                  className="inline-flex items-center justify-center gap-2 text-xs font-black transition-all bg-muted hover:bg-muted/80 text-foreground h-9 w-9 sm:w-auto sm:px-4 rounded-full"
                  target="_blank"
                  title="Launch passenger display"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Launch Display</span>
                </Link>
                <div className="w-px h-6 bg-border mx-2" />
                <ThemeToggle />
                <Button variant="ghost" size="sm" disabled={tripBusy} className="text-muted-foreground hover:text-foreground rounded-full h-9 w-9 p-0" onClick={handleAccountSignOut} title="Sign Out" aria-label="Sign out">
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
          </div>
      </header>

      <main className="flex-1 w-full max-w-[1600px] mx-auto p-4 sm:p-6 flex flex-col relative z-10">
                  {/* activeTab rendering */}
         {activeTab === 'home' && (
            <div className="grid grid-cols-1 gap-6 max-w-3xl mx-auto w-full">
               <AssignedScheduledTrips
                driverId={user?.id}
                 currentBusNumber={paired ? busNumber : ''}
                 currentOfficialRunKey={liveTrip.officialRunKey ?? officialRunKey}
                 currentStatus={liveTrip.status}
                 currentDestination={liveTrip.destinationAddress || destinationAddress}
                 currentStopCount={liveTrip.intermediateStops.length || routeStops.length}
                 busy={tripBusy}
                 onChoose={(assignedBusNumber) => void handleConnectBus(assignedBusNumber)}
               />
               <DriverCommunications onBriefChange={setDispatchBrief} />
              {/* Step 1: Coach Connection & GPS */}
              <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col">
                <div className="bg-muted/30 px-5 py-3 border-b border-border/50 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-black text-muted-foreground uppercase tracking-wider">
                    {paired ? <Wifi className="w-4 h-4 text-[#10b981]" /> : <WifiOff className="w-4 h-4" />}
                    Coach Connection
                  </div>
                  <div className="flex items-center gap-3">
                    {paired && (
                      <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-[#10b981] bg-[#10b981]/10 px-2 py-0.5 rounded-full" data-testid="status-paired">
                        <CheckCircle2 className="w-3 h-3" /> Connected
                      </span>
                    )}
                    {gpsState === 'live' && (
                      <span className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full" data-testid="status-gps-live">
                        <MapPin className="w-3 h-3" /> GPS Active
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Dispatch-assigned coach */}
                  <div className="flex flex-col gap-3">
                    <label className="text-[11px] font-black uppercase tracking-[0.1em] text-muted-foreground">Dispatch-assigned coach</label>
                    <div className="flex h-11 items-center gap-3 rounded-xl border border-border bg-muted/20 px-4">
                      <Bus className="h-4 w-4 text-muted-foreground" />
                      <span className="font-bold">{paired ? `Coach ${busNumber}` : 'Choose an assigned trip above'}</span>
                    </div>

                    {paired && (
                      <div className="mt-2 flex items-center justify-between p-3 rounded-xl border border-primary/20 bg-primary/5">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Pairing Code</p>
                          <p className="font-mono text-xl font-black tracking-widest text-primary leading-none mt-1" data-testid="pairing-code">{pairingCode}</p>
                        </div>
                        <div className="flex gap-2">
                          {qrInvite && (
                            <button
                              type="button"
                              className="bg-white p-1.5 rounded-lg shadow-sm hover:shadow-md transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              title="Show QR Code"
                              onClick={() => setQrInviteOpen(true)}
                            >
                              <QRCodeSVG value={qrInvite.url} size={32} level="M" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* GPS Info */}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-black uppercase tracking-[0.1em] text-muted-foreground">Location Status</label>
                      {liveTrip.status === 'running' && (
                        <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] font-bold px-2 rounded-full" disabled={tripBusy || gpsState === 'acquiring'} onClick={handleResumeTracking}>
                          <RefreshCw className={cn('mr-1.5 h-3 w-3', gpsState === 'acquiring' && 'animate-spin')} /> Enable / retry GPS
                        </Button>
                      )}
                    </div>

                    <div className="flex-1 rounded-xl border border-border bg-muted/20 p-3 flex flex-col justify-center">
                      <div className="flex items-center gap-2 mb-2">
                        <Activity className={cn('h-4 w-4', gpsState === 'live' ? 'text-[#10b981]' : gpsState === 'error' ? 'text-destructive' : 'text-muted-foreground')} />
                        <span className={cn('text-sm font-bold', gpsState === 'error' ? 'text-destructive' : 'text-foreground')} data-testid="gps-message">
                          {liveTrip.status === 'running' ? gpsMessage : 'Start trip to track GPS.'}
                        </span>
                      </div>

                      {gpsCoordinates ? (
                        <div className="flex gap-4 mt-2">
                          <div>
                            <span className="text-[9px] font-black uppercase text-muted-foreground tracking-wider block">Lat</span>
                            <span className="font-mono text-xs font-semibold">{gpsCoordinates.lat.toFixed(5)}</span>
                          </div>
                          <div>
                            <span className="text-[9px] font-black uppercase text-muted-foreground tracking-wider block">Lng</span>
                            <span className="font-mono text-xs font-semibold">{gpsCoordinates.lng.toFixed(5)}</span>
                          </div>
                        </div>
                      ) : null}

                      {liveTrip.status === 'running' && liveTrip.locationVisibility === 'before_departure' && (
                        <p className="mt-2 text-[10px] font-bold text-amber-600 leading-tight">
                          GPS received. Passengers see location after departure time.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Status Info */}
                  <div className="flex flex-col gap-3">
                    <label className="text-[11px] font-black uppercase tracking-[0.1em] text-muted-foreground">System Status</label>
                    <div className="flex gap-4">
                      <div className={cn(
                        "flex-1 rounded-xl border p-3 flex flex-col justify-center",
                        passengerDisplays.length > 0 && blockedPassengerDisplays.length === 0
                          ? "border-[#10b981]/30 bg-[#10b981]/10 text-emerald-800 dark:text-emerald-300"
                          : "border-[#f59e0b]/30 bg-[#f59e0b]/10 text-amber-900 dark:text-amber-200",
                      )}>
                        <p className="text-[10px] font-black uppercase tracking-wider opacity-80 mb-1">Screens</p>
                        <div className="flex items-center gap-2 text-sm font-bold">
                          {passengerDisplays.length > 0 && blockedPassengerDisplays.length === 0
                            ? <Volume2 className="h-4 w-4" />
                            : <VolumeX className="h-4 w-4" />}
                          {passengerDisplays.length === 0
                            ? '0 Online'
                            : blockedPassengerDisplays.length === 0
                              ? `${passengerDisplays.length} Ready`
                              : `Audio blocked (${blockedPassengerDisplays.length})`}
                        </div>
                      </div>

                      <div className="flex-1 rounded-xl border border-border bg-muted/20 p-3 flex flex-col justify-center">
                        <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground mb-1">Data Sync</p>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                           <RefreshCw className={cn("h-3.5 w-3.5 text-primary", refreshStatus.isRefreshing && "animate-spin")} />
                           {refreshStatus.isRefreshing
                             ? 'Syncing...'
                             : refreshStatus.lastRefreshFailed
                               ? 'Connection lost'
                               : refreshStatus.lastSuccessfulRefreshAt
                                 ? 'Up to date'
                                 : 'Waiting for sync'}
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </section>

              {/* Ready to Start / Live Navigation */}
              <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col">
                <div className="bg-primary/5 px-5 py-3 border-b border-primary/20 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-black text-primary uppercase tracking-wider">
                    <Navigation className={cn("w-4 h-4", liveTrip.status === 'running' && "animate-pulse")} />
                    {liveTrip.status === 'running' ? "Live Navigation" : "Ready to Start"}
                  </div>
                  {liveTrip.remainingDistanceMiles !== null && (
                    <span className="text-[10px] font-black bg-primary text-primary-foreground px-2 py-0.5 rounded-full uppercase tracking-wider">
                      {liveTrip.remainingDistanceMiles.toFixed(1)} mi left
                    </span>
                  )}
                </div>

                <div className="p-5 sm:p-6 space-y-6">
                  {/* Status notice */}
                  {liveTrip.status !== 'running' && (
                    <div className="bg-[#10b981]/10 text-emerald-800 dark:text-emerald-300 border border-[#10b981]/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-black uppercase tracking-wider">Run Assigned</p>
                        <p className="text-xs font-semibold mt-1 opacity-90">{routeStops.length + 1} published destinations loaded.</p>
                      </div>
                      <Button
                        onClick={handleStartTrip}
                        disabled={tripBusy || !selectedDestination}
                        className="shrink-0 h-12 rounded-xl font-black bg-[#10b981] hover:bg-[#10b981]/90 text-white shadow-sm"
                        data-testid="button-start-trip"
                      >
                        <Play className="w-4 h-4 mr-2" fill="currentColor" /> Start Trip
                      </Button>
                    </div>
                  )}

                  {/* If running, show controls to end or clear */}
                  {liveTrip.status === 'running' && (
                     <div className="flex flex-wrap items-center gap-3">
                       <Button
                         onClick={() => setNavigationMode(true)}
                         className="flex-1 h-12 rounded-xl font-black shadow-sm text-base bg-primary text-primary-foreground hover:bg-primary/90"
                       >
                         <Map className="w-4 h-4 mr-2" /> Cockpit View
                       </Button>
                       <Button
                         variant="destructive"
                         onClick={handleStopTrip}
                         disabled={tripBusy}
                         className="h-12 rounded-xl font-bold px-6"
                         data-testid="button-stop-trip"
                       >
                         <Square className="w-4 h-4 mr-2" fill="currentColor" /> Stop
                       </Button>
                     </div>
                  )}

                  {/* Active stops overview */}
                  <div className="space-y-3">
                     <h3 className="text-sm font-black text-foreground">Current Destinations</h3>
                     {liveTrip.destinationAddress ? (
                       <div className="flex items-center gap-3 bg-muted/20 border border-border rounded-xl p-3">
                         <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                           <MapPin className="w-3.5 h-3.5" />
                         </div>
                         <div className="min-w-0 flex-1">
                           <p className="text-[10px] font-black uppercase text-muted-foreground tracking-wider">Final Destination</p>
                           <p className="text-sm font-bold truncate">{liveTrip.destinationAddress}</p>
                         </div>
                       </div>
                     ) : (
                       <p className="text-sm text-muted-foreground">No destinations set. Use the Trips tab to assign a route.</p>
                     )}
                  </div>
                </div>
              </section>
            </div>
         )}

         {activeTab === 'trips' && (
            <div className="grid grid-cols-1 gap-6 max-w-3xl mx-auto w-full">
              <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col">
                 <div className="bg-muted/30 px-5 py-3 border-b border-border/50 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-black text-muted-foreground uppercase tracking-wider">
                       <MapPin className="w-4 h-4" /> Trip Stops
                    </div>
                 </div>
                 <div className="p-5">
                    {arrivalNotice && (
                      <div
                        className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-800 dark:text-emerald-300"
                        role="status"
                        data-testid="arrival-notice"
                      >
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        {arrivalNotice}
                      </div>
                    )}
                    {liveTrip.destination && (
                      <p className="mb-3 text-xs font-semibold text-muted-foreground" data-testid="arrival-order-guidance">
                        Complete stops in order. Only the next pending stop can be marked Arrived.
                      </p>
                    )}
                    {liveTrip.destination && (
                      <div className="space-y-3 relative">
                        <div className="absolute left-3.5 top-5 bottom-5 w-0.5 bg-border rounded-full" />
                        {liveTrip.intermediateStops.map((stop, i) => (
                          <div key={stop.id} className="relative flex gap-3 p-3 bg-muted/20 border border-border rounded-xl">
                            <div className="w-7 h-7 rounded-full bg-background border-2 border-primary text-primary flex items-center justify-center shrink-0 z-10 text-xs font-black">
                              {i + 1}
                            </div>
                            <div className="min-w-0 flex-1 pt-1">
                              <p className="text-sm font-bold">{stop.address}</p>
                            </div>
                            <Button
                             type="button"
                             size="sm"
                             variant={i === 0 ? 'default' : 'outline'}
                             onClick={() => void handleArrive(stop.id)}
                             disabled={tripBusy || liveTrip.status !== 'running' || !liveTrip.startedAt || i !== 0}
                             aria-label={`Mark ${stop.address} arrived`}
                             data-testid={`button-arrived-stop-${i}`}
                             className="shrink-0 rounded-lg font-bold"
                            >
                              Arrived
                            </Button>
                          </div>
                        ))}
                        <div className="relative flex gap-3 p-3 bg-primary/5 border border-primary/20 rounded-xl">
                          <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 z-10">
                            <MapPin className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1 pt-1">
                            <p className="text-[10px] font-black uppercase text-primary tracking-wider">Final Destination</p>
                            <p className="text-sm font-bold text-primary-foreground dark:text-primary">{liveTrip.destinationAddress}</p>
                          </div>
                          <Button
                           type="button"
                           size="sm"
                           variant={liveTrip.intermediateStops.length === 0 ? 'default' : 'outline'}
                           onClick={() => liveTrip.destination && void handleArrive(`${liveTrip.destination.lat}:${liveTrip.destination.lng}`)}
                           disabled={tripBusy || liveTrip.status !== 'running' || !liveTrip.startedAt || liveTrip.intermediateStops.length > 0}
                           aria-label={`Mark ${liveTrip.destinationAddress || 'final destination'} arrived`}
                           data-testid="button-arrived-final"
                           className="shrink-0 rounded-lg font-bold"
                          >
                            Arrived
                          </Button>
                        </div>
                      </div>
                    )}
                    {!liveTrip.destination && !arrivalNotice && (
                      <p className="text-sm text-muted-foreground">Choose an admin-assigned trip on Home to load its published schedule.</p>
                    )}
                 </div>
               </div>
            </div>
         )}

         {activeTab === 'map' && (
            <div className="flex-1 min-h-[400px] rounded-2xl overflow-hidden border border-border relative flex flex-col shadow-sm">
               <OperatorMap
                 coach={gpsCoordinates ? { lat: gpsCoordinates.lat, lng: gpsCoordinates.lng } : null}
                 route={liveTrip.status === 'running' ? liveTrip.routeGeometry : []}
                 nextStop={liveTrip.status === 'running' ? (liveTrip.intermediateStops[0] ?? liveTrip.destination) : null}
                 overviewMode={true}
                 speedMph={liveTrip.speedMph}
               />
               {liveTrip.status !== 'running' && (
                  <div className="absolute top-4 left-4 z-[1000] bg-background/95 backdrop-blur px-4 py-3 rounded-xl border shadow-md">
                     <p className="text-sm font-black flex items-center gap-2"><Navigation className="w-4 h-4 text-primary" /> No active trip</p>
                     <p className="text-xs font-medium text-muted-foreground mt-1">{gpsCoordinates ? "Map shows your current location" : "Awaiting GPS connection"}</p>
                  </div>
               )}
               {liveTrip.status === 'running' && (
                  <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-[1000] bg-background/95 backdrop-blur p-4 rounded-2xl border shadow-xl flex items-center gap-4 max-w-sm">
                     <div className="flex-1 min-w-0">
                       <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Next Stop</p>
                       <p className="text-sm font-bold truncate">
                         {liveTrip.intermediateStops[0]?.address || liveTrip.destinationAddress || 'Unknown'}
                       </p>
                       <p className="text-xs font-semibold text-primary mt-0.5">
                         {liveTrip.remainingDistanceMiles !== null ? `${liveTrip.remainingDistanceMiles.toFixed(1)} mi remaining in trip` : 'Calculating trip distance…'}
                       </p>
                     </div>
                     <Button size="icon" aria-label="Start turn-by-turn navigation" className="rounded-full w-12 h-12 shadow-md shrink-0" onClick={() => setNavigationMode(true)}>
                       <Navigation className="w-5 h-5" />
                     </Button>
                  </div>
               )}
            </div>
         )}

         {activeTab === 'more' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto w-full">

              {/* Emergency Override */}
              <section className={cn(
                "col-span-1 md:col-span-2 rounded-2xl border shadow-sm p-5 transition-colors overflow-hidden relative",
                liveTrip.emergencyOverride ? "border-destructive bg-destructive text-destructive-foreground" : "border-border bg-card"
              )}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <h3 className={cn("text-sm font-black uppercase tracking-wider flex items-center gap-1.5", liveTrip.emergencyOverride ? "text-white" : "text-destructive")}>
                      <ShieldAlert className="w-4 h-4" /> Emergency
                    </h3>
                    <p className={cn("text-xs font-medium mt-1", liveTrip.emergencyOverride ? "text-white/80" : "text-muted-foreground")}>
                      Take over all screens instantly.
                    </p>
                  </div>
                  <Switch
                    checked={liveTrip.emergencyOverride}
                    onCheckedChange={(checked) => void handleEmergencyChange(checked, liveTrip.emergencyMessage)}
                    className="data-[state=checked]:bg-white data-[state=checked]:border-white [&>span]:data-[state=checked]:bg-destructive"
                    disabled={!paired}
                    aria-label="Toggle emergency override"
                  />
                </div>
                <Input
                  value={liveTrip.emergencyMessage}
                  onChange={(e) => void handleEmergencyChange(liveTrip.emergencyOverride, e.target.value)}
                  placeholder="Review or enter the alert message before activation..."
                  className={cn(
                    "font-bold h-11 rounded-xl",
                    liveTrip.emergencyOverride
                      ? "bg-white/20 border-white/30 text-white placeholder:text-white/50"
                      : "bg-background border-border",
                  )}
                  disabled={!paired}
                />
              </section>
{/* Display Controls (from right column originally) */}
              <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col">
                <div className="bg-muted/30 px-5 py-3 border-b border-border/50">
                  <div className="flex items-center gap-2 text-xs font-black text-muted-foreground uppercase tracking-wider">
                    <MonitorPlay className="w-4 h-4" /> Quick Actions
                  </div>
                </div>
                <div className="p-5 flex flex-col gap-4">
                  {liveTrip.status === 'running' && liveTrip.destination && (
                    <Button
                      variant="secondary"
                      onClick={() => void handleArrive()}
                      disabled={tripBusy || !liveTrip.startedAt}
                      className="w-full justify-start h-12 rounded-xl font-bold"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      {liveTrip.intermediateStops.length > 0 ? 'Mark next stop arrived' : 'Mark final destination arrived'}
                    </Button>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        setChimeTestBusy(true);
                        try {
                          await testPassengerChime();
                          toast.success('Test chime requested.');
                        } catch {
                          toast.error('Failed to trigger chime.');
                        } finally {
                          setChimeTestBusy(false);
                        }
                      }}
                      disabled={chimeTestBusy}
                      className="flex-1 rounded-xl"
                    >
                      <Volume2 className="w-4 h-4 mr-2" /> Test Chime
                    </Button>
                  </div>
                </div>
              </section>

              {/* Settings & Form */}
              <section className="bg-card rounded-2xl border border-border shadow-sm flex flex-col overflow-hidden">
                <div className="bg-muted/30 px-5 py-3 border-b border-border/50">
                  <div className="flex items-center gap-2 text-xs font-black text-muted-foreground uppercase tracking-wider">
                    <Settings className="w-4 h-4" /> Display Details
                  </div>
                </div>
                <div className="p-5">
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="routeId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Active Route</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value} disabled={tripBusy}>
                                <FormControl>
                                  <SelectTrigger className="h-11 rounded-xl bg-background">
                                    <SelectValue placeholder="Route" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="none">No Route</SelectItem>
                                  <SelectItem value="shuttle">Local Shuttle</SelectItem>
                                  {Object.values(MOCK_ROUTES).map((route) => (
                                    <SelectItem key={route.id} value={route.id}>{route.origin} to {route.destination}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="brandName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Brand Name</FormLabel>
                              <FormControl>
                                <Input {...field} disabled={tripBusy} className="h-11 rounded-xl bg-background" />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="displayMode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Screen Content</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value} disabled={tripBusy}>
                              <FormControl>
                                <SelectTrigger className="h-11 rounded-xl bg-background">
                                  <SelectValue placeholder="Select content" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="auto">Auto-Rotate (Normal)</SelectItem>
                                <SelectItem value="welcome">Welcome Only</SelectItem>
                                <SelectItem value="map">Route Map Only</SelectItem>
                                <SelectItem value="next-stop">Next Stop Only</SelectItem>
                                <SelectItem value="weather">Weather Only</SelectItem>
                                <SelectItem value="traffic">Traffic / Travel Conditions</SelectItem>
                                <SelectItem value="daf">Daf & Calendar</SelectItem>
                                <SelectItem value="jewish-calendar">Daily Zmanim</SelectItem>
                                <SelectItem value="announcements">Announcements Only</SelectItem>
                                <SelectItem value="destinations-info">Destinations Only</SelectItem>
                                <SelectItem value="fares-info">Fares & Tickets Only</SelectItem>
                                <SelectItem value="passenger-guide">Passenger Guide Only</SelectItem>
                                <SelectItem value="contact-info">Contact & Lost and Found</SelectItem>
                                <SelectItem value="charging-amenities">Charging Amenities Only</SelectItem>
                                <SelectItem value="safety">Safety Briefing Only</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />

                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="passengerLanguage"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Language</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value} disabled={tripBusy}>
                                <FormControl>
                                  <SelectTrigger className="h-11 rounded-xl bg-background">
                                    <SelectValue placeholder="Language" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="en">English</SelectItem>
                                  <SelectItem value="yi">Yiddish</SelectItem>
                                  <SelectItem value="he">Hebrew</SelectItem>
                                </SelectContent>
                              </Select>
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="rotationIntervalSeconds"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Slide Speed</FormLabel>
                              <FormControl>
                                <Input type="number" {...field} className="h-11 rounded-xl bg-background" disabled={tripBusy || form.watch('displayMode') !== 'auto'} />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={form.control}
                        name="arrivalSoundsEnabled"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between p-3 border rounded-xl bg-muted/20">
                            <div>
                              <FormLabel className="text-sm font-bold">Arrival Chime</FormLabel>
                              <FormDescription className="text-xs">Play sound before stops</FormDescription>
                            </div>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} disabled={tripBusy} aria-label="Enable arrival sounds" />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <Button type="submit" disabled={tripBusy || configurationSaveStatus === 'saving' || !form.formState.isDirty} className="w-full h-11 rounded-xl font-bold" data-testid="button-save-display-settings">
                        {configurationSaveStatus === 'saving' && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
                        Save Display Changes
                      </Button>
                      {configurationSaveStatus === 'saved' && <p className="text-center text-xs font-bold text-emerald-600">Configuration saved</p>}
                    </form>
                  </Form>
                </div>
              </section>

              {/* Announcement editor, preview, and rotation controls */}
              <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col">
                <Tabs defaultValue="announcements" className="flex flex-col">
                  <div className="bg-muted/30 p-2 border-b border-border/50">
                    <TabsList className="w-full grid grid-cols-3 h-10 bg-muted rounded-xl p-1">
                      <TabsTrigger value="announcements" className="rounded-lg text-xs font-bold">Announcements</TabsTrigger>
                      <TabsTrigger value="preview" className="rounded-lg text-xs font-bold">Preview</TabsTrigger>
                      <TabsTrigger value="visibility" className="rounded-lg text-xs font-bold">Show / Hide</TabsTrigger>
                    </TabsList>
                  </div>

                  <TabsContent value="announcements" className="p-5 m-0 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="flex items-center gap-2 text-sm font-black"><Megaphone className="w-4 h-4" /> Message Slides</h3>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={addAnnouncement} className="h-8 rounded-full text-xs font-bold">
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add
                      </Button>
                    </div>
                    {store.announcements.length === 0 ? (
                      <div className="text-center py-6 text-xs font-bold text-muted-foreground border border-dashed rounded-xl">No custom announcements.</div>
                    ) : store.announcements.map((announcement) => (
                      <div key={announcement.id} className="relative rounded-xl border p-4 pr-12 space-y-3 bg-muted/10">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Delete announcement"
                          className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteAnnouncement(announcement.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <Input
                          value={announcement.title}
                          onChange={(event) => editAnnouncement(announcement.id, { title: event.target.value })}
                          placeholder="Announcement title"
                          aria-label={`Edit header for ${announcement.title}`}
                          className="h-9 font-bold bg-background"
                        />
                        <Input
                          value={announcement.message}
                          onChange={(event) => editAnnouncement(announcement.id, { message: event.target.value })}
                          placeholder="Message text"
                          aria-label={`Edit message for ${announcement.title}`}
                          className="h-9 bg-background"
                        />
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="preview" className="p-5 m-0">
                    <div className="rounded-2xl border bg-muted/20 p-6 min-h-48">
                      <p className="text-xs font-black uppercase tracking-wider text-muted-foreground">Passenger Information</p>
                      {store.announcements.length === 0 ? (
                        <p className="mt-6 text-sm text-muted-foreground">No announcement slides to preview.</p>
                      ) : store.announcements.map((announcement) => (
                        <div key={announcement.id} className="mt-5">
                          <h4 className="text-xl font-black">{announcement.title}</h4>
                          <p className="mt-2 text-sm">{announcement.message}</p>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="visibility" className="p-5 m-0 space-y-3">
                    {store.announcements.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Add an announcement before changing slide visibility.</p>
                    ) : store.announcements.map((announcement) => (
                      <div key={announcement.id} className="flex items-center justify-between gap-4 rounded-xl border p-4">
                        <div>
                          <p className="text-sm font-bold">{announcement.title}</p>
                          <p className="text-xs text-muted-foreground">{announcement.active ? 'Show in main slides' : 'Hide from main slides'}</p>
                        </div>
                        <Switch
                          checked={announcement.active}
                          onCheckedChange={(checked) => editAnnouncement(announcement.id, { active: checked })}
                          aria-label={`Show ${announcement.title} in main slides`}
                        />
                      </div>
                    ))}
                  </TabsContent>

                  <div className="p-4 border-t border-border">
                    <p className="mb-2 text-center text-xs font-bold text-muted-foreground">
                      {announcementsDirty ? 'Unsaved changes' : 'All announcements saved'}
                    </p>
                    <Button
                      type="button"
                      onClick={() => void saveAnnouncements()}
                      disabled={!paired || !announcementsDirty || announcementsSaving}
                      className="w-full h-11 rounded-xl font-bold"
                    >
                      {announcementsSaving ? 'Saving...' : 'Save Announcements'}
                    </Button>
                  </div>
                </Tabs>
              </section>

              {/* Passenger information review and publishing */}
              <section className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden flex flex-col">
                <div className="bg-muted/30 px-5 py-3 border-b border-border/50">
                  <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-muted-foreground">
                    <FileCheck2 className="h-4 w-4" /> Passenger Web Information
                  </h3>
                </div>
                <div className="p-5 space-y-4">
                  {passengerInfo && (
                    <div className={cn(
                      'rounded-xl border px-4 py-3 text-xs font-bold',
                      passengerInfo.stale || passengerInfo.changesDetected
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
                    )}>
                      Reviewed {new Date(passengerInfo.reviewedAt).toLocaleDateString()}
                      {passengerInfo.stale && ` • ${passengerInfo.ageDays} days ago — review overdue`}
                      {passengerInfo.changesDetected && ' • website changes detected'}
                    </div>
                  )}
                  {!passengerInfo?.canManage && (
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        value={passengerInfoKey}
                        onChange={(event) => setPassengerInfoKey(event.target.value)}
                        placeholder="Review key"
                        autoComplete="current-password"
                        className="h-9"
                      />
                      <Button type="button" className="h-9" disabled={passengerInfoBusy || !passengerInfoKey} onClick={() => void handlePassengerInfoAuthorization()}>Unlock</Button>
                    </div>
                  )}
                  {passengerInfo?.canManage && (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {passengerInfo.sourceUrls.map((url) => (
                          <a key={url} href={url} target="_blank" rel="noreferrer" className="text-xs font-black text-primary">Review source <ExternalLink className="inline h-3 w-3" /></a>
                        ))}
                      </div>
                      <textarea
                        value={passengerInfoDraft}
                        onChange={(event) => setPassengerInfoDraft(event.target.value)}
                        className="min-h-48 w-full rounded-xl border border-border bg-background p-3 font-mono text-[10px]"
                        aria-label="Approved passenger information JSON"
                        spellCheck={false}
                      />
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" className="flex-1" disabled={passengerInfoBusy} onClick={() => void handlePassengerInfoCheck()}>Check Website</Button>
                        <Button type="button" className="flex-1" disabled={passengerInfoBusy || !passengerInfoDraft} onClick={() => void handlePassengerInfoApproval()}>Approve & Publish</Button>
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* Account / Admin */}
              <section className="bg-card rounded-2xl border border-border shadow-sm flex flex-col overflow-hidden">
                 <div className="p-5 flex flex-col gap-3">
                    <Button variant="outline" className="w-full h-11 justify-start rounded-xl font-bold" disabled={tripBusy} onClick={() => void handleLogout()}>
                      <LogOut className="w-4 h-4 mr-2" /> Log out all paired screens
                    </Button>
                    {adminAccess?.authorized && (
                      <Link href="/admin">
                        <Button variant="outline" className="w-full h-11 justify-start text-amber-600 border-amber-600/30 hover:bg-amber-600/10 font-bold rounded-xl">
                          <ShieldAlert className="w-4 h-4 mr-2" /> Administration
                        </Button>
                      </Link>
                    )}
                    <Link href="/?fullscreen=1" target="_blank">
                      <Button variant="secondary" className="w-full h-11 justify-start font-bold rounded-xl">
                        <ExternalLink className="w-4 h-4 mr-2" /> Launch Display
                      </Button>
                    </Link>
                    <div className="flex items-center justify-between p-3 border rounded-xl">
                       <span className="text-sm font-bold">Theme</span>
                       <ThemeToggle />
                    </div>
                    <Button variant="destructive" className="w-full h-11 rounded-xl font-bold mt-2" onClick={handleAccountSignOut}>
                       <LogOut className="w-4 h-4 mr-2" /> Sign Out completely
                    </Button>
                 </div>
              </section>
            </div>
         )}
      </main>

      <OperatorTabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      {qrInviteOpen && qrInvite && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
          <div className="bg-card border border-border shadow-2xl rounded-3xl p-8 max-w-sm w-full text-center space-y-6">
            <h3 className="text-2xl font-black">Scan to Pair</h3>
            <div className="bg-white p-6 rounded-2xl mx-auto inline-block shadow-sm">
              <QRCodeSVG value={qrInvite.url} size={200} level="M" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">Show this code to a passenger display device to instantly pair it to bus {busNumber}.</p>
            <Button variant="outline" className="w-full h-12 rounded-xl font-bold" onClick={() => setQrInviteOpen(false)}>Close</Button>
          </div>
        </div>
      )}
    </div>
  );
}
