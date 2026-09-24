import { useState, useEffect } from 'react';
import { useAuth, useClerk, useUser } from '@clerk/react';
import { Redirect, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  useGetAdminAccess,
  useListAdminDrivers,
  createAdminDriver,
  disableAdminDriver,
  enableAdminDriver,
  deleteAdminDriver,
  resetAdminDriverAccess,
  getListAdminDriversQueryKey,
  getGetAdminAccessQueryKey,
  useListAdminRoleUsers,
  useListAdminHistory,
  updateAdminRole,
  getListAdminRoleUsersQueryKey,
  getListAdminHistoryQueryKey,
} from '@workspace/api-client-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, ShieldAlert, Key, UserX, UserCheck, Eye, EyeOff, Check, Plus, Trash2, LogOut, RefreshCw, CalendarClock, MapPin, History, Shield } from 'lucide-react';
import type { AdminAccessError, AdminDriver, ErrorType } from '@workspace/api-client-react';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';
import { clearOperatorSession } from '@/providers/live-trip';
import { releaseDriverCoaches } from '@/providers/driver-profile';
import { classifyClerkEnvironment } from '@/lib/clerk-environment';

const createDriverSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(256),
  lastName: z.string().trim().min(1, 'Last name is required').max(256),
  username: z.string().min(3, 'Username must be at least 3 characters').max(32).regex(/^[A-Za-z0-9_.-]+$/, 'Letters, numbers, _, ., and - only'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(256),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
});

const resetPasswordSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(256),
});

type AdminDenialCode = AdminAccessError['code'] | 'UNKNOWN';

function adminDenialCode(error: unknown): AdminDenialCode {
  const data = (error as ErrorType<AdminAccessError> | null)?.data;
  return data && typeof data === 'object' && typeof data.code === 'string'
    ? data.code as AdminDenialCode
    : 'UNKNOWN';
}

const denialGuidance: Record<AdminDenialCode, { title: string; message: string }> = {
  ACCOUNT_RESTRICTED: {
    title: 'Account restricted',
    message: 'This signed-in account is restricted. Contact system support to restore account access, then retry.',
  },
  ADMIN_SESSION_INVALID: {
    title: 'Session needs refreshing',
    message: 'This sign-in session has expired or no longer matches this account. Sign out, then sign in again with the intended administrator account.',
  },
  AUTH_REQUIRED: {
    title: 'Session needs refreshing',
    message: 'The server could not confirm this sign-in session. Sign out, then sign in again with the intended administrator account.',
  },
  ADMIN_ACCESS_REQUIRED: {
    title: 'Administrator role required',
    message: 'This account does not have the required administrator role in this environment. Confirm the intended account and environment, or contact system support.',
  },
  UNTRUSTED_ORIGIN: {
    title: 'Open the official app',
    message: 'This request did not come from a trusted app origin. Open the administrator page from the official app address, then retry.',
  },
  ADMIN_ACCESS_UNAVAILABLE: {
    title: 'Access check unavailable',
    message: 'Administrator access could not be verified right now. Retry access in a moment.',
  },
  ADMIN_CAPABILITY_REQUIRED: {
    title: 'Additional permission required',
    message: 'Your administrator role does not include permission for this action.',
  },
  ADMIN_POLICY_REQUIRED: {
    title: 'Administrator policy required',
    message: 'This administration request is not covered by an access policy. Contact system support.',
  },
  UNKNOWN: {
    title: 'Access could not be confirmed',
    message: 'The server denied this request without a recognized reason. Retry access or sign in with a different account.',
  },
};

export default function AdminDrivers() {
  const { isLoaded, userId } = useAuth();
  const { user } = useUser();
  
  if (!isLoaded) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!userId) {
    const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
    const returnUrl = encodeURIComponent(`${basePath}${APP_ROUTES.admin}`);
    return <Redirect to={`/sign-in?redirect_url=${returnUrl}`} />;
  }

  return <AdminDriversContent key={userId} userId={userId} username={user?.username ?? null} />;
}

function AdminDriversContent({ userId, username }: { userId: string; username: string | null }) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [createdDriver, setCreatedDriver] = useState<AdminDriver | null>(null);

  useEffect(() => {
    return () => {
      // Clear admin caches on unmount
      queryClient.removeQueries({ queryKey: getGetAdminAccessQueryKey() });
      queryClient.removeQueries({ queryKey: getListAdminDriversQueryKey() });
    };
  }, [queryClient]);

  const { data: access, isLoading: accessLoading, error: accessError, isError: isAccessError, refetch: refetchAccess } = useGetAdminAccess({
    query: {
      queryKey: [...getGetAdminAccessQueryKey(), userId],
      retry: (failureCount, error: ErrorType) => {
        if (error.status === 401 || error.status === 403) return false;
        return failureCount < 3;
      },
      staleTime: 0,
      gcTime: 0,
      refetchInterval: 60000,
    }
  });

  if (accessLoading && !access) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const isDenied = isAccessError && accessError && (accessError as ErrorType).status === 403;
  const isUnauthorized = isAccessError && accessError && (accessError as ErrorType).status === 401;
  const isOtherError = isAccessError && !isDenied && !isUnauthorized;

  if (isOtherError) {
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
        <header className="bg-card text-card-foreground border-b border-border px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/operator" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-black tracking-tight text-foreground">Admin Management</h1>
            <Link href={APP_ROUTES.adminDispatch} className="ml-3 text-sm font-bold text-primary hover:underline">
              Dispatch board
            </Link>
          </div>
          <AdminLogoutButton />
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="w-full max-w-md border-border bg-card text-card-foreground shadow-sm">
            <CardHeader className="bg-orange-50 text-orange-900 rounded-t-xl border-b border-orange-100">
              <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Service Unavailable</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 flex flex-col gap-4">
              <p className="text-sm font-medium text-orange-800">
                The administration service is currently unavailable or there is a network issue.
              </p>
              <Button onClick={() => refetchAccess()} variant="outline" className="w-full">
                Retry Connection
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isDenied || isUnauthorized || (access && !access.authorized)) {
    const code = adminDenialCode(accessError);
    const guidance = denialGuidance[code] ?? denialGuidance.UNKNOWN;
    return (
      <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
        <header className="bg-card text-card-foreground border-b border-border px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/operator" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-xl font-black tracking-tight text-foreground">Admin Management</h1>
          </div>
          <AdminLogoutButton skipCoachRelease label="Sign out / change account" />
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="w-full max-w-md border-red-200 shadow-sm">
            <CardHeader className="bg-red-50 text-red-900 rounded-t-xl border-b border-red-100">
              <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> {guidance.title}</CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <p className="text-sm font-medium text-red-800">{guidance.message}</p>
              <dl className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Signed in as</dt>
                  <dd className="font-semibold text-foreground" data-testid="admin-current-username">
                    {username ?? 'Username unavailable'}
                  </dd>
                </div>
                <div className="mt-2 flex justify-between gap-4">
                  <dt className="text-muted-foreground">Environment</dt>
                  <dd className="font-semibold text-foreground" data-testid="admin-environment">
                    {classifyClerkEnvironment(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY)}
                  </dd>
                </div>
              </dl>
              <Button onClick={() => void refetchAccess()} variant="outline" className="w-full" data-testid="button-retry-admin-access">
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry access
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (access?.role === 'dispatcher') {
    return <Redirect to={APP_ROUTES.adminDispatch} />;
  }
  if (access?.role === 'content') {
    return <Redirect to={APP_ROUTES.adminStops} />;
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="bg-card text-card-foreground border-b border-border px-6 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <Link href="/operator" className="text-muted-foreground hover:text-foreground transition-colors bg-muted p-2 rounded-full hover:bg-muted/80">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="sr-only">Driver access administration</span>
        </div>
        <div className="flex items-center gap-2">
          <AdminLogoutButton />
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        <Link
          href={APP_ROUTES.adminDispatch}
          className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/10 p-4 transition-colors hover:bg-primary/15"
        >
          <div>
            <p className="font-black text-foreground">Schedule &amp; Dispatch</p>
            <p className="text-sm text-muted-foreground">Assign a published Monsey Trails departure, driver, and coach.</p>
          </div>
          <span className="shrink-0 text-sm font-black text-primary">Open board →</span>
        </Link>
        <DriversList
          userId={userId}
          createdDriver={createdDriver}
          onAddDriver={() => setCreateOpen(true)}
          onCreatedDriverSeen={(id) => {
            setCreatedDriver((current) => current?.id === id ? null : current);
          }}
        />
        {access?.role === 'admin' && <AdminRolesAndHistory currentUserId={userId} />}
      </main>
      <CreateDriverForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={setCreatedDriver}
      />
    </div>
  );
}

function AdminRolesAndHistory({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [savingId, setSavingId] = useState<string | null>(null);
  const roles = useListAdminRoleUsers({
    query: { queryKey: getListAdminRoleUsersQueryKey(), staleTime: 0, refetchOnWindowFocus: true },
  });
  const history = useListAdminHistory(
    { limit: 25 },
    { query: { queryKey: getListAdminHistoryQueryKey({ limit: 25 }), refetchInterval: 30_000, refetchOnWindowFocus: true } },
  );

  async function changeRole(id: string, role: 'admin' | 'dispatcher' | 'content') {
    setSavingId(id);
    try {
      await updateAdminRole(id, { role });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAdminRoleUsersQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListAdminHistoryQueryKey({ limit: 25 }) }),
      ]);
      toast({ title: 'Role updated', description: 'The account sessions were revoked so the new permissions apply immediately.' });
    } catch (error) {
      const response = error as ErrorType<{ error?: string }>;
      toast({
        title: 'Role was not changed',
        description: response.data?.error ?? 'The server could not safely change this role.',
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="mt-8 grid gap-5 lg:grid-cols-2" aria-label="Administrator roles and history">
      <Card className="border-border bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" /> Administrator roles</CardTitle>
          <p className="text-sm text-muted-foreground">Only full administrators can change roles. The final unrestricted administrator cannot be demoted.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {roles.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          {roles.isError && <p className="text-sm text-destructive">Roles could not be loaded.</p>}
          {roles.data?.users.map(account => (
            <div key={account.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-bold">{account.displayName}{account.id === currentUserId ? ' (you)' : ''}</p>
                <p className="truncate text-xs text-muted-foreground">{account.username ?? account.id}{account.restricted ? ' · restricted' : ''}</p>
              </div>
              <select
                aria-label={`Role for ${account.displayName}`}
                value={account.role}
                disabled={savingId !== null || account.restricted}
                onChange={event => void changeRole(account.id, event.target.value as 'admin' | 'dispatcher' | 'content')}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm font-semibold"
              >
                <option value="admin">Full admin</option>
                <option value="dispatcher">Dispatcher</option>
                <option value="content">Content</option>
              </select>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="border-border bg-card text-card-foreground shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" /> Safe action history</CardTitle>
          <p className="text-sm text-muted-foreground">Recent successful administrator changes. Credentials, tokens, pairing codes, and device details are never recorded.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          {history.isError && <p className="text-sm text-destructive">History could not be loaded.</p>}
          {history.data?.health.status === 'degraded' && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">
              Action recording is degraded. {history.data.health.consecutiveFailures} recent audit write
              {history.data.health.consecutiveFailures === 1 ? '' : 's'} failed
              {history.data.health.lastFailureAt
                ? `; last failure ${new Date(history.data.health.lastFailureAt).toLocaleString()}.`
                : '.'}
            </div>
          )}
          {history.data?.health.status === 'unknown' && (
            <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
              Action recording has not yet been verified in this server process. Treat this list as potentially incomplete.
            </div>
          )}
          {history.data?.actions.length === 0 && <p className="text-sm text-muted-foreground">No recorded changes yet.</p>}
          {history.data?.actions.map(action => (
            <div key={action.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="font-mono text-xs font-bold">{action.action}</p>
                <time className="shrink-0 text-xs text-muted-foreground" dateTime={action.createdAt}>
                  {new Date(action.createdAt).toLocaleString()}
                </time>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{action.actorRole} · {action.actorSubject}</p>
              {(action.before || action.after) && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {action.before ? `Before: ${JSON.stringify(action.before)}` : ''}
                  {action.before && action.after ? ' · ' : ''}
                  {action.after ? `After: ${JSON.stringify(action.after)}` : ''}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function AdminLogoutButton({
  skipCoachRelease = false,
  label = 'Log out',
}: {
  skipCoachRelease?: boolean;
  label?: string;
} = {}) {
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      // This endpoint releases only rows owned by the current Clerk subject.
      if (!skipCoachRelease) await releaseDriverCoaches();
      clearOperatorSession();
      window.dispatchEvent(new CustomEvent('driver-account-changed'));
      queryClient.removeQueries({ queryKey: getGetAdminAccessQueryKey() });
      queryClient.removeQueries({ queryKey: getListAdminDriversQueryKey() });
      const adminReturnUrl = `${appUrl('/sign-in')}?redirect_url=${encodeURIComponent(appUrl(APP_ROUTES.admin))}`;
      await signOut({ redirectUrl: adminReturnUrl });
    } catch (error) {
      toast({
        title: 'Log out failed',
        description: error instanceof Error ? error.message : 'Could not log out. Please try again.',
        variant: 'destructive',
      });
      setIsSigningOut(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void handleSignOut()}
      disabled={isSigningOut}
      className="shrink-0 font-bold text-foreground"
      data-testid="button-admin-logout"
    >
      {isSigningOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  );
}

function CreateDriverForm({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (driver: AdminDriver) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<z.infer<typeof createDriverSchema>>({
    resolver: zodResolver(createDriverSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      username: '',
      password: '',
      email: '',
    },
  });

  useEffect(() => {
    if (!open) {
      form.reset();
      setShowPassword(false);
    }
    return () => {
      // Clear password on unmount
      form.resetField('password');
    };
  }, [form, open]);

  async function onSubmit(values: z.infer<typeof createDriverSchema>) {
    setIsSubmitting(true);
    try {
      // Using imperative function to avoid TanStack Query caching the mutation variables (password)
      const response = await createAdminDriver({
        firstName: values.firstName,
        lastName: values.lastName,
        username: values.username,
        password: values.password,
        email: values.email || undefined,
      });
      
      toast({
        title: 'Driver created',
        description: `Successfully created account for ${values.username}.`,
      });
      
      onCreated(response.driver);
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: getListAdminDriversQueryKey() });
    } catch (err) {
      const error = err as ErrorType<{ error: string }>;
      const msg = error.data && typeof error.data === 'object' && 'error' in error.data
        ? String(error.data.error)
        : err instanceof Error ? err.message : 'Could not create driver';
        
      toast({
        title: 'Creation failed',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
      // Ensure password doesn't linger in state after completion/error
      form.resetField('password', { defaultValue: '' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto border-border bg-card text-card-foreground sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-primary" /> Add Driver
          </DialogTitle>
          <DialogDescription>
            Provision a new driver account. First and last name are required by the current identity provider. The username and password must be shared with the driver manually.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-bold">First Name <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="John" {...field} className="border-border bg-background font-medium text-foreground focus-visible:ring-primary" data-testid="input-create-first-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-bold">Last Name <span className="text-red-500">*</span></FormLabel>
                    <FormControl>
                      <Input placeholder="Doe" {...field} className="border-border bg-background font-medium text-foreground focus-visible:ring-primary" data-testid="input-create-last-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-bold">Username <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <Input placeholder="johndoe" {...field} className="border-border bg-background font-medium text-foreground focus-visible:ring-primary" data-testid="input-create-username" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-bold">Email (Optional when enabled)</FormLabel>
                  <FormControl>
                    <Input placeholder="driver@monseytrails.com" type="email" {...field} className="border-border bg-background font-medium text-foreground focus-visible:ring-primary" data-testid="input-create-email" />
                  </FormControl>
                  <FormDescription className="text-xs">The current live identity provider has email disabled, so leave this blank. Other provider configurations may allow or require it.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-bold">Initial Password <span className="text-red-500">*</span></FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input 
                        type={showPassword ? "text" : "password"} 
                        placeholder="••••••••" 
                        {...field} 
                        className="border-border bg-background font-medium text-foreground focus-visible:ring-primary pr-10"
                        data-testid="input-create-password" 
                      />
                      <button 
                        type="button" 
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting} data-testid="button-cancel-create">
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="font-bold" data-testid="button-submit-create">
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Create Account
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DriversList({
  userId,
  createdDriver,
  onAddDriver,
  onCreatedDriverSeen,
}: {
  userId: string;
  createdDriver: AdminDriver | null;
  onAddDriver: () => void;
  onCreatedDriverSeen: (id: string) => void;
}) {
  const [offsets, setOffsets] = useState([0]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const offset = offsets[offsets.length - 1];
  
  const { data, isLoading, isError, error, isFetching } = useListAdminDrivers(
    { offset },
    {
      query: {
        queryKey: [...getListAdminDriversQueryKey({ offset }), userId],
        refetchInterval: 30000, // Periodic freshness
        refetchOnWindowFocus: true, // Focus freshness
      }
    }
  );

  useEffect(() => {
    if (createdDriver) {
      setOffsets([0]);
    }
  }, [createdDriver?.id]);

  useEffect(() => {
    if (createdDriver && data?.drivers.some((driver) => driver.id === createdDriver.id)) {
      onCreatedDriverSeen(createdDriver.id);
    }
  }, [createdDriver, data?.drivers, onCreatedDriverSeen]);

  if (isLoading && !data) {
    return (
      <Card className="shadow-sm border-border bg-card text-card-foreground min-h-[400px] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="shadow-sm border-red-200 bg-card text-card-foreground">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-red-400 mb-4" />
          <h3 className="text-lg font-bold text-red-900 mb-2">Failed to load drivers</h3>
          <p className="text-sm text-red-700 mb-4">
            {(() => {
              const err = error as ErrorType<{ error: string }>;
              return err?.data && typeof err.data === 'object' && 'error' in err.data
                ? String(err.data.error)
                : err instanceof Error ? err.message : 'An unknown error occurred.';
            })()}
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const drivers = data.drivers.filter((driver) => !deletedIds.has(driver.id));
  if (offset === 0 && createdDriver && !deletedIds.has(createdDriver.id) && !drivers.some((driver) => driver.id === createdDriver.id)) {
    drivers.unshift(createdDriver);
  }
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleDrivers = normalizedSearch
    ? drivers.filter((driver) => [
      driver.displayName,
      driver.firstName,
      driver.lastName,
      [driver.firstName, driver.lastName].filter(Boolean).join(' '),
      driver.username,
      driver.unitNumber,
    ].some(value => value?.toLocaleLowerCase().includes(normalizedSearch)))
    : drivers;

  const handleDeleted = (id: string) => {
    setDeletedIds((current) => new Set(current).add(id));
    if (drivers.length === 1 && offsets.length > 1) {
      setOffsets((current) => current.slice(0, -1));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          Directory
          {isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </h2>
        <div className="flex w-full gap-2 sm:w-auto">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, username, or unit"
            aria-label="Search drivers by name, username, or unit number"
            className="min-w-0 border-border bg-background text-foreground sm:w-72"
            data-testid="input-search-drivers"
          />
          <Button onClick={onAddDriver} className="shrink-0 font-bold" data-testid="button-add-driver">
            <Plus className="mr-2 h-4 w-4" /> Add Driver
          </Button>
        </div>
      </div>

      <div className="grid gap-3">
        {visibleDrivers.length === 0 && (
          <Card className="shadow-sm border-border bg-card text-card-foreground">
            <CardContent className="py-16 text-center">
              <h3 className="text-lg font-bold text-card-foreground mb-1">
                {normalizedSearch ? 'No matching drivers on this page' : 'No drivers on this page'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {normalizedSearch
                  ? 'Try another name, username, or unit number.'
                  : data.nextOffset !== null ? 'Continue to the next page to find more driver accounts.' : 'No more drivers found. You can go back or create a driver.'}
              </p>
            </CardContent>
          </Card>
        )}
        {visibleDrivers.map((driver) => (
          <DriverCard key={driver.id} driver={driver} onDeleted={handleDeleted} />
        ))}
      </div>

      <div className="flex items-center justify-between pt-4">
        <Button
          variant="outline"
          onClick={() => setOffsets(previous => previous.slice(0, -1))}
          disabled={offsets.length === 1 || isFetching}
          className="font-bold text-foreground"
        >
          Previous
        </Button>
        <span className="text-sm font-semibold text-muted-foreground">
          Page {offsets.length} · {drivers.length} drivers
        </span>
        <Button
          variant="outline"
          onClick={() => {
            if (data.nextOffset !== null) setOffsets(previous => [...previous, data.nextOffset!]);
          }}
          disabled={data.nextOffset === null || isFetching}
          className="font-bold text-foreground"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function DriverCard({ driver, onDeleted }: { driver: AdminDriver; onDeleted: (id: string) => void }) {
  const [resetOpen, setResetOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <Card className={`shadow-sm transition-all overflow-hidden border-border border-l-4 bg-card text-card-foreground ${driver.disabled ? 'border-l-red-500 opacity-75' : 'border-l-primary'}`} data-testid={`card-driver-${driver.id}`}>
        <div className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${driver.disabled ? 'bg-red-100 text-red-600' : 'bg-secondary/10 text-secondary'}`}>
              {driver.disabled ? <UserX className="h-5 w-5" /> : <UserCheck className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm sm:grid-cols-[auto_minmax(8rem,1fr)_auto_minmax(7rem,1fr)]">
                <dt className="font-bold text-muted-foreground">Name</dt>
                <dd className="truncate font-bold text-card-foreground" data-testid={`text-name-${driver.id}`}>
                  {driver.displayName || [driver.firstName, driver.lastName].filter(Boolean).join(' ') || 'Not provided'}
                </dd>
                <dt className="font-bold text-muted-foreground">Username</dt>
                <dd className="truncate font-semibold text-card-foreground" data-testid={`text-username-${driver.id}`}>
                  {driver.username || 'Not provided'}
                </dd>
                <dt className="font-bold text-muted-foreground">Unit number</dt>
                <dd className="truncate font-semibold text-card-foreground" data-testid={`text-unit-number-${driver.id}`}>
                  {driver.unitNumber || 'Unassigned'}
                </dd>
              </dl>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded" aria-label="Account ID">{driver.id}</span>
                {driver.disabled && (
                  <span className="text-xs font-bold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">DISABLED</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResetOpen(true)}
              className="font-bold shadow-sm"
              data-testid={`button-reset-${driver.id}`}
            >
              <Key className="mr-2 h-4 w-4" /> Reset Password
            </Button>
            <Button
              variant={driver.disabled ? "secondary" : "outline"}
              size="sm"
              onClick={() => setDisableOpen(true)}
              className="font-bold shadow-sm"
              data-testid={driver.disabled ? `button-enable-${driver.id}` : `button-disable-${driver.id}`}
            >
              {driver.disabled ? (
                <><UserCheck className="mr-2 h-4 w-4" /> Enable</>
              ) : (
                <><UserX className="mr-2 h-4 w-4" /> Disable</>
              )}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              className="font-bold shadow-sm"
              data-testid={`button-delete-${driver.id}`}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </Button>
          </div>
        </div>
      </Card>

      <ResetPasswordDialog driver={driver} open={resetOpen} onOpenChange={setResetOpen} />
      <ToggleDisableDialog driver={driver} open={disableOpen} onOpenChange={setDisableOpen} />
      <DeleteDriverDialog driver={driver} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={onDeleted} />
    </>
  );
}

function ResetPasswordDialog({ 
  driver, 
  open, 
  onOpenChange 
}: { 
  driver: AdminDriver;
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<z.infer<typeof resetPasswordSchema>>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '' },
  });

  useEffect(() => {
    if (!open) {
      form.reset({ password: '' });
      setShowPassword(false);
    }
  }, [open, form]);

  async function onSubmit(values: z.infer<typeof resetPasswordSchema>) {
    setIsSubmitting(true);
    try {
      await resetAdminDriverAccess(driver.id, { password: values.password });
      
      toast({
        title: 'Access reset',
        description: `Password updated for ${driver.username}. All active sessions have been revoked.${driver.disabled ? ' Account is now restored.' : ''}`,
      });
      
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: getListAdminDriversQueryKey() });
    } catch (err) {
      const error = err as ErrorType<{ error: string }>;
      const msg = error?.data && typeof error.data === 'object' && 'error' in error.data
        ? String(error.data.error)
        : err instanceof Error ? err.message : 'Could not reset password';
      toast({
        title: 'Reset failed',
        description: msg,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
      form.resetField('password', { defaultValue: '' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-card-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            This will change the password for <strong className="text-card-foreground">{driver.username}</strong>, revoke all their active sessions, and force them to sign in again.
            {driver.disabled && " This will also restore access to this disabled account."}
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-2">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-bold">New Password</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input 
                        type={showPassword ? "text" : "password"} 
                        placeholder="••••••••" 
                        {...field} 
                        className="font-medium pr-10" 
                        data-testid="input-reset-password"
                      />
                      <button 
                        type="button" 
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="button-submit-reset">
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Reset
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleDisableDialog({ 
  driver, 
  open, 
  onOpenChange 
}: { 
  driver: AdminDriver;
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onConfirm() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (driver.disabled) {
        await enableAdminDriver(driver.id);
        toast({
          title: 'Driver enabled',
          description: `${driver.username} can sign in again.`,
        });
      } else {
        await disableAdminDriver(driver.id);
        toast({
          title: 'Driver disabled',
          description: `${driver.username}'s access has been disabled. Active sessions are terminated.`,
        });
      }
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: getListAdminDriversQueryKey() });
    } catch (err) {
      const error = err as ErrorType<{ error: string }>;
      const msg = error?.data && typeof error.data === 'object' && 'error' in error.data
        ? String(error.data.error)
        : err instanceof Error ? err.message : 'Could not perform action';
      toast({
        title: 'Action failed',
        description: msg,
        variant: 'destructive',
      });
      void queryClient.invalidateQueries({ queryKey: getListAdminDriversQueryKey() });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card text-card-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{driver.disabled ? 'Enable Driver' : 'Disable Driver'}</DialogTitle>
          <DialogDescription className="pt-2">
            {driver.disabled ? (
              <span>Enable <strong className="text-card-foreground">{driver.username}</strong>? They will be able to sign in again with their current password.</span>
            ) : (
              <span>
                Are you sure you want to disable <strong className="text-card-foreground">{driver.username}</strong>?
                This will immediately sign them out and prevent any further access until their password is reset.
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        
        <DialogFooter className="pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={driver.disabled ? 'default' : 'destructive'}
            onClick={onConfirm}
            disabled={isSubmitting}
            data-testid={driver.disabled ? 'button-confirm-enable' : 'button-confirm-disable'}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {driver.disabled ? 'Enable Driver' : 'Yes, Disable Driver'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDriverDialog({
  driver,
  open,
  onOpenChange,
  onDeleted,
}: {
  driver: AdminDriver;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) setConfirmation('');
  }, [open]);

  async function onConfirm() {
    if (isSubmitting || confirmation !== driver.username) return;
    setIsSubmitting(true);
    try {
      await deleteAdminDriver(driver.id);
      onDeleted(driver.id);
      onOpenChange(false);
      toast({
        title: 'Driver deleted',
        description: `${driver.username} was permanently removed.`,
      });
      await queryClient.invalidateQueries({ queryKey: getListAdminDriversQueryKey() });
    } catch (err) {
      const error = err as ErrorType<{ error: string }>;
      const msg = error?.data && typeof error.data === 'object' && 'error' in error.data
        ? String(error.data.error)
        : err instanceof Error ? err.message : 'Could not delete this driver. Please try again.';
      toast({
        title: 'Delete failed',
        description: msg,
        variant: 'destructive',
      });
      void queryClient.invalidateQueries({ queryKey: getListAdminDriversQueryKey() });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DialogContent className="border-border bg-card text-card-foreground sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-red-700">Permanently delete driver?</DialogTitle>
          <DialogDescription className="space-y-3 pt-2">
            <span className="block">
              This permanently removes <strong className="text-card-foreground">{driver.username}</strong>&apos;s login and profile, signs them out, and ends any coach session they own. This cannot be undone.
            </span>
            <span className="block">Type <strong className="text-card-foreground">{driver.username}</strong> exactly to confirm.</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor={`delete-confirm-${driver.id}`}>Username</label>
          <Input
            id={`delete-confirm-${driver.id}`}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            disabled={isSubmitting}
            data-testid={`input-delete-confirmation-${driver.id}`}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting} data-testid="button-cancel-delete">
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isSubmitting || confirmation !== driver.username}
            data-testid="button-confirm-delete"
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Permanently Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}