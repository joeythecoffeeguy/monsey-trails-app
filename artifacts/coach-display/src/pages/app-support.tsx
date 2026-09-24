import { useEffect } from 'react';
import { Link } from 'wouter';
import { APP_ROUTES } from '@/lib/app-routes';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Bug, CheckCircle, Clock, Mail, MapPin, Settings, Smartphone } from 'lucide-react';

export default function AppSupport() {
  useEffect(() => {
    document.title = 'App Support | Monsey Trails';
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute('content', 'Technical support for the Monsey Trails passenger app. Help with tracking, schedules, and notifications.');
    }

    let ogTitle = document.querySelector('meta[property="og:title"]');
    let ogDesc = document.querySelector('meta[property="og:description"]');
    let addedOgTitle = false;
    let addedOgDesc = false;

    if (!ogTitle) {
      ogTitle = document.createElement('meta');
      ogTitle.setAttribute('property', 'og:title');
      document.head.appendChild(ogTitle);
      addedOgTitle = true;
    }
    ogTitle.setAttribute('content', 'App Support | Monsey Trails');

    if (!ogDesc) {
      ogDesc = document.createElement('meta');
      ogDesc.setAttribute('property', 'og:description');
      document.head.appendChild(ogDesc);
      addedOgDesc = true;
    }
    ogDesc.setAttribute('content', 'Technical support for the Monsey Trails passenger app.');

    return () => {
      if (addedOgTitle && ogTitle) document.head.removeChild(ogTitle);
      if (addedOgDesc && ogDesc) document.head.removeChild(ogDesc);
    };
  }, []);

  return (
    <div className="min-h-[100dvh] bg-gray-50 flex flex-col">
      <header className="bg-white border-b px-4 py-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 bg-primary rounded-xl flex items-center justify-center text-primary-foreground font-black text-xl">
              MT
            </div>
            <div>
              <h1 className="font-bold text-xl leading-tight text-gray-900">App Support</h1>
              <p className="text-sm text-gray-500 font-medium">Passenger Application</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 sm:p-6">
          <div className="flex gap-4">
            <AlertCircle className="w-6 h-6 text-blue-600 shrink-0" />
            <div>
              <h2 className="font-semibold text-blue-900 text-lg">Technical Support Only</h2>
              <p className="text-blue-800 mt-1">
                This inbox is exclusively for technical issues with the Monsey Trails Passenger app. 
                <strong> This is not for emergency assistance or real-time bus dispatch.</strong> For lost items, immediate dispatch issues, or ticket questions, please contact the main office.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-gray-200 shadow-sm">
            <CardHeader>
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mb-3">
                <MapPin className="w-5 h-5 text-gray-700" />
              </div>
              <CardTitle>Schedules & Tracking</CardTitle>
              <CardDescription>Missing or incorrect data</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-gray-600 space-y-2">
              <p>Live tracking requires an assigned coach sharing GPS and an internet connection. Until then, your trip may show scheduled information only. Check your travel date and exact pickup and drop-off stops.</p>
              <p>Contact support if you experience:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Missing coach assignments on active routes</li>
                <li>Inaccurate stop locations or schedule times</li>
                <li>"GPS/Network Unavailable" errors that persist</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-gray-200 shadow-sm">
            <CardHeader>
              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center mb-3">
                <Settings className="w-5 h-5 text-gray-700" />
              </div>
              <CardTitle>App & Notifications</CardTitle>
              <CardDescription>Device permissions and alerts</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-gray-600 space-y-2">
              <p>Check that notifications are allowed for the app in your phone settings. Focus and silent settings may affect whether you hear an alert.</p>
              <p>Contact support if you need help with:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Stop alerts not ringing or vibrating</li>
                <li>Trouble granting notification permissions</li>
                <li>App crashes or freezing on your device</li>
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="border-gray-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bug className="w-5 h-5" />
              Bug Report Checklist
            </CardTitle>
            <CardDescription>
              To help us fix your issue quickly, please include this information in your email:
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-700">
              <li className="flex items-start gap-2">
                <Smartphone className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                <span>App version, phone model, and iOS or Android version</span>
              </li>
              <li className="flex items-start gap-2">
                <Clock className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                <span>Time of issue and specific Route/Coach #</span>
              </li>
              <li className="flex items-start gap-2">
                <Settings className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                <span>Exact steps to reproduce the problem</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                <span>Optional screenshot (if helpful)</span>
              </li>
            </ul>

            <div className="mt-6 p-4 bg-orange-50 rounded-lg border border-orange-100">
              <p className="text-sm text-orange-800 font-medium">
                Security Notice: We will never ask for passwords, pairing codes, or sensitive personal information. Please do not include them in your email.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-200 shadow-sm bg-gray-900 text-white">
          <CardContent className="p-6 sm:p-8 text-center flex flex-col items-center justify-center min-h-[240px]">
            <Mail className="w-12 h-12 text-gray-400 mb-4" />
            <h2 className="text-2xl font-bold mb-2">Contact Technical Support</h2>
            <p className="text-gray-400 mb-8 max-w-md">
              Send us an email with the details of your issue. Our technical team reviews all reports to improve the app.
            </p>
            
            <a 
              href="mailto:Monseytraildt@gmail.com?subject=Monsey%20Trails%20Passenger%20app%20support"
              className="bg-white text-gray-900 hover:bg-gray-100 font-bold px-4 py-3 rounded-xl transition-colors w-full sm:w-auto inline-flex flex-wrap items-center justify-center gap-2 break-all"
            >
              Email Monseytraildt@gmail.com
            </a>
          </CardContent>
        </Card>
      </main>
      
      <footer className="py-8 text-center text-gray-500 text-sm">
        <p>&copy; {new Date().getFullYear()} Monsey Trails. All rights reserved.</p>
        <Link href={APP_ROUTES.privacy} className="inline-block mt-3 text-blue-700 hover:underline">Privacy Policy</Link>
      </footer>
    </div>
  );
}
