export type NotificationPermissionSnapshot = {
  granted: boolean;
  canAskAgain: boolean;
};

export function deniedDeparturePermission(snapshot: NotificationPermissionSnapshot) {
  if (snapshot.granted) return null;
  return {
    status: 'denied' as const,
    canAskAgain: snapshot.canAskAgain,
    canOpenSettings: !snapshot.canAskAgain,
    message: snapshot.canAskAgain
      ? 'Notification permission was denied. You can try again when you are ready.'
      : 'Notifications are blocked. Open device settings to allow them.',
  };
}