// Team directory (laptop "Assign testers"). Report_Viewers may list users/*
// (firestore.rules); the docs hold only uid, email, display name and roles.

import { collection, getDocs, type Firestore } from 'firebase/firestore';
import { getFirebaseServices } from '../firebase/app';
import type { AppUser } from '../v2/model';
import { rolesFromDoc } from './auth';

export async function listTeamV2(firestore?: Firestore): Promise<AppUser[]> {
  const fs = firestore ?? getFirebaseServices().firestore;
  const snap = await getDocs(collection(fs, 'users'));
  return snap.docs
    .map((d) => {
      const data = d.data() as Record<string, unknown>;
      const email = String(data.email ?? '');
      return {
        uid: d.id,
        email,
        displayName: String(data.displayName ?? '') || email || d.id,
        roles: rolesFromDoc(data),
      };
    })
    .filter((u) => u.roles.length > 0)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
