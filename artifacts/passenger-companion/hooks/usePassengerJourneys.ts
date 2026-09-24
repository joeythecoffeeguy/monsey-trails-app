import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  deletePassengerAccountJourney,
  getPassengerAccountJourneys,
  savePassengerAccountJourney,
  useGetPassengerAccountJourneys,
  type PassengerAccountJourneyInput,
} from '@workspace/api-client-react';
import {
  companionStorageKeys,
  routeChoiceKey,
  toggleFavorite,
  type RouteChoice,
} from '@/lib/companion-preferences';
import { usePassengerAccount } from '@/lib/passenger-account';
import { sessionBoundRequest } from '@/lib/session-bound-request';

function toAccountInput(choice: RouteChoice): PassengerAccountJourneyInput {
  return {
    line: choice.line,
    origin: choice.origin,
    destination: choice.destination,
    label: choice.label,
    pickup: choice.pickup ?? undefined,
    dropoff: choice.dropoff ?? undefined,
  };
}

export function usePassengerJourneys() {
  const { isLoaded, isSignedIn, userId, sessionId, getToken } = usePassengerAccount();
  const accountSubject = isLoaded && isSignedIn && sessionId ? userId : null;
  const identity = accountSubject ? `${accountSubject}:${sessionId}` : null;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [authReadySubject, setAuthReadySubject] = useState<string | null>(null);
  // Allow the root auth bridge to register the bearer-token getter first.
  useEffect(() => {
    setAuthReadySubject(identity);
    setActionError('');
  }, [identity]);
  const [guestFavorites, setGuestFavorites] = useState<RouteChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const pinnedRequest = (expected: string | null) =>
    sessionBoundRequest(expected, () => identityRef.current, getToken);
  const saved = useGetPassengerAccountJourneys({
    query: {
      enabled: Boolean(identity && authReadySubject === identity),
      queryKey: ['passenger-account-journeys', accountSubject, sessionId],
      queryFn: async ({ signal }) =>
        getPassengerAccountJourneys({ ...(await pinnedRequest(identity)), signal }),
    },
  });
  const favorites = useMemo<RouteChoice[]>(() => accountSubject
    ? (saved.data?.journeys ?? []).map(journey => ({
      line: journey.line,
      origin: journey.origin,
      destination: journey.destination,
      label: journey.label,
      pickup: journey.pickup ?? null,
      dropoff: journey.dropoff ?? null,
    }))
    : guestFavorites,
  [accountSubject, saved.data, guestFavorites]);
  const unimportedGuestFavorites = accountSubject
    ? guestFavorites.filter(choice => !favorites.some(savedChoice =>
        routeChoiceKey(savedChoice) === routeChoiceKey(choice)))
    : [];

  const toggle = async (choice: RouteChoice) => {
    setActionError('');
    if (!accountSubject) {
      const next = toggleFavorite(guestFavorites, choice);
      setGuestFavorites(next);
      try {
        await AsyncStorage.setItem(companionStorageKeys.favorites, JSON.stringify(next));
      } catch {
        setActionError('This device could not save your route. Please try again.');
      }
      return;
    }
    if (saved.isPending || saved.isError || busy) {
      setActionError('Saved journeys are not available right now. Refresh and try again.');
      return;
    }
    setBusy(true);
    try {
      const existing = saved.data?.journeys.find(journey =>
        routeChoiceKey(journey) === routeChoiceKey(choice));
      const request = await pinnedRequest(identity);
      if (existing) await deletePassengerAccountJourney(existing.id, request);
      else await savePassengerAccountJourney(toAccountInput(choice), request);
      if (identityRef.current === identity) await saved.refetch();
    } catch {
      if (identityRef.current === identity) {
        setActionError('Could not sync your saved journey. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const importGuestFavorites = async () => {
    if (!accountSubject || busy || saved.isPending || saved.isError) return;
    setActionError('');
    setBusy(true);
    try {
      for (const choice of unimportedGuestFavorites) {
        await savePassengerAccountJourney(toAccountInput(choice), await pinnedRequest(identity));
      }
      if (identityRef.current === identity) await saved.refetch();
    } catch {
      if (identityRef.current === identity) {
        setActionError('Some routes could not be imported. Try again; routes already saved will not be duplicated.');
      }
    } finally {
      setBusy(false);
    }
  };

  return {
    accountSubject,
    favorites,
    guestFavorites,
    unimportedGuestCount: unimportedGuestFavorites.length,
    setGuestFavorites,
    toggle,
    importGuestFavorites,
    busy,
    unavailable: Boolean(accountSubject) && (saved.isPending || saved.isError || busy),
    error: accountSubject && saved.isError
      ? 'Could not load your saved journeys. Check your connection and retry.'
      : actionError,
    loading: Boolean(accountSubject) && saved.isPending,
    refresh: () => saved.refetch(),
  };
}