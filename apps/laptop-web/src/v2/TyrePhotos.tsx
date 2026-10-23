// Tyre photos on the laptop (R5.8): thumbnails for each tyre set's photos,
// loaded from Cloud Storage. A photo still waiting on the phone's upload
// queue shows as "Not uploaded yet" instead of a broken image.

import { useEffect, useState } from 'react';
import { getFirebaseServices } from '@rnh/shared';
import { loadPhotoBlob } from '@rnh/shared/v2data';
import type { TyreSetV2 } from '@rnh/shared/v2';

type PhotoState = { path: string; url: string | null; missing: boolean };

/** Default loader; injectable for tests. */
export type UrlLoader = (path: string) => Promise<string>;

const defaultLoader: UrlLoader = async (path) => {
  const { firestore } = getFirebaseServices();
  const { bytes, contentType } = await loadPhotoBlob(firestore, path);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: contentType });
  return URL.createObjectURL(blob);
};

export function TyrePhotos({
  sets,
  load = defaultLoader,
}: {
  sets: TyreSetV2[];
  load?: UrlLoader;
}): JSX.Element | null {
  const withPhotos = sets.filter((t) => t.photoPaths.length > 0);
  const paths = withPhotos.flatMap((t) => t.photoPaths);
  const key = paths.join('|');
  const [photos, setPhotos] = useState<Record<string, PhotoState>>({});
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    for (const path of paths) {
      if (photos[path]?.url) continue;
      load(path)
        .then(
          (url) => active && setPhotos((p) => ({ ...p, [path]: { path, url, missing: false } })),
        )
        .catch(
          () => active && setPhotos((p) => ({ ...p, [path]: { path, url: null, missing: true } })),
        );
    }
    return () => {
      active = false;
    };
    // Reload only when the set of photo paths changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (withPhotos.length === 0) return null;

  return (
    <section className="l-card" aria-label="Tyre photos">
      <h3 className="l-card__title">Tyre photos</h3>
      {withPhotos.map((t) => (
        <div key={t.tyreSetId} className="l-photos">
          <p className="l-photos__label">
            {t.label || `Slot ${t.slot}`}
            {t.isReference ? <span className="l-tag">REF</span> : null}
          </p>
          <ul className="l-photos__list">
            {t.photoPaths.map((path, i) => {
              const st = photos[path];
              const alt = `${t.label || `Slot ${t.slot}`} photo ${i + 1}`;
              return (
                <li key={path}>
                  {st?.url ? (
                    <button
                      type="button"
                      className="l-photos__thumb"
                      onClick={() => setOpen(st.url)}
                      aria-label={`Open ${alt}`}
                    >
                      <img src={st.url} alt={alt} loading="lazy" />
                    </button>
                  ) : (
                    <span className="l-photos__pending">
                      {st?.missing ? 'Not uploaded yet' : 'Loading…'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {open ? (
        <div
          className="l-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          onClick={() => setOpen(null)}
        >
          <div className="l-dialog__panel l-photos__big" onClick={(e) => e.stopPropagation()}>
            <img src={open} alt="Tyre photo, full size" />
            <div className="l-row l-confirm__actions">
              <a className="l-btn" href={open} target="_blank" rel="noopener noreferrer">
                Open original
              </a>
              <button type="button" className="l-btn l-btn--primary" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
