import { useQuery } from '@tanstack/react-query';
import { getPassengerJourney } from '@workspace/api-client-react';
import type {
  PassengerJourney as GeneratedPassengerJourney,
  PassengerJourneyStop as GeneratedPassengerJourneyStop,
} from '@workspace/api-client-react';
import { readPassengerJourney, savePassengerJourney } from './passengerWebStorage';

export type PassengerJourneyStop = GeneratedPassengerJourneyStop & { note?: string };
export type PassengerJourney = Omit<GeneratedPassengerJourney, 'stops'> & {
  stops: PassengerJourneyStop[];
  arrivalVerification?: 'verified' | 'unverified' | 'unavailable';
  offlineSavedAt?: string;
};

export function usePassengerJourney(runKey: string, paired: boolean) {
  return useQuery<PassengerJourney>({
    queryKey: ['passenger-journey', runKey, paired],
    queryFn: async ({ signal }) => {
      const parts = runKey.split('|');
      if (parts.length !== 5) throw new Error('Invalid run key');
      const [date, line, origin, destination, runId] = parts;
      
      const lineNumber = Number(line);
      if (lineNumber !== 1 && lineNumber !== 2 && lineNumber !== 3) throw new Error('Invalid bus line');
      try {
        const journey = await getPassengerJourney({
            line: lineNumber,
            origin: Number(origin),
            destination: Number(destination),
            date,
            runId
          }, { signal }) as PassengerJourney;
        savePassengerJourney(runKey, journey);
        return journey;
      } catch (error) {
        if (signal.aborted) throw error;
        const saved = readPassengerJourney(runKey);
        if (saved) return saved;
        throw error;
      }
    },
    enabled: Boolean(runKey),
    refetchInterval: 30000,
    retry: 3,
  });
}
