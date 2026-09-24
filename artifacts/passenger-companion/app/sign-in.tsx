import React from 'react';
import { PassengerAuthScreen } from '@/components/PassengerAuthScreen';
import { AccountUnavailable } from '@/components/AccountUnavailable';
import { usePassengerAccount } from '@/lib/passenger-account';

export default function SignInScreen() {
  const { configured } = usePassengerAccount();
  if (!configured) return <AccountUnavailable />;
  return <PassengerAuthScreen mode="sign-in" />;
}