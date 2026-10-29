// Which roles may use the Laptop_Web_App at all (R1.5, R1.6).
import { hasRole, type AppUser } from '@rnh/shared/v2';

/** True when the user holds Report_Viewer or Template_Admin. */
export function hasOfficeRole(user: Pick<AppUser, 'roles'>): boolean {
  return hasRole(user, 'Report_Viewer') || hasRole(user, 'Template_Admin');
}

export type LaptopSection = 'tests' | 'analysis' | 'templates' | 'trash';

/**
 * Sections this user may open (R1.5, R1.6). Tests, Analysis and Trash are
 * Report_Viewer work. Templates is Template_Admin work; Report_Viewer keeps it
 * while firestore.rules still let them write templates (decision D5 open).
 * Order is the tab order; the first entry is the user's home section.
 */
export function visibleSections(user: Pick<AppUser, 'roles'>): LaptopSection[] {
  const viewer = hasRole(user, 'Report_Viewer');
  const admin = hasRole(user, 'Template_Admin');
  const out: LaptopSection[] = [];
  if (viewer) out.push('tests', 'analysis');
  if (viewer || admin) out.push('templates');
  if (viewer) out.push('trash');
  return out;
}

/** Section a route belongs to (a session lives under Tests, a template under Templates). */
export function sectionOf(
  name: LaptopSection | 'session' | 'template',
): LaptopSection {
  if (name === 'session') return 'tests';
  if (name === 'template') return 'templates';
  return name;
}
