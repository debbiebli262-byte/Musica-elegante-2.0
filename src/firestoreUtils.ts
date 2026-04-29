import { auth, db } from './firebase';
import { FirestoreErrorInfo } from './types';
import { collection, query, where, getDocs, doc, setDoc } from 'firebase/firestore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email ?? undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId ?? undefined,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName ?? '',
        email: provider.email ?? '',
        photoUrl: provider.photoURL ?? ''
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  return errInfo;
}

export async function getArtistByName(name: string) {
  const artistsRef = collection(db, 'artists');
  const q = query(artistsRef, where('name', '==', name));
  const snapshot = await getDocs(q);

  if (!snapshot.empty) {
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
  }

  return null;
}

export async function saveArtistData(id: string, data: any) {
  await setDoc(doc(db, 'artists', id), data, { merge: true });
}
