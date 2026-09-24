import { useState } from 'react';
import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import { Redirect } from 'wouter';
import { AlertTriangle, Bell, CheckCircle2, Loader2, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';
import {
  adminNotificationSupport,
  getAdminNotificationHealth,
  registerCurrentAdminBrowser,
  sendCurrentAdminBrowserTest,
} from '@/lib/admin-notifications';

function timestamp(value: string | null) {
  if (!value) return 'No attempt recorded';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unavailable';
}

export default function AdminNotifications() {
  const { isLoaded, userId } = useAuth();
  const [action, setAction] = useState<'register' | 'test' | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [support, setSupport] = useState(adminNotificationSupport);
  const health = useQuery({
    queryKey: ['admin-notification-health', userId],
    queryFn: getAdminNotificationHealth,
    enabled: Boolean(userId),
    refetchInterval: 30_000,
  });

  if (!isLoaded) return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!userId) return <Redirect to={`${appUrl('/sign-in')}?redirect_url=${encodeURIComponent(appUrl(APP_ROUTES.adminNotifications))}`} />;

  const run = async (kind: 'register' | 'test') => {
    setAction(kind);
    setMessage(null);
    try {
      if (kind === 'register') {
        await registerCurrentAdminBrowser();
        setSupport(adminNotificationSupport());
        setMessage({ kind: 'success', text: 'This browser is registered to your administrator account.' });
      } else {
        const result = await sendCurrentAdminBrowserTest();
        setMessage({ kind: 'success', text: result.message });
      }
      await health.refetch();
    } catch (error) {
      setSupport(adminNotificationSupport());
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'The notification action failed.' });
    } finally {
      setAction(null);
    }
  };

  return (
    <div className="text-foreground">
      <main className="mx-auto max-w-7xl space-y-5 px-5 py-6">
        {health.isLoading && <Card><CardContent className="flex min-h-40 items-center justify-center gap-2"><Loader2 className="animate-spin" />Loading notification health…</CardContent></Card>}
        {health.isError && <Card className="border-red-300"><CardContent className="p-6 text-red-800"><AlertTriangle className="mb-2" /><p className="font-bold">Notification health could not be loaded.</p><p className="text-sm">{health.error instanceof Error ? health.error.message : 'Try again.'}</p></CardContent></Card>}
        {health.data && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Notification summary">
              {[
                ['Passenger alerts', health.data.passengerAlerts.total, `${health.data.passengerAlerts.pending} pending`],
                ['Departure reminders', health.data.departureReminders.total, `${health.data.departureReminders.active} active`],
                ['Failures', health.data.passengerAlerts.failures + health.data.departureReminders.failures + health.data.adminTestDevices.failures, 'Recorded attempts'],
                ['Invalid devices', health.data.departureReminders.invalidDevices + health.data.adminTestDevices.invalid, 'Provider-rejected subscriptions'],
              ].map(([label, value, note]) => <Card key={label}><CardContent className="p-4"><p className="text-xs font-bold uppercase text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-black">{value}</p><p className="text-xs text-muted-foreground">{note}</p></CardContent></Card>)}
            </section>
            <Card>
              <CardHeader className="flex-row items-start justify-between"><div><CardTitle>Provider attempts</CardTitle><p className="mt-1 text-sm text-muted-foreground">{health.data.semantics}</p></div><Button variant="outline" size="sm" onClick={() => void health.refetch()}><RefreshCw className={`mr-2 h-4 w-4 ${health.isFetching ? 'animate-spin' : ''}`} />Refresh</Button></CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border p-4"><p className="font-bold">Stop alerts</p><p className="text-2xl font-black">{health.data.passengerAlerts.accepted} accepted</p><p className="text-xs text-muted-foreground">{timestamp(health.data.passengerAlerts.lastAttemptAt)}</p></div>
                <div className="rounded-lg border p-4"><p className="font-bold">Departure reminders</p><p className="text-2xl font-black">{health.data.departureReminders.accepted} accepted</p><p className="text-xs text-muted-foreground">{timestamp(health.data.departureReminders.lastAttemptAt)}</p></div>
                <div className="rounded-lg border p-4"><p className="font-bold">Web stop subscriptions</p><p className="text-2xl font-black">{health.data.webStopSubscriptions}</p><p className="text-xs text-muted-foreground">Aggregate registrations only</p></div>
              </CardContent>
            </Card>
            <Card className={health.data.background.ready ? 'border-green-300' : 'border-amber-300'}>
              <CardContent className="flex gap-3 p-5">{health.data.background.ready ? <CheckCircle2 className="text-green-600" /> : <AlertTriangle className="text-amber-600" />}<div><p className="font-black">Background processing {health.data.background.ready ? 'configured' : 'not confirmed'}</p><p className="text-sm text-muted-foreground">{health.data.background.detail}</p></div></CardContent>
            </Card>
          </>
        )}
        <Card>
          <CardHeader><CardTitle>Test this administrator browser</CardTitle><p className="text-sm text-muted-foreground">Registration requires your browser permission gesture and is bound to your current administrator identity. Passenger device IDs are never accepted.</p></CardHeader>
          <CardContent className="space-y-4">
            {(support.state === 'unsupported' || support.state === 'denied') && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-900">{support.detail}</div>}
            {message && <div role="status" className={`rounded-lg border p-3 text-sm font-bold ${message.kind === 'error' ? 'border-red-300 bg-red-50 text-red-900' : 'border-green-300 bg-green-50 text-green-900'}`}>{message.text}</div>}
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => void run('register')} disabled={action !== null || support.state === 'unsupported' || support.state === 'denied'}><Bell className="mr-2 h-4 w-4" />{action === 'register' ? 'Registering…' : 'Allow and register this browser'}</Button>
              <Button variant="outline" onClick={() => void run('test')} disabled={action !== null || support.state !== 'granted'}><Send className="mr-2 h-4 w-4" />{action === 'test' ? 'Requesting…' : 'Send test to this browser'}</Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}