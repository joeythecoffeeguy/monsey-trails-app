import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverSignIn, { getSignInLocalization } from './driver-sign-in';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  driverForm: vi.fn(),
}));

vi.mock('@clerk/react', () => ({
  SignIn: (props: unknown) => {
    mocks.signIn(props);
    return <div data-testid="prebuilt-sign-in">Prebuilt sign-in</div>;
  },
}));

vi.mock('@/components/driver-login-form', () => ({
  DriverLoginForm: () => {
    mocks.driverForm();
    return <div data-testid="driver-login-form">Driver login form</div>;
  },
}));

describe('DriverSignIn', () => {
  beforeEach(() => {
    mocks.signIn.mockReset();
    mocks.driverForm.mockReset();
    window.history.replaceState({}, '', '/sign-in');
  });

  afterEach(cleanup);

  it('links to protected administration alongside the passenger apps', () => {
    render(<DriverSignIn />);

    expect(screen.getByRole('navigation', { name: 'App links' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Admin — driver management' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: 'Passenger schedules — no login' })).toHaveAttribute('href', '/passengers');
  });

  it('renders Clerk login without social options for the admin redirect query', () => {
    window.history.replaceState({}, '', '/sign-in?redirect_url=%2Fadmin');
    render(<DriverSignIn />);

    expect(screen.getByRole('heading', { name: 'Administrator sign-in' })).toBeInTheDocument();
    expect(screen.getByTestId('prebuilt-sign-in')).toBeInTheDocument();
    expect(screen.queryByTestId('driver-login-form')).not.toBeInTheDocument();
    expect(mocks.signIn).toHaveBeenCalledWith(expect.objectContaining({
      routing: 'path',
      path: '/sign-in',
      forceRedirectUrl: '/admin',
      appearance: {
        elements: {
          rootBox: { width: '100%', minWidth: 0 },
          cardBox: { width: '100%', maxWidth: '380px' },
          socialButtons: { display: 'none' },
          socialButtonsBlockButton: { display: 'none' },
          socialButtonsIconButton: { display: 'none' },
          dividerRow: { display: 'none' },
          footerAction: { display: 'none' },
        },
      },
    }));
    expect(getSignInLocalization()).toEqual(expect.objectContaining({
      signIn: expect.objectContaining({
        start: expect.objectContaining({
          title: 'Continue to manage drivers',
          titleCombined: 'Continue to manage drivers',
        }),
      }),
    }));
  });

  it('returns an administrator to the mounted-display trip selector', () => {
    window.history.replaceState({}, '', '/sign-in?redirect_url=%2Fadmin%2Fdisplay');
    render(<DriverSignIn />);

    expect(screen.getByRole('heading', { name: 'Administrator sign-in' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to view current trips on this display.')).toBeInTheDocument();
    expect(mocks.signIn).toHaveBeenCalledWith(expect.objectContaining({
      forceRedirectUrl: '/admin/display',
    }));
    expect(getSignInLocalization().signIn.start.title).toBe('Continue to view current trips');
  });

  it.each([
    '/sign-in',
    '/sign-in?redirect_url=%2Fdrivers',
    '/sign-in?redirect_url=https%3A%2F%2Fexample.com%2Fadmin%2Fdrivers',
    '/sign-in?redirect_url=%2Fadmin%2Fdrivers-extra',
  ])('keeps driver-only login at %s', (path) => {
    window.history.replaceState({}, '', path);
    render(<DriverSignIn />);

    expect(screen.getByRole('heading', { name: 'Driver App' })).toBeInTheDocument();
    expect(screen.getByTestId('driver-login-form')).toBeInTheDocument();
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(getSignInLocalization().signIn.start.title).toBe('Driver Login');
  });

  it('retains the admin prebuilt screen on a direct continuation URL', () => {
    window.history.replaceState({}, '', '/sign-in/factor-one?redirect_url=%2Fadmin');
    render(<DriverSignIn />);

    expect(screen.getByRole('heading', { name: 'Administrator sign-in' })).toBeInTheDocument();
    expect(screen.getByTestId('prebuilt-sign-in')).toBeInTheDocument();
    expect(mocks.driverForm).not.toHaveBeenCalled();
    expect(mocks.signIn).toHaveBeenCalledWith(expect.objectContaining({
      appearance: expect.objectContaining({
        elements: expect.objectContaining({ socialButtons: { display: 'none' } }),
      }),
    }));
  });

  it('recognizes a legacy admin continuation but forces the canonical URL', () => {
    window.history.replaceState({}, '', '/sign-in/factor-one?redirect_url=%2Fadmin%2Fdrivers');
    render(<DriverSignIn />);

    expect(screen.getByRole('heading', { name: 'Administrator sign-in' })).toBeInTheDocument();
    expect(screen.getByTestId('prebuilt-sign-in')).toBeInTheDocument();
    expect(mocks.driverForm).not.toHaveBeenCalled();
    expect(mocks.signIn).toHaveBeenCalledWith(expect.objectContaining({
      forceRedirectUrl: '/admin',
    }));
  });
});