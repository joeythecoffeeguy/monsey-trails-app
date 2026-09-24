import { Calendar, Home, Map, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

export type OperatorTab = 'home' | 'trips' | 'map' | 'more';

const tabs = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'trips', label: 'Trips', icon: Calendar },
  { id: 'map', label: 'Map', icon: Map },
  { id: 'more', label: 'More', icon: Menu },
] as const;

interface OperatorTabNavigationProps {
  activeTab: OperatorTab;
  onTabChange: (tab: OperatorTab) => void;
}

export function OperatorTabNavigation({ activeTab, onTabChange }: OperatorTabNavigationProps) {
  return (
    <nav aria-label="Operator sections" className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border pb-[env(safe-area-inset-bottom)] sm:hidden">
      <div className="flex justify-around items-center h-16 px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex flex-col items-center justify-center w-full h-full gap-1 transition-colors relative',
              activeTab === tab.id ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <tab.icon className={cn('w-5 h-5', activeTab === tab.id && 'stroke-[2.5px]')} />
            <span className="text-[10px] font-bold">{tab.label}</span>
            {activeTab === tab.id && <div className="absolute top-0 inset-x-0 h-0.5 bg-primary rounded-b-full mx-auto w-8" />}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function DesktopTabNavigation({ activeTab, onTabChange }: OperatorTabNavigationProps) {
  return (
    <nav aria-label="Operator sections" className="flex items-center gap-1 bg-muted/50 p-1 rounded-full border border-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={activeTab === tab.id ? 'page' : undefined}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-full transition-all text-sm font-bold',
            activeTab === tab.id
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          <tab.icon className="w-4 h-4" />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}