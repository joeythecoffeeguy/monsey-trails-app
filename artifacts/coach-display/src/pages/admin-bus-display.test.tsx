import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { useAuth } from '@clerk/react';
import {
  adminDisconnectPassengerScreens,
  listAdminActiveTrips,
} from '@/providers/live-trip';
import AdminBusDisplay from './admin-bus-display';

vi.mock('@clerk/react', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/providers/live-trip', () => ({
  ADMIN_DISPLAY_SLIDES: ['welcome', 'announcements'],
  adminDisconnectPassengerScreens: vi.fn(),
  clearAdminDisplayBusNumber: vi.fn(),
  getAdminDisplaySettings: vi.fn(),
  getAdminDisplayBusNumber: vi.fn(() => ''),
  listAdminActiveTrips: vi.fn(),
  saveAdminDisplaySettings: vi.fn(),
  setAdminDisplayBusNumber: vi.fn(),
  setAdminEmergencyTakeover: vi.fn(),
}));

vi.mock('./passenger', () => ({
  default: () => <div>Passenger display</div>,
}));

describe('AdminBusDisplay', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({ isLoaded: true, userId: 'admin-1' } as ReturnType<typeof useAuth>);
    vi.mocked(listAdminActiveTrips).mockResolvedValue([{
      busNumber: '215',
      status: 'running',
      destinationAddress: '18th Avenue',
      pairedScreenCount: 2,
      scheduledDepartureAt: '2026-09-22T18:00:00.000Z',
      updatedAt: '2026-09-22T18:30:00.000Z',
    }]);
    vi.mocked(adminDisconnectPassengerScreens).mockResolvedValue({
      busNumber: '215',
      pairingCode: 'new-code',
      disconnectedScreenCount: 2,
      pairedScreenCount: 0,
      status: 'running',
      officialRunKey: '2026-09-22|2|2|3|798',
      startedAt: '2026-09-22T18:05:00.000Z',
      updatedAt: '2026-09-22T18:31:00.000Z',
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a clickable per-bus control and refreshes the paired count after success', async () => {
    render(
      <Router hook={memoryLocation({ path: '/admin/display' }).hook}>
        <AdminBusDisplay />
      </Router>,
    );

    const button = await screen.findByRole('button', { name: 'Log out paired screens for bus 215' });
    expect(button).toHaveTextContent('Log out paired screens (2)');
    fireEvent.click(button);

    await waitFor(() => expect(adminDisconnectPassengerScreens).toHaveBeenCalledWith('215'));
    expect(await screen.findByRole('status')).toHaveTextContent('2 paired screens on bus 215 were logged out.');
    expect(listAdminActiveTrips).toHaveBeenCalledTimes(2);
  });
});