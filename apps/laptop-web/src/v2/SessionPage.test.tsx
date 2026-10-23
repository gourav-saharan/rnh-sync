// SessionPage never leaves the user stuck when the test is missing or unreadable.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppUser } from '@rnh/shared/v2';
import type { AuthServiceV2, SessionStoreV2, TemplateStoreV2 } from '@rnh/shared/v2data';
import { LaptopProvider } from './context';
import { SessionPage } from './SessionPage';

const user: AppUser = { uid: 'v', email: 'v@x.com', displayName: 'V', roles: ['Report_Viewer'] };

function renderWith(subscribeOne: SessionStoreV2['subscribeOne'], onBack = vi.fn()) {
  const sessions = { subscribeOne } as unknown as SessionStoreV2;
  render(
    <LaptopProvider
      user={user}
      auth={{} as AuthServiceV2}
      sessions={sessions}
      templates={{} as TemplateStoreV2}
    >
      <SessionPage sessionId="s1" onBack={onBack} />
    </LaptopProvider>,
  );
  return onBack;
}

describe('SessionPage missing test', () => {
  it('offers a way back when the test no longer exists', async () => {
    const onBack = renderWith((_sid, cb) => {
      cb(null);
      return () => {};
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer exists/i);
    await userEvent.click(screen.getByRole('button', { name: /back to tests/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows the read error instead of claiming the test is gone', async () => {
    renderWith((_sid, _cb, onError) => {
      onError?.(new Error('Missing or insufficient permissions.'));
      return () => {};
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not load this test.*permission/i,
    );
  });
});
