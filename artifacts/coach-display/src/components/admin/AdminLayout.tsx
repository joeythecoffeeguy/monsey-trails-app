import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import {
  AlertTriangle,
  Bell,
  Bus,
  CalendarDays,
  ClipboardList,
  History,
  LayoutDashboard,
  MapPin,
  MessageSquareText,
  Monitor,
  Route,
  Users,
} from 'lucide-react';
import { APP_ROUTES } from '@/lib/app-routes';
import { getGetAdminAccessQueryKey, useGetAdminAccess } from '@workspace/api-client-react';

export type AdminRole = 'admin' | 'dispatcher' | 'content';

const todayInNewYork = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const DATE_STORAGE_KEY = 'admin-service-date';

function initialDate() {
  if (typeof localStorage === 'undefined') return todayInNewYork();
  const stored = localStorage.getItem(DATE_STORAGE_KEY);
  return stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) ? stored : todayInNewYork();
}

type AdminFilters = {
  serviceDate: string;
  setServiceDate: (date: string) => void;
};

const AdminFiltersContext = createContext<AdminFilters | null>(null);
const AdminRoleContext = createContext<AdminRole | null>(null);

export function useAdminFilters() {
  const value = useContext(AdminFiltersContext);
  if (!value) throw new Error('useAdminFilters must be used inside AdminLayout.');
  return value;
}

export function useAdminRole() {
  return useContext(AdminRoleContext);
}

export function adminRoleFromAccess(access: unknown): AdminRole | null {
  if (!access || typeof access !== 'object') return null;
  const role = (access as Record<string, unknown>).role;
  return role === 'admin' || role === 'dispatcher' || role === 'content' ? role : null;
}

const navItems = [
  { label: 'Today', href: APP_ROUTES.adminOverview, icon: LayoutDashboard, roles: ['admin', 'dispatcher', 'content'] },
  { label: 'Dispatch', href: APP_ROUTES.adminDispatch, icon: Route, roles: ['admin', 'dispatcher'] },
  { label: 'Operations', href: APP_ROUTES.adminOperations, icon: AlertTriangle, roles: ['admin', 'dispatcher'] },
  { label: 'Communications', href: APP_ROUTES.adminCommunications, icon: MessageSquareText, roles: ['admin', 'dispatcher', 'content'] },
  { label: 'Incidents', href: APP_ROUTES.adminIncidents, icon: ClipboardList, roles: ['admin', 'dispatcher'] },
  { label: 'Notifications', href: APP_ROUTES.adminNotifications, icon: Bell, roles: ['admin', 'dispatcher'] },
  { label: 'History', href: APP_ROUTES.adminHistory, icon: History, roles: ['admin'] },
  { label: 'Displays', href: APP_ROUTES.adminDisplay, icon: Monitor, roles: ['admin', 'dispatcher', 'content'] },
  { label: 'Stops', href: APP_ROUTES.adminStops, icon: MapPin, roles: ['admin', 'content'] },
  { label: 'Drivers', href: APP_ROUTES.admin, icon: Users, roles: ['admin'] },
] satisfies Array<{ label: string; href: string; icon: typeof Bus; roles: AdminRole[] }>;

export function adminNavDestinations(role: AdminRole) {
  return navItems.filter(item => (item.roles as readonly AdminRole[]).includes(role)).map(item => item.href);
}

function isCurrentRoute(location: string, href: string) {
  return href === APP_ROUTES.admin ? location === href : location === href || location.startsWith(`${href}/`);
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { userId } = useAuth();
  const { data: access } = useGetAdminAccess({
    query: {
      queryKey: [...getGetAdminAccessQueryKey(), userId, 'admin-shell'],
      enabled: Boolean(userId),
      staleTime: 30_000,
      refetchInterval: 60_000,
    },
  });
  const roles = useMemo(() => {
    const role = adminRoleFromAccess(access);
    return role ? [role] : [];
  }, [access]);
  const role = roles[0] ?? null;
  const [serviceDate, setDate] = useState(initialDate);
  const visibleNav = navItems.filter(item => item.roles.some(itemRole => roles.includes(itemRole)));
  const active = navItems.find(item => isCurrentRoute(location, item.href));

  const setServiceDate = (date: string) => {
    setDate(date);
    localStorage.setItem(DATE_STORAGE_KEY, date);
  };

  return (
    <AdminRoleContext.Provider value={role}>
    <AdminFiltersContext.Provider value={{ serviceDate, setServiceDate }}>
      <div className="min-h-[100dvh] bg-slate-50 text-slate-950 dark:bg-slate-950 dark:text-slate-50">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="flex min-h-16 items-center justify-between gap-4 px-4 lg:px-6">
            <Link href={APP_ROUTES.adminOverview} className="flex items-center gap-3" aria-label="Monsey Trails administration overview">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Bus className="h-5 w-5" /></span>
              <span>
                <span className="block text-sm font-black leading-none">Monsey Trails</span>
                <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Operations desk</span>
              </span>
            </Link>
            <label className="flex items-center gap-2 text-sm font-bold">
              <CalendarDays className="h-4 w-4 text-primary" />
              <span className="hidden sm:inline">Service date</span>
              <input
                aria-label="Service date"
                type="date"
                value={serviceDate}
                onChange={event => setServiceDate(event.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              />
            </label>
          </div>
        </header>
        <div className="lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
          <aside className="border-b bg-slate-900 text-slate-200 lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:border-b-0 lg:border-r lg:border-slate-800">
            <nav aria-label="Administrator navigation" className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:p-3">
              {visibleNav.map(item => {
                const Icon = item.icon;
                const current = isCurrentRoute(location, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors ${
                      current ? 'bg-primary text-primary-foreground shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="h-4 w-4" />{item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
          <div className="min-w-0">
            {active && (
              <div className="border-b bg-white px-5 py-3 dark:bg-slate-950 lg:px-8">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Administration</p>
                <h1 className="text-xl font-black">{active.label}</h1>
              </div>
            )}
            {children}
          </div>
        </div>
      </div>
    </AdminFiltersContext.Provider>
    </AdminRoleContext.Provider>
  );
}