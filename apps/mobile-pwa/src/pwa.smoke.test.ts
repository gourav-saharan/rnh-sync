// Smoke tests for the Mobile_PWA installability + offline app-shell config.
//
// These are example-based smoke tests (not property tests). They verify the
// two things that make the app installable and offline-capable per
// Requirement 4:
//
//   - A valid, installable Web App Manifest is emitted with the required
//     fields (name/short_name, start_url, display: 'standalone', theme/
//     background colors, and 192 + 512 icons).  -- R4.1, R4.2
//   - The Workbox service worker precaches the app shell (index.html /
//     navigateFallback plus the built JS/CSS assets) so the capture UI can
//     open and run with no network.  -- R4.3
//
// The tests assert on the real production build artifacts (dist/) rather than
// mocks, so they exercise the actual VitePWA/Workbox output. The build is run
// once (and reused if a fresh dist already exists) in `beforeAll`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(appRoot, 'dist');
const manifestPath = path.join(distDir, 'manifest.webmanifest');
const swPath = path.join(distDir, 'sw.js');

function distArtifactsPresent(): boolean {
  return existsSync(manifestPath) && existsSync(swPath);
}

// Build once for the whole suite. If the artifacts are missing we run the
// production build; otherwise we reuse the existing dist to keep the test fast.
beforeAll(() => {
  if (distArtifactsPresent()) {
    return;
  }
  execFileSync('npm', ['run', 'build'], {
    cwd: appRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}, 180_000);

interface WebAppManifest {
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  theme_color?: string;
  background_color?: string;
  icons?: Array<{ src: string; sizes: string; type?: string; purpose?: string }>;
}

function readManifest(): WebAppManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as WebAppManifest;
}

function readServiceWorker(): string {
  return readFileSync(swPath, 'utf-8');
}

// The precache manifest is inlined into sw.js as `precacheAndRoute([...])`.
// Pull the `url` values out so we can assert the app shell is covered.
function precachedUrls(sw: string): string[] {
  // Matches both minified (`url:"x"`) and unminified (`"url": "x"`) output.
  return [...sw.matchAll(/"?url"?\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
}

describe('Mobile_PWA web app manifest (R4.1, R4.2)', () => {
  it('emits a manifest file in the build output', () => {
    expect(existsSync(manifestPath)).toBe(true);
  });

  it('is valid JSON with the required identity fields', () => {
    const manifest = readManifest();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    // start_url is required for the browser to offer installation.
    expect(manifest.start_url).toBeTruthy();
  });

  it('declares standalone display so it launches without browser chrome', () => {
    const manifest = readManifest();
    expect(manifest.display).toBe('standalone');
  });

  it('defines theme and background colors for the installed splash/chrome', () => {
    const manifest = readManifest();
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.background_color).toBeTruthy();
  });

  it('includes the 192px and 512px icons required for installability', () => {
    const manifest = readManifest();
    const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    // Every icon must at least declare a source path.
    for (const icon of manifest.icons ?? []) {
      expect(icon.src).toBeTruthy();
    }
  });
});

describe('Mobile_PWA service worker precache (R4.3)', () => {
  it('emits a service worker file in the build output', () => {
    expect(existsSync(swPath)).toBe(true);
    expect(statSync(swPath).size).toBeGreaterThan(0);
  });

  it('registers a Workbox precache list', () => {
    const sw = readServiceWorker();
    expect(sw).toContain('precacheAndRoute');
  });

  it('precaches the app shell HTML (index.html)', () => {
    const urls = precachedUrls(readServiceWorker());
    expect(urls).toContain('index.html');
  });

  it('serves index.html as the offline navigation fallback', () => {
    const sw = readServiceWorker();
    // Workbox wires navigateFallback via a NavigationRoute bound to index.html.
    expect(sw).toContain('NavigationRoute');
    expect(sw).toContain('createHandlerBoundToURL("index.html")');
  });

  it('precaches the built JS/CSS assets so the shell runs offline', () => {
    const urls = precachedUrls(readServiceWorker());
    const scriptAssets = urls.filter((url) => url.endsWith('.js') || url.endsWith('.css'));
    expect(scriptAssets.length).toBeGreaterThan(0);
    // The main app bundle lives under assets/.
    expect(urls.some((url) => url.startsWith('assets/'))).toBe(true);
  });
});
