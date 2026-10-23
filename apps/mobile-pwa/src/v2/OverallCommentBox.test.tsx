// OverallCommentBox follows remote updates unless the Tester is typing, and
// commits trimmed text on blur. filterSessions powers the Home search.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LocalTestSessionV2 } from '@rnh/shared/v2';
import { OverallCommentBox } from './Summary';
import { filterSessions } from './Home';

describe('OverallCommentBox', () => {
  it('shows a remote change while not focused', () => {
    const { rerender } = render(<OverallCommentBox value="old" onCommit={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('old');
    rerender(<OverallCommentBox value="from laptop" onCommit={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('from laptop');
  });

  it('keeps local typing when a remote change arrives, and commits on blur', async () => {
    const onCommit = vi.fn();
    const { rerender } = render(<OverallCommentBox value="" onCommit={onCommit} />);
    const box = screen.getByRole('textbox');
    await userEvent.click(box);
    await userEvent.type(box, '  good grip ');
    rerender(<OverallCommentBox value="from laptop" onCommit={onCommit} />);
    expect(box).toHaveValue('  good grip ');
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledWith('good grip');
  });
});

describe('filterSessions', () => {
  const mk = (id: string, customer: string, vehicle: string, make: string) =>
    ({
      sessionId: id,
      customerName: customer,
      templateName: 'R&H',
      header: { h_test_vehicle: vehicle },
      tyreSets: { t1: { label: 'A', make, pattern: 'P1' } },
    }) as unknown as LocalTestSessionV2;
  const list = [mk('1', 'M&M', 'XUV700', 'MRF'), mk('2', 'MSIL', 'Brezza', 'Apollo')];

  it('returns everything for an empty query', () => {
    expect(filterSessions(list, '  ')).toHaveLength(2);
  });

  it('matches customer, header values and tyre make case-insensitively', () => {
    expect(filterSessions(list, 'msil').map((s) => s.sessionId)).toEqual(['2']);
    expect(filterSessions(list, 'xuv').map((s) => s.sessionId)).toEqual(['1']);
    expect(filterSessions(list, 'APOLLO').map((s) => s.sessionId)).toEqual(['2']);
    expect(filterSessions(list, 'nothing')).toHaveLength(0);
  });
});
