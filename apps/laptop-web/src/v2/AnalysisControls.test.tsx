// Analysis controls: filters render with visible labels, segmented choices
// act as radios, the weights checkbox is disabled for parameter rows, and the
// empty-state message explains the real reason.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ANALYSIS } from '@rnh/shared/v2';
import { AnalysisControls } from './AnalysisControls';
import { emptyMessage, hasFilters } from './AnalysisPage';

const choices = {
  customers: ['M&M', 'MSIL'],
  templates: [{ id: 't1', label: 'M&M · U171' }],
  testers: ['Asha'],
};

describe('AnalysisControls', () => {
  it('labels every filter and switches segmented options', async () => {
    const onChange = vi.fn();
    render(
      <AnalysisControls
        opts={DEFAULT_ANALYSIS}
        choices={choices}
        onChange={onChange}
        onReset={() => {}}
      />,
    );
    for (const l of [
      'Customer',
      'Template',
      'Tester',
      'Status',
      'Test date from',
      'Test date to',
      'Tyre contains',
    ]) {
      expect(screen.getByLabelText(l)).toBeInTheDocument();
    }
    const rows = screen.getByRole('radiogroup', { name: 'Rows' });
    expect(rows.querySelector('[aria-checked="true"]')).toHaveTextContent('Categories');
    await userEvent.click(screen.getByRole('radio', { name: 'Parameters' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ level: 'parameter' }));
  });

  it('disables weights for parameter rows', () => {
    render(
      <AnalysisControls
        opts={{ ...DEFAULT_ANALYSIS, level: 'parameter' }}
        choices={choices}
        onChange={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /template weights/ })).toBeDisabled();
  });
});

describe('Analysis empty state', () => {
  it('distinguishes no tests, no ratings and narrow filters', () => {
    expect(hasFilters(DEFAULT_ANALYSIS)).toBe(false);
    expect(
      hasFilters({ ...DEFAULT_ANALYSIS, filter: { includeReference: true, customer: 'MSIL' } }),
    ).toBe(true);
    expect(emptyMessage(0, false, 'rating')).toMatch(/No tests to analyse/);
    expect(emptyMessage(3, false, 'rating')).toMatch(/none has any ratings/);
    expect(emptyMessage(3, true, 'rating')).toMatch(/clear some filters/);
    expect(emptyMessage(3, false, 'diffToRef')).toMatch(/Reference/);
  });
});
