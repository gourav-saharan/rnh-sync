// TyrePhotos: thumbnails load via the injected loader; photos not yet
// uploaded from the phone show a clear placeholder instead of a broken image.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TyreSetV2 } from '@rnh/shared/v2';
import { TyrePhotos } from './TyrePhotos';

function set(label: string, photoPaths: string[]): TyreSetV2 {
  return {
    tyreSetId: `t_${label}`,
    slot: 1,
    isReference: false,
    label,
    make: '',
    pattern: '',
    size: '',
    srlr: '',
    weekCode: '',
    dot: '',
    compound: '',
    airTempC: null,
    roadTempC: null,
    overallComment: '',
    photoPaths,
  };
}

describe('TyrePhotos', () => {
  it('renders nothing when no tyre set has photos', () => {
    const { container } = render(<TyrePhotos sets={[set('MU1', [])]} load={async () => 'x'} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows loaded thumbnails and a placeholder for photos not uploaded yet', async () => {
    const load = async (path: string) => {
      if (path.endsWith('missing.jpg')) throw new Error('object-not-found');
      return `https://example.test/${path}`;
    };
    render(
      <TyrePhotos
        sets={[set('MU1', ['sessions/s/photos/ok.jpg', 'sessions/s/photos/missing.jpg'])]}
        load={load}
      />,
    );
    expect(await screen.findByRole('img', { name: 'MU1 photo 1' })).toBeInTheDocument();
    expect(await screen.findByText('Not uploaded yet')).toBeInTheDocument();
  });
});
