import { SignIn } from '@clerk/react';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';
import { DriverLoginForm } from '@/components/driver-login-form';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

const adminAppearance = {
  elements: {
    rootBox: { width: '100%', minWidth: 0 },
    cardBox: { width: '100%', maxWidth: '380px' },
    socialButtons: { display: 'none' },
    socialButtonsBlockButton: { display: 'none' },
    socialButtonsIconButton: { display: 'none' },
    dividerRow: { display: 'none' },
    footerAction: { display: 'none' },
  },
};

export function isAdminSignInRequest() {
  const redirectUrl = new URLSearchParams(window.location.search).get('redirect_url');
  return redirectUrl === appUrl(APP_ROUTES.admin)
    || redirectUrl === appUrl('/admin/drivers')
    || redirectUrl === appUrl(APP_ROUTES.adminDisplay);
}

function isAdminDisplaySignInRequest() {
  return new URLSearchParams(window.location.search).get('redirect_url') === appUrl(APP_ROUTES.adminDisplay);
}

export function getAdminSignInRedirect() {
  const redirectUrl = new URLSearchParams(window.location.search).get('redirect_url');
  return redirectUrl === appUrl(APP_ROUTES.adminDisplay)
    ? redirectUrl
    : appUrl(APP_ROUTES.admin);
}

export function getSignInLocalization() {
  return isAdminSignInRequest()
    ? {
        signIn: {
          start: {
            title: isAdminDisplaySignInRequest() ? 'Continue to view current trips' : 'Continue to manage drivers',
            titleCombined: isAdminDisplaySignInRequest() ? 'Continue to view current trips' : 'Continue to manage drivers',
            subtitle: 'Sign in with your administrator account',
            subtitleCombined: 'Sign in with your administrator account',
          },
        },
      }
    : {
        signIn: {
          start: {
            title: 'Driver Login',
            subtitle: 'Sign in to access your coach console',
          },
        },
        signUp: {
          start: {
            title: 'Driver Account',
            subtitle: 'Accounts are assigned by an administrator',
          },
        },
      };
}

export default function DriverSignIn() {
  // Keep Clerk's password and verification flow, without social sign-in options.
  const adminLogin = isAdminSignInRequest();
  const adminDisplayLogin = isAdminDisplaySignInRequest();
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background font-sans antialiased">
      <header className="h-[60px] bg-secondary w-full flex items-center px-6 shadow-sm shrink-0">
        <h1 className="sr-only">Driver App</h1>
        <img src={`${basePath}/monsey-trails-logo.png`} alt="Monsey Trails" className="h-8 max-w-full object-contain brightness-0 invert" />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4">
        {adminLogin && (
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-bold text-foreground">Administrator sign-in</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {adminDisplayLogin ? 'Sign in to view current trips on this display.' : 'Sign in to manage driver accounts.'}
            </p>
          </div>
        )}

        {adminLogin
          ? (
            <div className="w-full max-w-[380px] min-w-0">
            <SignIn routing="path" path={`${basePath}/sign-in`} forceRedirectUrl={getAdminSignInRedirect()} appearance={adminAppearance} />
            </div>
          )
          : <DriverLoginForm />}

        <nav aria-label="App links" className="mt-8 flex flex-wrap justify-center gap-6 text-[13px] font-medium text-muted-foreground">
          <a href={appUrl(APP_ROUTES.passengers)} className="hover:text-foreground transition-colors">Passenger schedules — no login</a>
          <a href={appUrl(APP_ROUTES.busDisplay)} className="hover:text-foreground transition-colors">Bus-mounted display</a>
          <a href={appUrl(APP_ROUTES.admin)} className="hover:text-foreground transition-colors">Admin — driver management</a>
        </nav>
      </main>
    </div>
  );
}