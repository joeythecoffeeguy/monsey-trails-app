import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverOnboarding } from './driver-onboarding';

const mocks = vi.hoisted(() => ({
  user: { id: 'disposable-test-driver', username: 'testdriver', primaryPhoneNumber: null },
  update: vi.fn(),
  signOut: vi.fn(),
  releaseDriverCoaches: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({ user: mocks.user }),
  useClerk: () => ({ signOut: mocks.signOut }),
}));
vi.mock('@/providers/driver-profile', () => ({
  useUpdateDriverProfile: () => ({ mutateAsync: mocks.update, isPending: false, isError: false }),
  releaseDriverCoaches: mocks.releaseDriverCoaches,
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetAdminAccess: () => ({ data: { authorized: false } }),
  getGetAdminAccessQueryKey: () => ['/api/admin/access'],
}));

beforeEach(() => {
  mocks.user.username = 'testdriver';
  mocks.update.mockReset().mockResolvedValue(undefined);
  mocks.signOut.mockReset().mockResolvedValue(undefined);
  mocks.releaseDriverCoaches.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('driver onboarding with real form controls', () => {
  it('renders after authorization without putting the read-only identity inside a form field', () => {
    render(<DriverOnboarding />);
    expect(screen.getByText('Please complete your profile to continue')).toBeInTheDocument();
    expect(screen.getByText('Assigned Username')).toBeInTheDocument();
    expect(screen.getByText('testdriver')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /username/i })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Unit Number' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Phone Number' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete Profile' })).toBeEnabled();
  });

  it('validates and submits only the editable profile fields', async () => {
    render(<DriverOnboarding />);
    fireEvent.click(screen.getByRole('button', { name: 'Complete Profile' }));
    expect(await screen.findByText('Unit number is required')).toBeInTheDocument();
    expect(screen.getByText('Phone number is required')).toBeInTheDocument();
    expect(mocks.update).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: 'Unit Number' }), { target: { value: 'TEST' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Phone Number' }), { target: { value: '+12025550100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Profile' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({
      unitNumber: 'TEST', phoneNumber: '+12025550100',
    }));
  });

  it('keeps onboarding blocked when no username has been assigned', () => {
    mocks.user.username = '';
    render(<DriverOnboarding />);
    expect(screen.getByText('Not assigned')).toBeInTheDocument();
    expect(screen.getByText(/Contact your administrator before completing/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete Profile' })).toBeDisabled();
  });

  it('releases owned coaches and returns sign-out to driver login', async () => {
    const accountChanged = vi.fn();
    window.addEventListener('driver-account-changed', accountChanged);
    render(<DriverOnboarding />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ redirectUrl: '/sign-in' }));
    expect(mocks.releaseDriverCoaches).toHaveBeenCalledTimes(1);
    expect(accountChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener('driver-account-changed', accountChanged);
  });
});
