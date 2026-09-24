import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PassengerLanguage } from '@/providers/live-trip';

export type DisplayMode = 'auto' | 'welcome' | 'map' | 'next-stop' | 'weather' | 'traffic' | 'daf' | 'jewish-calendar' | 'announcements' | 'destinations-info' | 'fares-info' | 'passenger-guide' | 'contact-info' | 'charging-amenities' | 'safety';

export interface Announcement {
  id: string;
  title: string;
  message: string;
  active: boolean;
}

export interface CoachSettings {
  brandName: string;
  routeId: string;
  displayMode: DisplayMode;
  passengerLanguage: PassengerLanguage;
  rotationIntervalSeconds: number;
  emergencyOverride: boolean;
  emergencyMessage: string;
  announcements: Announcement[];
  
  // Actions
  updateSettings: (settings: Partial<Omit<CoachSettings, 'updateSettings'>>) => void;
  addAnnouncement: (announcement: Omit<Announcement, 'id'>) => void;
  updateAnnouncement: (id: string, announcement: Partial<Announcement>) => void;
  deleteAnnouncement: (id: string) => void;
}

export const useSettingsStore = create<CoachSettings>()(
  persist(
    (set) => ({
      brandName: 'Monsey Trails',
      routeId: 'route-1',
      displayMode: 'auto',
      passengerLanguage: 'en',
      rotationIntervalSeconds: 15,
      emergencyOverride: false,
      emergencyMessage: 'Please remain seated and follow all instructions from the driver.',
      announcements: [
        {
          id: '1',
          title: 'Welcome Aboard',
          message: 'Thank you for choosing Monsey Trails. Please remain seated while the coach is moving and keep the aisle clear.',
          active: true,
        },
        {
          id: '2',
          title: 'Service Update',
          message: 'Please check that you have all personal belongings before leaving the coach.',
          active: false,
        }
      ],
      updateSettings: (newSettings) => set((state) => ({ ...state, ...newSettings })),
      addAnnouncement: (announcement) => 
        set((state) => ({
          announcements: [
            ...state.announcements,
            { ...announcement, id: Math.random().toString(36).substring(7) }
          ]
        })),
      updateAnnouncement: (id, update) =>
        set((state) => ({
          announcements: state.announcements.map((a) =>
            a.id === id ? { ...a, ...update } : a
          )
        })),
      deleteAnnouncement: (id) =>
        set((state) => ({
          announcements: state.announcements.filter((a) => a.id !== id)
        })),
    }),
    {
      name: 'monsey-trails-coach-settings-v2',
    }
  )
);
