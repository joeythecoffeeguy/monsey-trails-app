import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Redirect,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import PassengerDisplay from '@/pages/passenger';
import OperatorPanel from '@/pages/operator';
import PassengerLayoutFixture from '@/pages/passenger-layout-fixture';
import NavigationLayoutFixture from '@/pages/navigation-layout-fixture';
import type { DisplayMode } from '@/lib/store';
import DriverSignIn, { getSignInLocalization } from '@/pages/driver-sign-in';
import DriverSignUp from '@/pages/driver-sign-up';
import { clearOperatorSession } from '@/providers/live-trip';
import { APP_ROUTES, getClientPath, needsDriverAuth } from '@/lib/app-routes';
import AdminDrivers from '@/pages/admin-drivers';
import AdminBusDisplay from '@/pages/admin-bus-display';
import AdminDispatch from '@/pages/admin-dispatch';
import AdminStops from '@/pages/admin-stops';
import AdminOperations from '@/pages/admin-operations';
import AdminNotifications from '@/pages/admin-notifications';
import AdminOverview from '@/pages/admin-overview';
import AdminPlanned from '@/pages/admin-planned';
import AdminCommunications from '@/pages/admin-communications';
import AdminIncidents from '@/pages/admin-incidents';
import AdminCoachDetail from '@/pages/admin-coach-detail';
import AppSupport from '@/pages/app-support';
import AppMarketing from '@/pages/app-marketing';
import AppPrivacy from '@/pages/app-privacy';
import { AdminLayout } from '@/components/admin/AdminLayout';

import { LoadingSplash } from '@/components/loading-splash';

const queryClient = new QueryClient();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  console.warn('Missing VITE_CLERK_PUBLISHABLE_KEY. Auth will be disabled.');
}

// Clerk passes full browser paths to its router callbacks, while wouter's
// router prepends its base path. Strip the base before delegating so auth
// navigation remains client-side without doubling the deployment prefix.
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

function OperatorRedirect() {
  const { isLoaded, userId } = useAuth();
  const [readySubject, setReadySubject] = useState<string | null | undefined>();
  useEffect(() => {
    if (!isLoaded) return;
    const previous = localStorage.getItem('coach-driver-subject');
    if (previous !== (userId ?? null)) {
      clearOperatorSession();
      queryClient.removeQueries({ queryKey: ['driver-profile'] });
    }
    if (userId) localStorage.setItem('coach-driver-subject', userId);
    else localStorage.removeItem('coach-driver-subject');
    setReadySubject(userId ?? null);
  }, [isLoaded, userId]);
  if (!isLoaded || readySubject !== (userId ?? null)) {
    return <LoadingSplash>Loading your driver account…</LoadingSplash>;
  }
  return userId ? <OperatorPanel key={userId} /> : <Redirect to="/sign-in" />;
}

function AuthUnavailable() {
  return <div role="alert" className="p-8 text-center">Driver sign-in is not configured. Passenger service is still available.</div>;
}

function useDeploymentUpdateReload() {
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const currentEntry = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (!currentEntry) return;

    const checkForUpdate = async () => {
      try {
        const appRoot = new URL(import.meta.env.BASE_URL, window.location.origin);
        appRoot.searchParams.set('_build_check', Date.now().toString());
        const response = await fetch(appRoot, { cache: 'no-store' });
        if (!response.ok) return;
        const html = await response.text();
        const documentCopy = new DOMParser().parseFromString(html, 'text/html');
        const nextEntryPath = documentCopy.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src');
        if (!nextEntryPath) return;
        const nextEntry = new URL(nextEntryPath, appRoot).href;
        if (nextEntry !== currentEntry) window.location.reload();
      } catch {
        // Keep the passenger display running if an update check temporarily fails.
      }
    };

    const timer = window.setInterval(checkForUpdate, 60_000);
    document.addEventListener('visibilitychange', checkForUpdate);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', checkForUpdate);
    };
  }, []);
}

function Router() {
  if (import.meta.env.DEV && window.location.pathname.endsWith('/__layout-test/navigation-cockpit')) {
    return <NavigationLayoutFixture />;
  }
  const fixtureMatch = import.meta.env.DEV
    ? window.location.pathname.match(/\/__layout-test\/([^/]+)$/)
    : null;
  if (fixtureMatch) {
    return <PassengerLayoutFixture mode={decodeURIComponent(fixtureMatch[1]) as DisplayMode} />;
  }
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path={APP_ROUTES.busDisplay}>{() => <PassengerDisplay experience="mounted" />}</Route>
        <Route path={APP_ROUTES.passengers}>{() => <PassengerDisplay experience="personal" />}</Route>
        <Route path={APP_ROUTES.appSupport} component={AppSupport} />
        <Route path={APP_ROUTES.appMarketing} component={AppMarketing} />
        <Route path={APP_ROUTES.privacy} component={AppPrivacy} />
        <Route path="/passenger-app">{() => <Redirect to={`${APP_ROUTES.appMarketing}${window.location.search}${window.location.hash}`} />}</Route>
        <Route path="/mounted">{() => <Redirect to={`${APP_ROUTES.busDisplay}${window.location.search}${window.location.hash}`} />}</Route>
        <Route path="/coach-display/mounted">{() => <Redirect to={`${APP_ROUTES.busDisplay}${window.location.search}${window.location.hash}`} />}</Route>
        <Route path="/">{() => <Redirect to={`${APP_ROUTES.passengers}${window.location.search}${window.location.hash}`} />}</Route>
        <Route path="/sign-in/*?" component={clerkPubKey ? DriverSignIn : AuthUnavailable} />
        <Route path="/sign-up/*?" component={clerkPubKey ? DriverSignUp : AuthUnavailable} />
        <Route path={APP_ROUTES.drivers} component={clerkPubKey ? OperatorRedirect : AuthUnavailable} />
        <Route path="/operator">{() => <Redirect to={APP_ROUTES.drivers} />}</Route>
        <Route path="/admin/drivers">{() => <Redirect to={`${APP_ROUTES.admin}${window.location.search}${window.location.hash}`} />}</Route>
        <Route path={APP_ROUTES.adminOverview}>{() => clerkPubKey ? <AdminLayout><AdminOverview /></AdminLayout> : <AuthUnavailable />}</Route>
        <Route path={APP_ROUTES.adminDisplay}>{() => clerkPubKey ? <AdminLayout><AdminBusDisplay /></AdminLayout> : <AuthUnavailable />}</Route>
        <Route path={APP_ROUTES.adminDispatch}>{() => clerkPubKey ? <AdminLayout><AdminDispatch /></AdminLayout> : <AuthUnavailable />}</Route>
        <Route path={APP_ROUTES.adminStops}>{() => clerkPubKey ? <AdminLayout><AdminStops /></AdminLayout> : <AuthUnavailable />}</Route>
        <Route path={APP_ROUTES.adminOperations}>{() => clerkPubKey ? <AdminLayout><AdminOperations /></AdminLayout> : <AuthUnavailable />}</Route>
        <Route path="/admin/coaches/:busNumber">{() => clerkPubKey ? <AdminLayout><AdminCoachDetail /></AdminLayout> : <AuthUnavailable />}</Route>
        <Route path={APP_ROUTES.adminCommunications}>{() => clerkPubKey ? <AdminLayout><AdminCommunications /></AdminLayout> : <AuthUnavailable />}</Route>
        <Route path={APP_ROUTES.adminIncidents}>{() => clerkPubKey ? <AdminLayout><AdminIncidents /></AdminLayout> : <AuthUnavailable />}</Route>
        <Route path={APP_ROUTES.adminNotifications}>{() => clerkPubKey ? <AdminLayout><AdminNotifications /></AdminLayout> : <AuthUnavailable />}</Route>
        <Route path={APP_ROUTES.adminHistory}>{() => clerkPubKey ? <AdminLayout><AdminPlanned title="History" /></AdminLayout> : <AuthUnavailable />}</Route>
        <Route path={APP_ROUTES.admin}>{() => clerkPubKey ? <AdminLayout><AdminDrivers /></AdminLayout> : <AuthUnavailable />}</Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function DriverAuthBoundary({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();

  return (
    <>
      {clerkPubKey ? (
        <ClerkProvider
          publishableKey={clerkPubKey}
          proxyUrl={clerkProxyUrl}
          signInUrl={`${basePath}/sign-in`}
          appearance={{
            variables: {
              colorPrimary: 'hsl(202 79% 34%)',
              colorForeground: 'hsl(205 41% 16%)',
              colorMutedForeground: 'hsl(205 20% 40%)',
              colorDanger: 'hsl(0 84% 60%)',
              colorBackground: 'hsl(0 0% 100%)',
              colorInput: 'hsl(0 0% 100%)',
              colorInputForeground: 'hsl(205 41% 16%)',
              colorNeutral: 'hsl(205 41% 16%)',
              fontFamily: '"Inter", sans-serif',
            },
            options: {
              logoPlacement: 'inside',
              logoLinkUrl: `${basePath}${APP_ROUTES.drivers}`,
              logoImageUrl: `${window.location.origin}${basePath}/monsey-trails-logo.png`,
            },
            elements: {
              rootBox: 'w-full flex justify-center',
              cardBox: 'bg-white rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl border border-gray-100',
              card: '!shadow-none !border-0 !bg-transparent !rounded-none',
              footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
              headerTitle: 'text-2xl font-black tracking-tight text-center',
              headerSubtitle: 'text-center font-medium mt-1 text-gray-500',
              formFieldLabel: 'font-bold text-gray-900',
              formFieldInput: 'h-11 font-medium bg-gray-50 border-gray-200 focus-visible:ring-primary',
              formButtonPrimary: 'h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-black text-lg shadow-md',
              socialButtonsBlockButton: 'h-12 border-gray-200 font-bold',
              socialButtonsBlockButtonText: '!text-slate-800 font-bold',
              footerActionLink: 'font-bold text-secondary hover:text-secondary/80',
              footerActionText: 'font-medium text-gray-500',
              dividerText: 'font-bold text-gray-400',
              dividerLine: 'bg-gray-200',
              alertText: 'font-bold text-red-700',
              alert: 'bg-red-50 border border-red-200 rounded-md p-3',
              logoImage: 'h-12 mx-auto',
              formFieldSuccessText: 'text-green-600 font-bold',
              identityPreviewEditButton: 'text-secondary font-bold',
              otpCodeFieldInput: 'border-gray-200 font-bold',
              formFieldRow: 'gap-4',
              main: 'flex flex-col gap-4',
            }
          }}
          localization={getSignInLocalization()}
          routerPush={(to) => setLocation(stripBase(to))}
          routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
        >
          {children}
        </ClerkProvider>
      ) : (
        <AuthUnavailable />
      )}
    </>
  );
}

function RouteShell() {
  const [location] = useLocation();
  useEffect(() => {
    const page = getClientPath(location);
    const title = page === 'mounted' ? 'Bus-Mounted Passenger Display'
      : page === 'personal' ? 'Passenger Schedules' 
      : page === 'app-support' ? 'App Support'
      : page === 'marketing' ? 'Passenger App'
      : page === 'privacy' ? 'Privacy Policy' : 'Driver App';
    document.title = `${title} | Monsey Trails`;
    document.querySelector('meta[name="description"]')?.setAttribute('content',
      page === 'mounted' ? 'Pair a bus-mounted passenger screen using the driver’s four-digit display code. No passenger account required.'
        : page === 'personal' ? 'Browse Monsey Trails schedules and follow your trip. No login required.'
        : page === 'app-support' ? 'Technical support for the Monsey Trails passenger app. Help with tracking, schedules, and notifications.'
        : page === 'marketing' ? 'Access published schedules, track live coaches, and manage your travel with the Monsey Trails Passenger App.'
        : page === 'privacy' ? 'Privacy Policy for the Monsey Trails Passenger application.'
          : 'Monsey Trails driver console. Sign in with your administrator-issued account.');
  }, [location]);
  // Public routes must not mount Clerk, even if this browser has a driver session.
  return needsDriverAuth(location)
    ? <DriverAuthBoundary><Router /></DriverAuthBoundary>
    : <Router />;
}

function App() {
  useDeploymentUpdateReload();
  useEffect(() => {
    const savedTheme = localStorage.getItem('vite-ui-theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={basePath}><RouteShell /></WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
