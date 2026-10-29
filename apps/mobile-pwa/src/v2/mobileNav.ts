// Hardware / gesture Back for the installed PWA. Without this, Android's Back
// leaves the app from any screen. Each screen has a parent; Back goes there,
// and only Back on Home leaves the app (like a native app).

export type MobileRoute =
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'setup' | 'drive' | 'overview' | 'summary'; sessionId: string };

/** How deep a screen sits; deeper screens slide in from the right. */
export function screenDepth(route: MobileRoute): number {
  switch (route.name) {
    case 'home':
    case 'settings':
      return 0;
    case 'setup':
    case 'summary':
      return 1;
    case 'drive':
      return 2;
    case 'overview':
      return 3;
  }
}

export type ScreenMotion = 'none' | 'forward' | 'back' | 'fade';

/** Animation for moving between two screens (native push / pop feel). */
export function transitionFor(from: MobileRoute | null, to: MobileRoute): ScreenMotion {
  if (!from || from.name === to.name) return 'none';
  const a = screenDepth(from);
  const b = screenDepth(to);
  if (b > a) return 'forward';
  if (b < a) return 'back';
  return 'fade';
}

/** Screen that Back returns to, or null on Home (Back leaves the app). */
export function parentOf(route: MobileRoute): MobileRoute | null {
  switch (route.name) {
    case 'home':
      return null;
    case 'settings':
    case 'setup':
    case 'summary':
      return { name: 'home' };
    case 'drive':
      // Same place the Drive screen's own exit goes.
      return { name: 'summary', sessionId: route.sessionId };
    case 'overview':
      return { name: 'drive', sessionId: route.sessionId };
  }
}
