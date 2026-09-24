import type { ReactNode } from 'react';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function LoadingSplash({ children }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-secondary px-4 font-sans antialiased text-secondary-foreground">
      <div className="flex flex-col items-center animate-in fade-in duration-500">
        <img
          src={`${basePath}/monsey-trails-logo.png`}
          alt="Monsey Trails"
          className="h-12 max-w-full object-contain brightness-0 invert mb-6"
        />
        {children && (
          <div role="status" className="mt-4 flex items-center gap-3 text-sm font-medium">
            <span className="h-4 w-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
