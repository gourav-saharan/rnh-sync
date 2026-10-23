// Tests for the Laptop_Web_App SignIn screen's Register toggle.
//
// The screen offers self-service registration: toggling into Register mode
// reveals a confirm-password field and, on submit, calls signUp with the
// Laptop_Web_App's own role (Report_Viewer).

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuthService, Role } from '@rnh/shared';
import { SignIn } from './SignIn';

function makeService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    signIn: vi.fn(async () => ({ uid: 'u', email: 'u@example.com', role: 'Report_Viewer' as Role })),
    signUp: vi.fn(async () => ({ uid: 'u', email: 'u@example.com', role: 'Report_Viewer' as Role })),
    signOut: vi.fn(async () => {}),
    currentUser: () => null,
    onAuthChange: () => () => {},
    ...overrides,
  } as AuthService;
}

describe('Laptop_Web_App SignIn register mode', () => {
  it('starts in sign-in mode and offers a Create account toggle', () => {
    render(<SignIn authService={makeService()} />);
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument();
  });

  it('switches to register mode, revealing the confirm-password field', async () => {
    const user = userEvent.setup();
    render(<SignIn authService={makeService()} />);

    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
  });

  it('calls signUp with the Report_Viewer role on register submit', async () => {
    const user = userEvent.setup();
    const signUp = vi.fn(async () => ({ uid: 'u', email: 'new@example.com', role: 'Report_Viewer' as Role }));
    render(<SignIn authService={makeService({ signUp })} />);

    await user.click(screen.getByRole('button', { name: /create account/i }));
    await user.type(screen.getByLabelText(/^email$/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'sup3rsecret');
    await user.type(screen.getByLabelText(/confirm password/i), 'sup3rsecret');
    await user.click(screen.getByRole('button', { name: /^create account$/i }));

    expect(signUp).toHaveBeenCalledWith('new@example.com', 'sup3rsecret', 'Report_Viewer');
  });

  it('blocks submit and warns when passwords do not match', async () => {
    const user = userEvent.setup();
    const signUp = vi.fn(async () => ({ uid: 'u', email: 'new@example.com', role: 'Report_Viewer' as Role }));
    render(<SignIn authService={makeService({ signUp })} />);

    await user.click(screen.getByRole('button', { name: /create account/i }));
    await user.type(screen.getByLabelText(/^email$/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^password$/i), 'sup3rsecret');
    await user.type(screen.getByLabelText(/confirm password/i), 'different');
    await user.click(screen.getByRole('button', { name: /^create account$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/do not match/i);
    expect(signUp).not.toHaveBeenCalled();
  });
});
