import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type HistoryAction = {
  id: string;
  actorRole: string;
  capability: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
};

export default function AdminPlanned({ title }: { title: string }) {
  const { getToken } = useAuth();
  const [actions, setActions] = useState<HistoryAction[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getToken().then(token => fetch('/api/admin/history?limit=100', {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })).then(async response => {
      const body = await response.json().catch(() => ({})) as { actions?: HistoryAction[]; error?: string };
      if (!response.ok) throw new Error(body.error || `History request failed (${response.status}).`);
      if (!cancelled) setActions(body.actions ?? []);
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'History could not be loaded.');
    });
    return () => { cancelled = true; };
  }, [getToken]);

  return (
    <main className="mx-auto max-w-6xl p-5 lg:p-8">
      <Card>
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900">{error}</p>}
          {!actions && !error ? (
            <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : actions?.length ? (
            <ol className="divide-y">
              {actions.map(item => (
                <li key={item.id} className="grid gap-1 py-3 text-sm md:grid-cols-[180px_1fr_240px]">
                  <time className="text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</time>
                  <span><b>{item.action}</b><span className="ml-2 text-muted-foreground">{item.actorRole} · {item.capability}</span></span>
                  <span className="truncate text-muted-foreground">{item.targetType ? `${item.targetType}: ${item.targetId ?? 'unspecified'}` : 'No target recorded'}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">No administrator actions have been recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}