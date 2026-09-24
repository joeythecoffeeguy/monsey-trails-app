import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import AdminDrivers from './admin-drivers';
import { classifyClerkEnvironment } from '@/lib/clerk-environment';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth, useClerk, useUser } from '@clerk/react';
import { Router, useLocation } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { Toaster } from '@/components/ui/toaster';
import * as apiClient from '@workspace/api-client-react';
import type { ErrorType } from '@workspace/api-client-react';
import type { Mock } from 'vitest';
import { releaseDriverCoaches } from '@/providers/driver-profile';
import { clearOperatorSession } from '@/providers/live-trip';

vi.mock('@clerk/react', async () => {
  const actual = await vi.importActual('@clerk/react');
  return {
    ...actual,
    useAuth: vi.fn(),
    useClerk: vi.fn(),
    useUser: vi.fn(),
  };
});

vi.mock('@workspace/api-client-react', async () => {
  const actual = await vi.importActual('@workspace/api-client-react');
  return {
    ...actual,
    useGetAdminAccess: vi.fn(),
    useListAdminDrivers: vi.fn(),
    createAdminDriver: vi.fn(),
    disableAdminDriver: vi.fn(),
    enableAdminDriver: vi.fn(),
    deleteAdminDriver: vi.fn(),
    resetAdminDriverAccess: vi.fn(),
  };
});

vi.mock('@/providers/driver-profile', () => ({
  releaseDriverCoaches: vi.fn(),
}));

vi.mock('@/providers/live-trip', () => ({
  clearOperatorSession: vi.fn(),
}));

function LocationTracker() {
  const [location] = useLocation();
  return <div data-testid="location-tracker">{location}</div>;
}

// A small wrapper to provide query client, router, toaster
function renderWithProviders(ui: React.ReactNode, historyParams: any) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <Router hook={historyParams.hook}>
        <LocationTracker />
        {ui}
        <Toaster />
      </Router>
    </QueryClientProvider>
  );
  return { ...rendered, queryClient };
}

describe('AdminDrivers', () => {
  let historyParams: any;

  beforeEach(() => {
    historyParams = memoryLocation({ path: '/admin', record: true });
    vi.clearAllMocks();
    (useClerk as Mock).mockReturnValue({ signOut: vi.fn().mockResolvedValue(undefined) });
    (useUser as Mock).mockReturnValue({ user: { username: 'current-admin' } });
    (releaseDriverCoaches as Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  const setupMockAuth = (isLoaded: boolean, userId: string | null = null) => {
    (useAuth as Mock).mockReturnValue({ isLoaded, userId });
  };

  it('redirects to sign-in if no user is signed in', () => {
    setupMockAuth(true, null);
    renderWithProviders(<AdminDrivers />, historyParams);
    
    expect(screen.getByTestId('location-tracker')).toHaveTextContent('/sign-in');
    expect(historyParams.history.at(-1)).toBe('/sign-in?redirect_url=%2Fadmin');
    expect(apiClient.useGetAdminAccess).not.toHaveBeenCalled();
    expect(apiClient.useListAdminDrivers).not.toHaveBeenCalled();
  });

  it('shows loading state when auth is not loaded', () => {
    setupMockAuth(false, null);
    renderWithProviders(<AdminDrivers />, historyParams);
    expect(screen.queryByText(/Admin Management/i)).not.toBeInTheDocument();
    expect(apiClient.useGetAdminAccess).not.toHaveBeenCalled();
    expect(apiClient.useListAdminDrivers).not.toHaveBeenCalled();
  });

  it('shows current-account recovery without redirecting an invalid admin session (401)', () => {
    setupMockAuth(true, 'user_expired');
    const refetch = vi.fn();
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false,
      isError: true,
      error: {
        status: 401,
        data: { code: 'ADMIN_SESSION_INVALID', error: 'safe server message' },
      } as ErrorType,
      refetch,
    });

    renderWithProviders(<AdminDrivers />, historyParams);
    expect(screen.getByText('Session needs refreshing')).toBeInTheDocument();
    expect(screen.getByTestId('admin-current-username')).toHaveTextContent('current-admin');
    expect(historyParams.history.at(-1)).toBe('/admin');
    expect(apiClient.useListAdminDrivers).not.toHaveBeenCalled();
    expect(screen.queryByText('Create Driver')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-retry-admin-access'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['ADMIN_ACCESS_REQUIRED', 'Administrator role required'],
    ['ACCOUNT_RESTRICTED', 'Account restricted'],
    ['UNTRUSTED_ORIGIN', 'Open the official app'],
  ])('maps %s to safe recovery guidance', (code, title) => {
    setupMockAuth(true, 'user_123');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false,
      isError: true,
      error: { status: 403, data: { code, error: 'server detail' } } as ErrorType,
      refetch: vi.fn(),
    });

    renderWithProviders(<AdminDrivers />, historyParams);
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getByTestId('admin-current-username')).toHaveTextContent('current-admin');
    expect(screen.getByTestId('admin-environment')).not.toHaveTextContent(/pk_(test|live)_/);
    expect(screen.queryByText('Create Driver')).not.toBeInTheDocument();
    expect(apiClient.useListAdminDrivers).not.toHaveBeenCalled();
  });

  it('does not falsely claim missing privileges for an unknown 403', () => {
    setupMockAuth(true, 'user_123');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false,
      isError: true,
      error: { status: 403, data: { code: 'NEW_SERVER_REASON' } } as ErrorType,
      refetch: vi.fn(),
    });

    renderWithProviders(<AdminDrivers />, historyParams);
    expect(screen.getByText('Access could not be confirmed')).toBeInTheDocument();
    expect(screen.queryByText(/do not have administrative privileges/i)).not.toBeInTheDocument();
  });

  it('lets a denied account sign out and change accounts without a protected cleanup call', async () => {
    setupMockAuth(true, 'user_123');
    const signOut = vi.fn().mockResolvedValue(undefined);
    (useClerk as Mock).mockReturnValue({ signOut });
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false,
      isError: true,
      error: {
        status: 403,
        data: { code: 'ADMIN_ACCESS_REQUIRED', error: 'Administrator access is required.' },
      } as ErrorType,
      refetch: vi.fn(),
    });

    renderWithProviders(<AdminDrivers />, historyParams);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out / change account' }));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledWith({
        redirectUrl: '/sign-in?redirect_url=%2Fadmin',
      });
    });
    expect(releaseDriverCoaches).not.toHaveBeenCalled();
    expect(clearOperatorSession).toHaveBeenCalledTimes(1);
  });

  it('classifies Clerk environments without exposing key contents', () => {
    expect(classifyClerkEnvironment('pk_live_example')).toBe('Production');
    expect(classifyClerkEnvironment('pk_test_example')).toBe('Development');
    expect(classifyClerkEnvironment(undefined)).toBe('Environment unavailable');
  });

  it('shows retry state on 503 error', () => {
    setupMockAuth(true, 'user_123');
    
    const refetchMock = vi.fn();
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false,
      isError: true,
      error: { status: 503 } as ErrorType,
      refetch: refetchMock,
    });
    
    renderWithProviders(<AdminDrivers />, historyParams);
    expect(screen.getByText('Service Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Retry Connection')).toBeInTheDocument();
    
    fireEvent.click(screen.getByText('Retry Connection'));
    expect(refetchMock).toHaveBeenCalled();
  });

  it('renders the list of drivers when authorized', () => {
    setupMockAuth(true, 'user_admin');
    
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { authorized: true },
    });

    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        drivers: [
          { id: 'd_1', username: 'driver1', displayName: 'Saved Driver Name', firstName: 'Dina', lastName: 'Cohen', unitNumber: 'U-42', disabled: false },
          { id: 'd_2', username: 'driver2', displayName: null, firstName: null, lastName: null, unitNumber: null, disabled: true },
        ],
        nextOffset: null,
      },
    });

    renderWithProviders(<AdminDrivers />, historyParams);
    
    expect(screen.getByText('driver1')).toBeInTheDocument();
    expect(screen.getByText('driver2')).toBeInTheDocument();
    expect(screen.getByTestId('text-name-d_1')).toHaveTextContent('Saved Driver Name');
    expect(screen.getByTestId('text-unit-number-d_1')).toHaveTextContent('U-42');
    expect(screen.getByTestId('text-name-d_2')).toHaveTextContent('Not provided');
    expect(screen.getByTestId('text-unit-number-d_2')).toHaveTextContent('Unassigned');
    expect(screen.getAllByText('Name')).toHaveLength(2);
    expect(screen.getAllByText('Username')).toHaveLength(2);
    expect(screen.getAllByText('Unit number')).toHaveLength(2);
    expect(screen.getByText('DISABLED')).toBeInTheDocument(); // matches the disabled driver
    expect(screen.getByTestId('button-disable-d_1')).toBeInTheDocument();
    expect(screen.getByTestId('button-enable-d_2')).toBeInTheDocument();
    expect(screen.getByTestId('button-admin-logout')).toHaveTextContent('Log out');
  });

  it('uses theme-aware foreground and surface classes for admin content', () => {
    setupMockAuth(true, 'user_admin');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { authorized: true },
    });
    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        drivers: [
          { id: 'd_theme', username: 'theme-driver', displayName: 'Theme Driver', unitNumber: 'T-12', disabled: false },
        ],
        nextOffset: null,
      },
    });

    renderWithProviders(<AdminDrivers />, historyParams);

    expect(screen.getByRole('banner')).toHaveClass('bg-card', 'text-card-foreground', 'border-border');
    expect(screen.getByTestId('button-admin-logout')).toHaveClass('text-foreground');
    expect(screen.getByTestId('text-name-d_theme')).toHaveClass('text-card-foreground');
    expect(screen.getByTestId('text-username-d_theme')).toHaveClass('text-card-foreground');
    expect(screen.getByTestId('text-unit-number-d_theme')).toHaveClass('text-card-foreground');
    expect(screen.getByTestId('input-search-drivers')).toHaveClass('bg-background', 'text-foreground', 'border-border');
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveClass('text-foreground');
    expect(screen.getByText('Page 1 · 1 drivers')).toHaveClass('text-muted-foreground');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveClass('text-foreground');

    fireEvent.click(screen.getByTestId('button-add-driver'));
    expect(screen.getByRole('dialog')).toHaveClass('bg-card', 'text-card-foreground', 'border-border');
    expect(screen.getByTestId('input-create-first-name')).toHaveClass('bg-background', 'text-foreground', 'border-border');
  });

  it('searches the current page by name, username, and unit number', () => {
    setupMockAuth(true, 'user_admin');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false, isError: false, data: { authorized: true },
    });
    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        drivers: [
          { id: 'd_1', username: 'driver1', displayName: 'Registered Cohen', firstName: null, lastName: null, unitNumber: 'U-42', disabled: false },
          { id: 'd_2', username: 'wheelman', displayName: 'Moishe Levy', firstName: 'Moishe', lastName: 'Levy', unitNumber: null, disabled: false },
        ],
        nextOffset: null,
      },
    });

    renderWithProviders(<AdminDrivers />, historyParams);
    const search = screen.getByTestId('input-search-drivers');
    fireEvent.change(search, { target: { value: 'cohen' } });
    expect(screen.getByTestId('card-driver-d_1')).toBeInTheDocument();
    expect(screen.queryByTestId('card-driver-d_2')).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'wheelman' } });
    expect(screen.getByTestId('card-driver-d_2')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'u-42' } });
    expect(screen.getByTestId('card-driver-d_1')).toBeInTheDocument();
  });

  it('releases owned coaches, clears admin caches, and returns logout to admin sign-in', async () => {
    setupMockAuth(true, 'user_admin');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false, isError: false, data: { authorized: true },
    });
    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false, isError: false, data: { drivers: [], nextOffset: null },
    });
    const signOut = vi.fn().mockResolvedValue(undefined);
    (useClerk as Mock).mockReturnValue({ signOut });

    const { queryClient } = renderWithProviders(<AdminDrivers />, historyParams);
    const removeQueries = vi.spyOn(queryClient, 'removeQueries');
    fireEvent.click(screen.getByTestId('button-admin-logout'));

    await waitFor(() => {
      expect(releaseDriverCoaches).toHaveBeenCalledTimes(1);
      expect(clearOperatorSession).toHaveBeenCalledTimes(1);
      expect(signOut).toHaveBeenCalledWith({
        redirectUrl: '/sign-in?redirect_url=%2Fadmin',
      });
      expect(removeQueries).toHaveBeenCalledWith({ queryKey: apiClient.getGetAdminAccessQueryKey() });
      expect(removeQueries).toHaveBeenCalledWith({ queryKey: apiClient.getListAdminDriversQueryKey() });
    });
  });

  it('disables logout while pending and prevents duplicate requests', async () => {
    setupMockAuth(true, 'user_admin');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false, isError: false, data: { authorized: true },
    });
    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false, isError: false, data: { drivers: [], nextOffset: null },
    });
    let finishRelease!: () => void;
    (releaseDriverCoaches as Mock).mockImplementation(() => new Promise<void>((resolve) => {
      finishRelease = resolve;
    }));

    renderWithProviders(<AdminDrivers />, historyParams);
    const logout = screen.getByTestId('button-admin-logout');
    fireEvent.click(logout);
    expect(logout).toBeDisabled();
    fireEvent.click(logout);
    expect(releaseDriverCoaches).toHaveBeenCalledTimes(1);
    finishRelease();
    await waitFor(() => expect(clearOperatorSession).toHaveBeenCalledTimes(1));
  });

  it('keeps the admin signed in and shows a toast when coach cleanup fails', async () => {
    setupMockAuth(true, 'user_admin');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false, isError: false, data: { authorized: true },
    });
    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false, isError: false, data: { drivers: [], nextOffset: null },
    });
    (releaseDriverCoaches as Mock).mockRejectedValue(new Error('Coach cleanup unavailable'));
    const signOut = vi.fn();
    (useClerk as Mock).mockReturnValue({ signOut });

    renderWithProviders(<AdminDrivers />, historyParams);
    fireEvent.click(screen.getByTestId('button-admin-logout'));

    expect(await screen.findByText('Log out failed')).toBeInTheDocument();
    expect(screen.getByText('Coach cleanup unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('button-admin-logout')).toBeEnabled();
    expect(signOut).not.toHaveBeenCalled();
    expect(historyParams.history.at(-1)).toBe('/admin');
  });

  it('uses server cursors in both directions, including empty filtered pages', () => {
    setupMockAuth(true, 'user_admin');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false, data: { authorized: true },
    });
    (apiClient.useListAdminDrivers as Mock).mockImplementation(({ offset }) => ({
      isLoading: false,
      isError: false,
      data: offset === 200
        ? { drivers: [{ id: 'd_late', username: 'later-driver', disabled: false }], nextOffset: null }
        : { drivers: [], nextOffset: offset + 100 },
    }));
    renderWithProviders(<AdminDrivers />, historyParams);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByText('No drivers on this page')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(apiClient.useListAdminDrivers).toHaveBeenLastCalledWith({ offset: 100 }, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('later-driver')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(apiClient.useListAdminDrivers).toHaveBeenLastCalledWith({ offset: 100 }, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(apiClient.useListAdminDrivers).toHaveBeenLastCalledWith({ offset: 0 }, expect.anything());
  });

  it('defaults to the directory and supports opening, cancelling, and successfully creating a driver', async () => {
    setupMockAuth(true, 'user_admin');
    
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { authorized: true },
    });

    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { drivers: [], nextOffset: null },
    });

    (apiClient.createAdminDriver as Mock).mockResolvedValue({
      driver: { id: 'd_new', username: 'newdriver', disabled: false }
    });

    const { queryClient } = renderWithProviders(<AdminDrivers />, historyParams);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    expect(screen.getByText('Directory')).toBeInTheDocument();
    expect(screen.queryByTestId('input-create-first-name')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-add-driver'));
    expect(screen.getByText(/First and last name are required by the current identity provider/i)).toBeInTheDocument();
    expect(screen.getByText(/current live identity provider has email disabled/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-cancel-create'));
    expect(screen.queryByTestId('input-create-first-name')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('button-add-driver'));
    fireEvent.change(screen.getByTestId('input-create-first-name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByTestId('input-create-last-name'), { target: { value: 'Driver' } });
    fireEvent.change(screen.getByTestId('input-create-username'), { target: { value: 'newdriver' } });
    fireEvent.change(screen.getByTestId('input-create-password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByTestId('button-submit-create'));

    await waitFor(() => {
      expect(apiClient.createAdminDriver).toHaveBeenCalledWith({
        firstName: 'New',
        lastName: 'Driver',
        username: 'newdriver',
        password: 'password123',
        email: undefined,
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('input-create-password')).not.toBeInTheDocument();
      expect(screen.getByText('newdriver')).toBeInTheDocument();
      expect(invalidateSpy).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByTestId('button-delete-d_new'));
    fireEvent.change(screen.getByTestId('input-delete-confirmation-d_new'), { target: { value: 'newdriver' } });
    fireEvent.click(screen.getByTestId('button-confirm-delete'));
    await waitFor(() => {
      expect(apiClient.deleteAdminDriver).toHaveBeenCalledWith('d_new');
      expect(screen.queryByTestId('card-driver-d_new')).not.toBeInTheDocument();
    });
  });

  it('returns to the first page and shows a driver created from a later page', async () => {
    setupMockAuth(true, 'user_admin');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false, isError: false, data: { authorized: true },
    });
    (apiClient.useListAdminDrivers as Mock).mockImplementation(({ offset }) => ({
      isLoading: false,
      isError: false,
      data: offset === 0
        ? { drivers: [{ id: 'd_first', username: 'first-page', disabled: false }], nextOffset: 100 }
        : { drivers: [{ id: 'd_later', username: 'later-page', disabled: false }], nextOffset: null },
    }));
    (apiClient.createAdminDriver as Mock).mockResolvedValue({
      driver: { id: 'd_new', username: 'new-from-page-two', disabled: false },
    });

    renderWithProviders(<AdminDrivers />, historyParams);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('later-page')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-add-driver'));
    fireEvent.change(screen.getByTestId('input-create-first-name'), { target: { value: 'New' } });
    fireEvent.change(screen.getByTestId('input-create-last-name'), { target: { value: 'Driver' } });
    fireEvent.change(screen.getByTestId('input-create-username'), { target: { value: 'new-from-page-two' } });
    fireEvent.change(screen.getByTestId('input-create-password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByTestId('button-submit-create'));

    await waitFor(() => {
      expect(apiClient.useListAdminDrivers).toHaveBeenLastCalledWith({ offset: 0 }, expect.anything());
      expect(screen.getByText('new-from-page-two')).toBeInTheDocument();
      expect(screen.getByText('Page 1 · 2 drivers')).toBeInTheDocument();
    });
  });

  it('handles disabling a driver', async () => {
    setupMockAuth(true, 'user_admin');
    
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { authorized: true },
    });

    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        drivers: [{ id: 'd_1', username: 'driver1', disabled: false }],
        nextOffset: null,
      },
    });

    (apiClient.disableAdminDriver as Mock).mockResolvedValue({});

    renderWithProviders(<AdminDrivers />, historyParams);

    fireEvent.click(screen.getByTestId('button-disable-d_1'));
    expect(screen.getByText(/Are you sure you want to disable/)).toBeInTheDocument();
    
    fireEvent.click(screen.getByTestId('button-confirm-disable'));

    await waitFor(() => {
      expect(apiClient.disableAdminDriver).toHaveBeenCalledWith('d_1');
    });
  });

  it('enables a disabled driver and prevents duplicate submissions while pending', async () => {
    setupMockAuth(true, 'user_admin');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false, isError: false, data: { authorized: true },
    });
    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { drivers: [{ id: 'd_2', username: 'driver2', disabled: true }], nextOffset: null },
    });
    let resolveEnable!: (value: unknown) => void;
    (apiClient.enableAdminDriver as Mock).mockImplementation(() => new Promise((resolve) => {
      resolveEnable = resolve;
    }));

    renderWithProviders(<AdminDrivers />, historyParams);
    fireEvent.click(screen.getByTestId('button-enable-d_2'));
    const confirm = screen.getByTestId('button-confirm-enable');
    fireEvent.click(confirm);
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(apiClient.enableAdminDriver).toHaveBeenCalledTimes(1);
    resolveEnable({ driver: { id: 'd_2', username: 'driver2', disabled: false } });
    await waitFor(() => expect(screen.queryByText('Enable Driver')).not.toBeInTheDocument());
  });

  it('requires the exact username before deleting and removes the row on success', async () => {
    setupMockAuth(true, 'user_admin');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false, isError: false, data: { authorized: true },
    });
    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { drivers: [{ id: 'd_1', username: 'Driver.One', disabled: false }], nextOffset: null },
    });
    (apiClient.deleteAdminDriver as Mock).mockResolvedValue(undefined);

    const { queryClient } = renderWithProviders(<AdminDrivers />, historyParams);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fireEvent.click(screen.getByTestId('button-delete-d_1'));
    expect(screen.getByText(/permanently removes/i)).toBeInTheDocument();
    const confirmation = screen.getByTestId('input-delete-confirmation-d_1');
    const submit = screen.getByTestId('button-confirm-delete');
    expect(submit).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: 'driver.one' } });
    expect(submit).toBeDisabled();
    fireEvent.change(confirmation, { target: { value: 'Driver.One' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(apiClient.deleteAdminDriver).toHaveBeenCalledWith('d_1');
      expect(screen.queryByTestId('card-driver-d_1')).not.toBeInTheDocument();
      expect(invalidateSpy).toHaveBeenCalled();
    });
  });

  it('keeps the delete dialog open and shows a safe actionable error when deletion fails', async () => {
    setupMockAuth(true, 'user_admin');
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false, isError: false, data: { authorized: true },
    });
    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { drivers: [{ id: 'd_1', username: 'driver1', disabled: false }], nextOffset: null },
    });
    (apiClient.deleteAdminDriver as Mock).mockRejectedValue({
      status: 409,
      data: { error: 'End the active coach session, then try again.' },
    });

    const { queryClient } = renderWithProviders(<AdminDrivers />, historyParams);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    fireEvent.click(screen.getByTestId('button-delete-d_1'));
    fireEvent.change(screen.getByTestId('input-delete-confirmation-d_1'), { target: { value: 'driver1' } });
    fireEvent.click(screen.getByTestId('button-confirm-delete'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
      expect(screen.getByText('End the active coach session, then try again.')).toBeInTheDocument();
      expect(screen.getByTestId('button-confirm-delete')).toBeEnabled();
      expect(invalidateSpy).toHaveBeenCalled();
    });
  });

  it('handles resetting driver password (restore access)', async () => {
    setupMockAuth(true, 'user_admin');
    
    (apiClient.useGetAdminAccess as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: { authorized: true },
    });

    (apiClient.useListAdminDrivers as Mock).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        drivers: [{ id: 'd_1', username: 'driver1', disabled: true }],
        nextOffset: null,
      },
    });

    (apiClient.resetAdminDriverAccess as Mock).mockResolvedValue({});

    renderWithProviders(<AdminDrivers />, historyParams);

    fireEvent.click(screen.getByTestId('button-reset-d_1'));
    expect(screen.getByText(/This will change the password for/)).toBeInTheDocument();
    
    fireEvent.change(screen.getByTestId('input-reset-password'), { target: { value: 'newpassword123' } });
    fireEvent.click(screen.getByTestId('button-submit-reset'));

    await waitFor(() => {
      expect(apiClient.resetAdminDriverAccess).toHaveBeenCalledWith('d_1', { password: 'newpassword123' });
    });
  });
});