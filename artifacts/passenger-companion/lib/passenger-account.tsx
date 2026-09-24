import React, { createContext, useContext } from 'react';
import { useAuth, useClerk, useUser } from '@clerk/expo';

type PassengerAccountState = {
  configured: boolean;
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  sessionId: string | null;
  email: string | null;
  getToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
};

const guestAccount: PassengerAccountState = {
  configured: false,
  isLoaded: true,
  isSignedIn: false,
  userId: null,
  sessionId: null,
  email: null,
  getToken: async () => null,
  signOut: async () => { throw new Error('Sign-in is unavailable.'); },
};

const PassengerAccountContext = createContext<PassengerAccountState>(guestAccount);

export function ConnectedPassengerAccount({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, userId, sessionId, getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  return (
    <PassengerAccountContext.Provider value={{
      configured: true,
      isLoaded: Boolean(isLoaded),
      isSignedIn: Boolean(isSignedIn),
      userId: userId ?? null,
      sessionId: sessionId ?? null,
      email: user?.primaryEmailAddress?.emailAddress ?? null,
      getToken: () => getToken(),
      signOut: async () => { await signOut(); },
    }}>
      {children}
    </PassengerAccountContext.Provider>
  );
}

export function usePassengerAccount() {
  return useContext(PassengerAccountContext);
}