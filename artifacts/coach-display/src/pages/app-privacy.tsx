import { useEffect } from 'react';
import { Link } from 'wouter';
import { APP_ROUTES } from '@/lib/app-routes';
import { Shield } from 'lucide-react';

export default function AppPrivacy() {
  useEffect(() => {
    document.title = 'Privacy Policy | Monsey Trails';
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute('content', 'Privacy Policy for the Monsey Trails Passenger application.');
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
    canonical.setAttribute('href', 'https://coach-passenger-display.replit.app/privacy');

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
    ogTitle.setAttribute('content', 'Privacy Policy | Monsey Trails');

    if (!ogDesc) {
      ogDesc = document.createElement('meta');
      ogDesc.setAttribute('property', 'og:description');
      document.head.appendChild(ogDesc);
      addedOgDesc = true;
    }
    ogDesc.setAttribute('content', 'Privacy Policy for the Monsey Trails Passenger application.');

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

      <main className="pt-24 pb-20 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white p-8 sm:p-12 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center">
              <Shield className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Privacy Policy</h1>
              <p className="text-slate-500 font-medium mt-1">Effective September 23, 2026</p>
            </div>
          </div>

          <div className="prose prose-slate max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-blue-600 hover:prose-a:text-blue-800 prose-p:leading-relaxed text-slate-700">
            <p className="font-medium text-slate-900">
              This policy explains how the Monsey Trails Passenger application collects, uses, stores, and shares information.
            </p>

            <h3>Data Collection & Local Storage</h3>
            <p>
              <strong>No Passenger Account Required:</strong> You do not need to create an account, provide your name, or sign in to use the Monsey Trails Passenger application.
            </p>
            <p>
              <strong>Local Data:</strong> To provide a seamless experience, the app stores certain information locally on your device. This includes your selected route, date, and run, exact stop choices, favorites/preferences, and cached schedules. The app also generates and stores a unique installation ID.
            </p>

            <h3>Notifications & Stop Alerts</h3>
            <p>
              Notifications are strictly optional. If you opt-in to receive stop alerts or departure reminders, the app sends your installation ID, push token and delivery credentials, passenger pairing code (when used), selected stop and trip, alert lead time, selected weekdays, and sound preference to our servers. This data is required solely to deliver the alerts you request. You can revoke notification permissions at any time via your device settings.
            </p>

            <h3>Location Services</h3>
            <p>
              <strong>No Passenger Phone GPS Collection:</strong> We do not request location permissions on your device, and we do not collect your phone's GPS data. The live vehicle location shown on the application map comes entirely from the assigned coach.
            </p>

            <h3>Network Requests & Providers</h3>
            <p>
              Like most online services, standard network requests made by the app may provide normal technical information (such as your IP address, device type, and browser details) to our infrastructure. 
            </p>
            <p>
              <strong>Service Providers:</strong> We use third-party providers to power specific app features:
            </p>
            <ul>
              <li><strong>Expo and Apple/Google:</strong> For push notification delivery.</li>
              <li><strong>MapTiler:</strong> For map tiles (routed via our server proxy).</li>
              <li><strong>Replit:</strong> For hosted application infrastructure.</li>
            </ul>
            <p>
              We do not use advertising SDKs, we do not sell your personal information, and we do not engage in cross-app behavioral tracking.
            </p>

            <h3>Data Usage</h3>
            <p>
              The data we handle is used exclusively to provide schedules and live tracking, pair your session with a coach, send departure reminders, ensure security, and troubleshoot technical issues.
            </p>

            <h3>Retention</h3>
            <p>
              Local app data remains on your device until you clear the app's storage or uninstall it. When you disable an active alert registration (or leave where supported), it is removed from our active dispatch. Cancelled reminder records may be retained for operational and security logging. We retain information only as reasonably necessary for operational, legal, security, and backup purposes. Data held by our service providers is subject to those providers' respective retention practices.
            </p>

            <h3>Security</h3>
            <p>
              We treat pairing codes and push tokens as sensitive information and employ measures to protect them. However, no digital system can guarantee absolute security. 
            </p>

            <h3>Children</h3>
            <p>
              The Monsey Trails Passenger app is a travel utility intended for a general audience. We do not knowingly request names or email addresses, nor do we create child profiles. If you have concerns regarding a minor's use of the app, a parent or guardian should contact us.
            </p>

            <h3>Your Choices</h3>
            <p>
              You maintain control over your experience. You can:
            </p>
            <ul>
              <li>Control or disable notifications in your device settings.</li>
              <li>Leave or unpair your device from live tracking at any time.</li>
              <li>Clear the app storage or uninstall the application to remove local data.</li>
              <li>Submit privacy-related requests via email. Please note that deletion requests may require information to identify a specific installation or reminder, and some records may be retained for legal or operational reasons.</li>
            </ul>

            <h3>International Processing & Third-Party Links</h3>
            <p>
              Data is processed in the United States and in regions where our providers operate. If the application contains links to third-party services, please be aware that they are governed by their own privacy policies.
            </p>

            <h3>Changes & Contact</h3>
            <p>
              Any changes to this policy will be posted on this page with an updated effective date.
            </p>
            <p>
              For privacy matters, please contact us at: <a href="mailto:Monseytraildt@gmail.com">Monseytraildt@gmail.com</a>
            </p>
            <div className="mt-8 p-4 bg-amber-50 rounded-xl border border-amber-200">
              <p className="text-sm text-amber-900 m-0">
                <strong>Important:</strong> This email is for privacy and technical inquiries only. It is not intended for emergency assistance or real-time dispatch support.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-slate-900 text-slate-400 py-12 border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
          <div>
            <div className="flex items-center gap-2 mb-4 justify-center md:justify-start">
              <div className="w-6 h-6 rounded-md bg-slate-800 flex items-center justify-center text-slate-300 font-black text-xs tracking-tight">
                MT
              </div>
              <span className="font-bold text-slate-200">Monsey Trails</span>
            </div>
            <p className="text-sm text-center md:text-left">
              &copy; {new Date().getFullYear()} Monsey Trails. All rights reserved.
            </p>
          </div>
          
          <div className="flex flex-wrap justify-center gap-6 text-sm font-medium">
            <Link href={APP_ROUTES.appMarketing} className="hover:text-white transition-colors">
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
