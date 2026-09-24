import { Link } from 'wouter';
import { DriverSupport } from '@/components/driver-support';

export default function DriverSignUp() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#f0f4f8] px-4 font-sans antialiased">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-xl">
        <div className="mb-6 text-xs font-black tracking-[0.2em] text-primary">MONSEY TRAILS</div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Driver accounts are assigned</h1>
        <p className="mt-3 text-sm font-medium leading-6 text-slate-500">
          An administrator must create your username and password before you can use the coach console.
        </p>
        <DriverSupport />
        <Link href="/sign-in" className="mt-7 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 font-bold text-primary-foreground hover:bg-primary/90">
          Go to driver login
        </Link>
      </div>
    </div>
  );
}