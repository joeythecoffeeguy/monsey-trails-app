export const APP_ROUTES = {
  drivers: '/drivers',
  admin: '/admin',
  adminOverview: '/admin/overview',
  adminDispatch: '/admin/dispatch',
  adminDisplay: '/admin/display',
  adminStops: '/admin/stops',
  adminOperations: '/admin/operations',
  adminCommunications: '/admin/communications',
  adminIncidents: '/admin/incidents',
  adminNotifications: '/admin/notifications',
  adminHistory: '/admin/history',
  passengers: '/passengers',
  busDisplay: '/bus-display',
  appSupport: '/app-support',
  appMarketing: '/welcome',
  privacy: '/privacy',
} as const;

export type ClientPath = 'operator' | 'admin-display' | 'mounted' | 'personal' | 'auth' | 'app-support' | 'marketing' | 'privacy';

// Shared by the page shell and polling so a driver never polls as a passenger
// (or a mounted screen as a driver) when using a new or bookmarked address.
export function getClientPath(pathname: string): ClientPath {
  if (/(^|\/)(sign-in|sign-up)(\/|$)/.test(pathname)) return 'auth';
  if (/(^|\/)admin\/display(\/|$)/.test(pathname)) return 'admin-display';
  if (/(^|\/)(drivers|operator|admin)(\/|$)/.test(pathname)) return 'operator';
  if (/(^|\/)(bus-display|mounted)(\/|$)/.test(pathname)) return 'mounted';
  if (/(^|\/)(app-support)(\/|$)/.test(pathname)) return 'app-support';
  if (/(^|\/)(welcome|passenger-app)(\/|$)/.test(pathname)) return 'marketing';
  if (/(^|\/)(privacy)(\/|$)/.test(pathname)) return 'privacy';
  return 'personal';
}

export function needsDriverAuth(pathname: string) {
  const path = getClientPath(pathname);
  return path === 'operator' || path === 'admin-display' || path === 'auth';
}

export function appUrl(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;
}