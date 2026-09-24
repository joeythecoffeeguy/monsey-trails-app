import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverLoginForm } from './driver-login-form';

const clerk = vi.hoisted(() => {
  const resource = {
    create: vi.fn(),
    password: vi.fn(),
    finalize: vi.fn(),
    reset: vi.fn(),
    supportedFirstFactors: [] as Array<{ strategy: string }>,
    status: null as string | null,
  };
  return {
    resource,
    fetchStatus: 'idle',
    auth: { isLoaded: true, isSignedIn: false },
    session: null as null | { currentTask: { key: string } },
    signInProps: vi.fn(),
  };
});

vi.mock('@clerk/react', () => ({
  useSignIn: () => ({ signIn: clerk.resource, fetchStatus: clerk.fetchStatus }),
  useAuth: () => clerk.auth,
  useSession: () => ({ session: clerk.session }),
  SignIn: (props: unknown) => {
    clerk.signInProps(props, window.location.pathname);
    return <div data-testid="clerk-sign-in">Clerk sign-in continuation</div>;
  },
}));

function passwordFactor() {
  clerk.resource.supportedFirstFactors.splice(0, clerk.resource.supportedFirstFactors.length, {
    strategy: 'password',
  });
}

async function continueWith(username = 'driver.one') {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByLabelText('Password');
}

beforeEach(() => {
  clerk.resource.create.mockReset().mockResolvedValue({ error: null });
  clerk.resource.password.mockReset().mockResolvedValue({ error: null });
  clerk.resource.finalize.mockReset().mockResolvedValue({ error: null });
  clerk.resource.reset.mockReset().mockResolvedValue({ error: null });
  clerk.resource.supportedFirstFactors.splice(0);
  clerk.resource.status = null;
  clerk.fetchStatus = 'idle';
  clerk.auth.isLoaded = true;
  clerk.auth.isSignedIn = false;
  clerk.session = null;
  clerk.signInProps.mockReset();
  window.history.replaceState({}, '', '/sign-in');
});

afterEach(cleanup);

describe('DriverLoginForm', () => {
  it('starts with username only and does not offer Google or email sign-in', () => {
    render(<DriverLoginForm />);

    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('clerk-sign-in')).not.toBeInTheDocument();
  });

  it('keeps a trailing slash on the initial page in the username-only flow', () => {
    window.history.replaceState({}, '', '/sign-in/');
    render(<DriverLoginForm />);
    expect(screen.getByLabelText('Username')).toBeInTheDocument();
    expect(screen.queryByTestId('clerk-sign-in')).not.toBeInTheDocument();
  });

  it('looks up the provider before asking Clerk to check the password', async () => {
    passwordFactor();
    render(<DriverLoginForm />);

    await continueWith('driver.one');
    expect(clerk.resource.create).toHaveBeenCalledWith({
      identifier: 'driver.one',
      signUpIfMissing: false,
    });
    expect(clerk.resource.password).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(clerk.resource.password).toHaveBeenCalledWith({ password: 'secret-password' }));
    expect(clerk.resource.create.mock.invocationCallOrder[0])
      .toBeLessThan(clerk.resource.password.mock.invocationCallOrder[0]);
  });

  it('shows the original access denial and driver phone number for an unknown identifier', async () => {
    clerk.resource.create.mockResolvedValue({
      error: { errors: [{ code: 'form_identifier_not_found' }] },
    });
    render(<DriverLoginForm />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'unknown.driver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(
      'This account has not been provisioned for driver access. Contact an administrator.',
    )).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Driver access unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '845-510-5101' })).toHaveAttribute('href', 'tel:+18455105101');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('keeps the password step available after an incorrect password', async () => {
    passwordFactor();
    clerk.resource.password.mockResolvedValue({
      error: { errors: [{ code: 'form_password_incorrect' }] },
    });
    render(<DriverLoginForm />);
    await continueWith();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Incorrect password. Please try again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('resets the Clerk attempt and password step when changing usernames', async () => {
    passwordFactor();
    render(<DriverLoginForm />);
    await continueWith('first.driver');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not-retained' } });

    fireEvent.click(screen.getByRole('button', { name: 'Use a different username' }));

    await waitFor(() => expect(clerk.resource.reset).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    const username = screen.getByLabelText('Username');
    expect(username).not.toHaveAttribute('readonly');
    fireEvent.change(username, { target: { value: 'second.driver' } });
    expect(username).toHaveValue('second.driver');
  });

  it('does not mislabel a network failure as an unknown driver', async () => {
    clerk.resource.create.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<DriverLoginForm />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'driver.one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(
      'Could not sign in. Check your connection and try again. If this continues, please call for help.',
    )).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Driver access unavailable' })).not.toBeInTheDocument();
  });

  it('finalizes a completed password sign-in', async () => {
    passwordFactor();
    clerk.resource.status = 'complete';
    render(<DriverLoginForm />);
    await continueWith();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(clerk.resource.finalize).toHaveBeenCalledTimes(1));
    expect(clerk.resource.finalize).toHaveBeenCalledWith({ navigate: expect.any(Function) });
  });

  it('hands an MFA attempt to Clerk SignIn without finalizing or bypassing it', async () => {
    passwordFactor();
    clerk.resource.password.mockImplementation(async () => {
      clerk.resource.status = 'needs_second_factor';
      return { error: null };
    });
    render(<DriverLoginForm />);
    await continueWith();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByTestId('clerk-sign-in')).toBeInTheDocument();
    expect(clerk.resource.finalize).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(clerk.signInProps).toHaveBeenCalledWith(expect.objectContaining({
      routing: 'path',
      forceRedirectUrl: '/drivers',
    }), '/sign-in/factor-two');
    expect(clerk.signInProps.mock.calls.every(([, path]) => path === '/sign-in/factor-two')).toBe(true);
  });

  it.each([
    ['needs_second_factor', '/sign-in/factor-two'],
    ['needs_new_password', '/sign-in/reset-password'],
    ['needs_client_trust', '/sign-in/client-trust'],
  ])(
    'restores %s at its continuation route when the page remounts',
    async (status, path) => {
      clerk.resource.status = status;
      const firstPage = render(<DriverLoginForm />);
      expect(await screen.findByTestId('clerk-sign-in')).toBeInTheDocument();
      expect(window.location.pathname).toBe(path);
      expect(clerk.signInProps.mock.calls.every(([, mountedPath]) => mountedPath === path)).toBe(true);
      firstPage.unmount();

      render(<DriverLoginForm />);
      expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();
      expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
      expect(clerk.resource.create).not.toHaveBeenCalled();
      expect(clerk.resource.finalize).not.toHaveBeenCalled();
    },
  );

  it('routes a correct password requiring device trust to the existing Clerk attempt', async () => {
    passwordFactor();
    clerk.resource.password.mockImplementation(async () => {
      clerk.resource.status = 'needs_client_trust';
      return { error: null };
    });
    render(<DriverLoginForm />);
    await continueWith();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByTestId('clerk-sign-in')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/sign-in/client-trust');
    expect(clerk.signInProps.mock.calls.every(([, path]) => path === '/sign-in/client-trust')).toBe(true);
    expect(clerk.resource.reset).not.toHaveBeenCalled();
    expect(clerk.resource.finalize).not.toHaveBeenCalled();
    expect(clerk.resource.create).toHaveBeenCalledTimes(1);
  });

  it.each(['/sign-in/factor-two', '/sign-in/client-trust', '/sign-in/reset-password', '/sign-in/verify'])(
    'preserves the Clerk continuation at %s while its resource loads',
    (path) => {
      window.history.replaceState({}, '', path);
      clerk.auth.isLoaded = false;
      render(<DriverLoginForm />);
      expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();
      expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
      expect(window.location.pathname).toBe(path);
      expect(clerk.resource.finalize).not.toHaveBeenCalled();
    },
  );

  it('does not send a restored session with an outstanding task to the console', () => {
    clerk.auth.isSignedIn = true;
    clerk.session = { currentTask: { key: 'choose-organization' } };
    render(<DriverLoginForm />);
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/sign-in');
  });

  it('hands session tasks returned by finalization to Clerk', async () => {
    passwordFactor();
    clerk.resource.status = 'complete';
    const decorateUrl = vi.fn((url: string) => url);
    clerk.resource.finalize.mockImplementation(async ({ navigate }) => {
      navigate({ session: { currentTask: { key: 'choose-organization' } }, decorateUrl });
      return { error: null };
    });
    render(<DriverLoginForm />);
    await continueWith();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByTestId('clerk-sign-in')).toBeInTheDocument();
    expect(decorateUrl).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/sign-in');
  });
});