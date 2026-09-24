import { useEffect } from 'react';
import { Link } from 'wouter';
import { APP_ROUTES } from '@/lib/app-routes';
import { 
  Bus, 
  Map, 
  Clock, 
  Star, 
  Bell, 
  Info,
  ChevronRight,
  ShieldAlert
} from 'lucide-react';

export default function AppMarketing() {
  useEffect(() => {
    document.title = 'Passenger App | Monsey Trails';
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute('content', 'Access published schedules, track live coaches, and manage your travel with the Monsey Trails Passenger App.');
    }

    let canonical = document.querySelector('link[rel="canonical"]');
    const previousCanonical = canonical?.getAttribute('href');
    let addedCanonical = false;
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
      addedCanonical = true;
    }
    canonical.setAttribute('href', 'https://coach-passenger-display.replit.app/welcome');

    let ogTitle = document.querySelector('meta[property="og:title"]');
    let ogDesc = document.querySelector('meta[property="og:description"]');
    const previousOgTitle = ogTitle?.getAttribute('content');
    const previousOgDesc = ogDesc?.getAttribute('content');
    let addedOgTitle = false;
    let addedOgDesc = false;

    if (!ogTitle) {
      ogTitle = document.createElement('meta');
      ogTitle.setAttribute('property', 'og:title');
      document.head.appendChild(ogTitle);
      addedOgTitle = true;
    }
    ogTitle.setAttribute('content', 'Passenger App | Monsey Trails');

    if (!ogDesc) {
      ogDesc = document.createElement('meta');
      ogDesc.setAttribute('property', 'og:description');
      document.head.appendChild(ogDesc);
      addedOgDesc = true;
    }
    ogDesc.setAttribute('content', 'Access published schedules, track live coaches, and manage your travel with the Monsey Trails Passenger App.');

    return () => {
      if (addedCanonical && canonical) document.head.removeChild(canonical);
      else if (canonical) {
        if (previousCanonical == null) canonical.removeAttribute('href');
        else canonical.setAttribute('href', previousCanonical);
      }
      if (addedOgTitle && ogTitle) document.head.removeChild(ogTitle);
      else if (ogTitle) {
        if (previousOgTitle == null) ogTitle.removeAttribute('content');
        else ogTitle.setAttribute('content', previousOgTitle);
      }
      if (addedOgDesc && ogDesc) document.head.removeChild(ogDesc);
      else if (ogDesc) {
        if (previousOgDesc == null) ogDesc.removeAttribute('content');
        else ogDesc.setAttribute('content', previousOgDesc);
      }
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-slate-50 font-sans text-slate-900 selection:bg-blue-100">
      <nav className="fixed top-0 inset-x-0 h-16 bg-white/80 backdrop-blur-md border-b border-slate-200 z-50">
        <div className="max-w-6xl mx-auto px-4 h-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-900 flex items-center justify-center text-white font-black text-sm tracking-tight">
              MT
            </div>
            <span className="font-bold text-lg tracking-tight text-blue-950">Monsey Trails</span>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium">
            <Link href={APP_ROUTES.appSupport} className="text-slate-600 hover:text-blue-900 transition-colors hidden sm:block">
              Support
            </Link>
            <Link href={APP_ROUTES.passengers} className="bg-blue-900 hover:bg-blue-800 text-white px-4 py-2 rounded-full transition-colors">
              View Schedules
            </Link>
          </div>
        </div>
      </nav>

      <main className="pt-16">
        <section className="relative overflow-hidden bg-blue-950 text-white px-4 py-24 sm:py-32 lg:py-40">
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-blue-400 via-transparent to-transparent" />
          
          <div className="max-w-4xl mx-auto relative z-10 text-center space-y-8">
            <p className="text-sm font-semibold uppercase tracking-widest text-blue-200">Monsey Trails Passenger</p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight">
              Schedules and tracking, <br className="hidden sm:block" />
              <span className="text-blue-300">simplified.</span>
            </h1>
            <p className="text-lg sm:text-xl text-blue-100 max-w-2xl mx-auto leading-relaxed">
              Plan your journey with the Monsey Trails Passenger app. Find your pickup stops, browse published departures, and follow live coach information when available.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Link href={APP_ROUTES.passengers} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-white text-blue-950 font-bold px-8 py-4 rounded-xl hover:bg-blue-50 transition-colors text-lg shadow-xl shadow-blue-900/20">
                Browse Schedules Online
                <ChevronRight className="w-5 h-5 text-blue-500" />
              </Link>
            </div>
          </div>
        </section>

        <section className="px-4 py-20 max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
              <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
                <Clock className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Published Schedules</h3>
              <p className="text-slate-600 leading-relaxed">
                Browse all available routes and select your travel date. View complete timetables to plan your journey with confidence.
              </p>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
              <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
                <Map className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Exact Stop Locations</h3>
              <p className="text-slate-600 leading-relaxed">
                Choose the verified pickup and drop-off stops served by your selected journey, so you can plan where to board and arrive.
              </p>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
              <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
                <Star className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Favorite Routes</h3>
              <p className="text-slate-600 leading-relaxed">
                Save the trips you take most frequently for immediate access to schedules and tracking the moment you open the app.
              </p>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm">
              <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
                <Bell className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Departure Reminders</h3>
              <p className="text-slate-600 leading-relaxed">
                Set a departure reminder for a selected trip or chosen weekdays, and choose how far ahead of departure to be notified.
              </p>
            </div>

            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm md:col-span-2 lg:col-span-2">
              <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mb-6">
                <Bus className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Live Coach Information</h3>
              <p className="text-slate-600 leading-relaxed max-w-2xl">
                When live data is available for an assigned coach, follow its location and journey progress. Keep your selected trip and stop information close at hand.
              </p>
              
              <div className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-xl flex gap-3 text-sm text-slate-600">
                <Info className="w-5 h-5 text-slate-400 shrink-0" />
                <p>
                  <strong>Please note:</strong> Live tracking requires an assigned coach sharing GPS and an internet connection. Without live data, you may see scheduled information or a location-unavailable message.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 py-12 mb-12">
          <div className="max-w-3xl mx-auto bg-amber-50 border border-amber-200 rounded-3xl p-8 sm:p-10">
            <div className="flex items-start gap-4">
              <ShieldAlert className="w-8 h-8 text-amber-600 shrink-0" />
              <div>
                <h3 className="text-xl font-bold text-amber-900 mb-2">Service Limitations</h3>
                <div className="space-y-4 text-amber-800 leading-relaxed">
                  <p>
                    While we strive for accuracy, technical limitations can affect live data. Tracking information may be delayed or temporarily unavailable in areas with poor cellular service.
                  </p>
                  <p>
                    <strong>Push Notifications:</strong> Departure reminders and alerts require you to grant notification permissions in your device settings. Focus modes or silent profiles may silence these alerts.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4 grid sm:grid-cols-2 gap-8 items-center">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-6 h-6 rounded-md bg-slate-800 flex items-center justify-center text-slate-300 font-black text-xs tracking-tight">
                MT
              </div>
              <span className="font-bold text-slate-200">Monsey Trails</span>
            </div>
            <p className="text-sm">
              &copy; {new Date().getFullYear()} Monsey Trails. All rights reserved.
            </p>
          </div>
          
          <div className="flex sm:justify-end gap-6 text-sm font-medium">
            <Link href={APP_ROUTES.passengers} className="hover:text-white transition-colors">
              Passenger App
            </Link>
            <Link href={APP_ROUTES.appSupport} className="hover:text-white transition-colors">
              App Support
            </Link>
            <Link href={APP_ROUTES.privacy} className="hover:text-white transition-colors">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
