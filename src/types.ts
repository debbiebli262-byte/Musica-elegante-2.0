export type Genre = 'jazz' | 'classical';

export interface Artist {
  id: string;
  name: string;
  biography?: string;
  imageUrl?: string;
  genre: Genre;
  birthDate?: string; // YYYY-MM-DD
  deathDate?: string; // YYYY-MM-DD
  birthPlace?: string; // City, Country
  deathPlace?: string; // City, Country
  instruments?: string[]; // e.g., ['Trumpet', 'Piano']
  periods?: string[]; // e.g., ['Bebop', 'Hard Bop'] (for jazz) or ['Baroque'] (for classical)
}

export interface Musician {
  name: string;
  instrument: string;
  notes?: string;
}

export interface Soloist {
  name: string;
  instrument: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
}

export interface Movement {
  trackNumber: number;
  title: string;
  duration: string;
  side?: 'A' | 'B';
  notes?: string;
}

export interface Work {
  title: string;
  composer?: string; // Optional if different from main artist
  compositionDate?: string;
  compositionPlace?: string;
  orchestra?: string;
  conductor?: string;
  soloists?: Soloist[];
  foundationDate?: string;
  foundationPlace?: string;
  founderName?: string;
  choirMaster?: string;
  movements: Movement[];
}

export interface Disc {
  discNumber: number;
  title?: string;
  works: Work[];
}

export interface Track {
  trackNumber: number;
  discNumber?: number;
  title: string;
  duration: string;
  side?: 'A' | 'B';
  notes?: string;
  orchestra?: string;
  conductor?: string;
  soloists?: Soloist[];
  compositionDate?: string;
  compositionPlace?: string;
  foundationDate?: string;
  foundationPlace?: string;
  founderName?: string;
  choirMaster?: string;
}

export interface Album {
  id: string;
  artistId: string;
  artistName?: string;
  sidemenIds?: string[]; // IDs of artists who are sidemen on this album
  allArtistIds?: string[]; // All artist IDs linked to this album (for shared/compilation albums)
  title: string;
  releaseYear?: string;
  imageUrl?: string;
  genre: Genre;
  
  // New fields
  availability?: string;
  recordingDates?: string;
  releaseDate?: string;
  location?: string;
  label?: string;
  catalogNumber?: string;
  originalCatalogNumber?: string;
  editionCatalogNumber?: string;
  editionDate?: string;
  masteringEngineer?: string;
  discCount?: number;
  formats?: ('CD' | 'Vinilo' | 'DVD' | 'Bluray')[];
  orchestra?: string;
  conductor?: string;
  soloists?: Soloist[];
  compositionDate?: string;
  compositionPlace?: string;
  country?: string;
  originalLabel?: string;
  originalYear?: string;
  foundationDate?: string;
  foundationPlace?: string;
  founderName?: string;
  choirMaster?: string;
  engineer?: string;
  producer?: string;
  musicians?: Musician[];
  tracks?: Track[]; // Kept for Jazz
  discs?: Disc[]; // Added for Classical
  anecdotes?: string;
}

export interface CollectionItem {
  id: string;
  userId: string;
  albumId: string;
  status: 'owned' | 'wishlist';
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string;
    providerInfo: {
      providerId: string;
      displayName: string;
      email: string;
      photoUrl: string;
    }[];
  }
}
