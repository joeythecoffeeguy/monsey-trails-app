import { useRef, useState, type FormEvent } from 'react';
import { SignIn, useAuth, useSession, useSignIn } from '@clerk/react';
import { Redirect, useLocation } from 'wouter';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';
import { DriverSupport } from './driver-support';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const accessMessage = 'This account has not been provisioned for driver access. Contact an administrator.';

// Suppress social options throughout the driver verification flow.
const driverAppearance = {
  elements: {
    socialButtons: { display: 'none' },
    socialButtonsBlockButton: { display: 'none' },
    socialButtonsIconButton: { display: 'none' },
    dividerRow: { display: 'none' },
    footerAction: { display: 'none' },
  },
};

function describeError(error: unknown): { message: string; denied: boolean } {
  const value = error as { code?: string; message?: string; errors?: { code?: string }[] };
  const code = value?.errors?.[0]?.code ?? value?.code ?? '';
  if (['form_identifier_not_found', 'identifier_not_found', 'user_banned', 'user_locked'].includes(code)) {
    return { message: accessMessage, denied: true };
  }
  if (code === 'form_password_incorrect') {
    return { message: 'Incorrect password. Please try again.', denied: false };
  }
  if (code === 'form_identifier_invalid' || code === 'form_param_format_invalid') {
    return { message: 'Username sign-in is not available for this account. Please call for help.', denied: false };
  }
  if (code.includes('rate_limit') || code === 'too_many_requests') {
    return { message: 'Too many attempts. Please wait a moment before trying again.', denied: false };
  }
  return { message: 'Could not sign in. Check your connection and try again. If this continues, please call for help.', denied: false };
}

export function DriverLoginForm() {
  const { signIn, fetchStatus } = useSignIn();
  const { isLoaded, isSignedIn } = useAuth();
  const { session } = useSession();
  const [location] = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'username' | 'password' | 'verification'>('username');
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const inFlight = useRef(false);
  const disabled = busy || fetchStatus === 'fetching' || !isLoaded;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || disabled) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (step === 'username') {
        // Clerk handles identifier lookup and throttling. Never create a public user-directory API.
        const { error: failure } = await signIn.create({ identifier: username.trim(), signUpIfMissing: false });
        if (failure) throw failure;
        if (!signIn.supportedFirstFactors.some((factor) => factor.strategy === 'password')) {
          setError({ message: 'A password has not been set up for this account. Please call for help.', denied: false });
          return;
        }
        setStep('password');
      } else {
        const { error: failure } = await signIn.password({ password });
        if (failure) throw failure;
        setPassword('');
        if (signIn.status === 'complete') {
          const { error: finalError } = await signIn.finalize({
            navigate: ({ session, decorateUrl }) => {
              if (session?.currentTask) {
                setStep('verification');
                return;
              }
              window.location.assign(decorateUrl(appUrl(APP_ROUTES.drivers)));
            },
          });
          if (finalError) throw finalError;
        } else {
          // Preserve Clerk's MFA, new-device checks, and required password resets.
          setStep('verification');
        }
      }
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function startOver() {
    if (inFlight.current) return;
    setPassword('');
    setShowPassword(false);
    setError(null);
    setStep('username');
    await signIn.reset();
  }

  // Clerk owns these steps. Restore them from its resource and URL after a
  // refresh, rather than resetting a valid password attempt to username entry.
  const needsVerification = step === 'verification'
    || /^\/sign-in\/[^/]/.test(location)
    || ['needs_second_factor', 'needs_new_password', 'needs_client_trust'].includes(signIn.status ?? '')
    || Boolean(session?.currentTask);
  if (needsVerification) {
    // Clerk's base route renders SignInStart, even with a pending headless
    // attempt. Select its continuation route before mounting the prebuilt UI.
    // Preserve existing deep links so Clerk can own navigation within the flow.
    const verificationRoutes: Partial<Record<string, string>> = {
      needs_second_factor: '/sign-in/factor-two',
      needs_client_trust: '/sign-in/client-trust',
      needs_new_password: '/sign-in/reset-password',
    };
    const verificationRoute = verificationRoutes[signIn.status ?? ''];
    if (verificationRoute && /^\/sign-in\/?$/.test(location)) {
      return <Redirect to={verificationRoute} />;
    }
    return (
      <div className="w-full max-w-[380px] text-center bg-card border border-border rounded-[8px] p-6 shadow-sm">
        <SignIn routing="path" path={`${basePath}/sign-in`} forceRedirectUrl={appUrl(APP_ROUTES.drivers)} appearance={driverAppearance} />
        <DriverSupport />
      </div>
    );
  }
  if (isSignedIn) return <Redirect to={APP_ROUTES.drivers} />;

  return (
    <section className="w-full max-w-[380px] rounded-[8px] border border-border bg-card p-6 shadow-sm">
      <h2 className="text-xl font-bold tracking-tight text-foreground">
        {step === 'username' ? 'Sign in' : 'Enter your password'}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {step === 'username' ? 'Driver access' : 'Enter your password to continue'}
      </p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="driver-username" className="block text-[13px] font-semibold text-foreground">Username</label>
          <input id="driver-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
            required maxLength={32} pattern="[A-Za-z0-9_.\-]{3,32}" title="Use your assigned username: 3–32 letters, numbers, periods, underscores, or hyphens."
            value={username} readOnly={step === 'password'} disabled={disabled}
            onChange={(event) => { setUsername(event.target.value); setError(null); }}
            className="h-12 w-full rounded-[6px] border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary read-only:bg-muted read-only:text-muted-foreground transition-shadow" />
        </div>
        {step === 'password' && (
          <div className="space-y-1.5">
            <label htmlFor="driver-password" className="block text-[13px] font-semibold text-foreground">Password</label>
            <div className="relative">
              <input id="driver-password" name="password" autoComplete="current-password" autoFocus required
                type={showPassword ? 'text' : 'password'} value={password} disabled={disabled}
                onChange={(event) => { setPassword(event.target.value); setError(null); }}
                className="h-12 w-full rounded-[6px] border border-input bg-background pl-3 pr-10 text-base text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-shadow" />
              <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)} className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-muted-foreground hover:text-foreground">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
        )}
        {error && (
          <div role="alert" className="rounded-[6px] border border-amber-200 bg-amber-50 p-3 text-sm leading-snug text-amber-900">
            {error.denied && <h3 className="mb-1.5 flex items-center gap-1.5 font-bold"><AlertCircle size={16} />Driver access unavailable</h3>}
            <p>{error.message}</p>
            {error.denied && <p className="mt-1.5">Use your administrator-issued driver account. If this is that account, ask your administrator to confirm its access.</p>}
          </div>
        )}
        <button type="submit" disabled={disabled || !username.trim() || (step === 'password' && !password)}
          className="h-12 mt-2 w-full rounded-[6px] bg-primary px-4 text-base font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 disabled:pointer-events-none transition-colors flex items-center justify-center">
          {disabled ? (
            <span className="flex items-center gap-2">
              <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/20 border-t-primary-foreground animate-spin" />
              {isLoaded ? 'Signing in...' : 'Loading...'}
            </span>
          ) : step === 'username' ? 'Next' : 'Sign in'}
        </button>
        {step === 'password' && (
          <div className="flex justify-center pt-2">
            <button type="button" disabled={disabled} onClick={() => void startOver()} className="text-[13px] font-medium text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-transparent hover:decoration-foreground transition-all">Use a different username</button>
          </div>
        )}
      </form>
      <DriverSupport />
    </section>
  );
}