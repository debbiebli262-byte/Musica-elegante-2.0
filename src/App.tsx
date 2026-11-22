import React, { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, getDocFromServer, getDocs, runTransaction } from 'firebase/firestore';
import { signInWithPopup, signInWithEmailAndPassword, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { ref, uploadString, getDownloadURL, uploadBytes } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { db, storage, auth } from './firebase';
import { Artist, Album, CollectionItem, Genre, Musician, Track, Disc, Work, Movement } from './types';
import { OperationType, handleFirestoreError, getArtistByName, saveArtistData } from './firestoreUtils';
import { fetchArtistDiscography } from './services/discographyService';
import { fetchArtistMetadata } from './services/artistService';
import { findArtistPortrait, useArtistPortrait } from './services/artistImages';
import { normalizeRecordLabels } from './utils/recordLabels';
import { editorSelloOptions } from './utils/editorSelloOptions';
import { wordAlbumCandidates, sameWordEdition, normalizedEditionKey, type WordAlbumCandidate } from './utils/wordImportAlbums';
import { makeReview, editReviewField, reviewDiscogsMatch, resolveReviewConflict, applyDiscogsReviewField, applyDiscogsReviewExtras, pendingReviewConflicts, normalizePhysicalFormat, splitReviewedWorks, fileBackupFilename, type ReviewedEdition, type ReviewField } from './utils/wordImportReview';
import { discogsPhysicalFormat, matchingDiscogsEditions, type DiscogsEditionCandidate } from './utils/discogsEdition';
import { buildManualEdition, manualEditionIdentity } from './utils/manualDiscogsEdition';
import { makeDiscogsEditPreview, pickDiscogsChanges, DISCOGS_EDIT_FIELDS, type DiscogsEditPreview, type DiscogsEditKey } from './utils/discogsEditReview';
import { groupArtistAlbums, uniqueCollectionItems, linkedArtistIds } from './utils/albumLinks';
import { validateAlbumSave, artistNameUpdate } from './utils/albumSaveValidation';
import { inspectCatalog, serializeCatalogBackup } from './utils/catalogMaintenance';
import { getCatalogRecordType, type CatalogRecordType } from './utils/catalogRecordType';
import { proposeVerifiedTracklists, isVerifiedTracklistStillApplicable, type VerifiedTracklistProposal } from './utils/verifiedTracklists';
import { proposeArtistRepairs, isRepairStillApplicable, type ArtistRepair } from './utils/artistRepairs';
import { privateApiFetch } from './services/privateApi';
import { motion, AnimatePresence } from 'motion/react';
import { Music, Disc as DiscIcon, Heart, User as UserIcon, LogIn, LogOut, Plus, Edit2, Trash2, X, Save, ChevronRight, Info, Calendar, LayoutGrid, List, ArrowDownAZ, Upload, Users, Music2, PlusCircle, MinusCircle, Clock, Globe, Building2, Hash, UserCheck, Settings, FileText, Menu } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Connection Test ---
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}


function slugifyArtistId(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function slugifyAlbumId(
  artistName: string,
  title: string,
  releaseYear?: string,
  catalogNumber?: string
) {
  return `${artistName}-${title}-${releaseYear || ''}-${catalogNumber || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

type ImportStatus = 'draft' | 'approved' | 'failed';

interface ServerRecording {
  section?: string;
  workTitle?: string;
  workSubtitle?: string;
  opus?: string;
  compositionDate?: string;
  premiereDate?: string;
  performers?: string[];
  soloists?: string[];
  orchestra?: string;
  conductor?: string;
  choir?: string;
  recordingDate?: string;
  recordingLocation?: string;
  albumTitle?: string;
  albumSubtitle?: string;
  label?: string;
  catalogNumber?: string;
  barcode?: string;
  format?: string;
  editionYear?: string;
  country?: string;
  notes?: string;
  discNumber?: number;
}

interface ServerComposer {
  name?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  biography?: string;
  nationality?: string;
}

interface ParsedWordImport {
  rawText?: string;
  // Legacy client-side fields
  artist?: Partial<Artist>;
  albums?: WordAlbumCandidate[];
  notes?: string[];
  // Actual server response fields
  composer?: ServerComposer;
  recordings?: ServerRecording[];
  warnings?: string[];
  sourceFileName?: string;
  sourceType?: 'structured-word' | 'ai-chunks';
  chunkCount?: number;
}

interface ImportJobRecord {
  id: string;
  fileName: string;
  createdAt?: string;
  status: ImportStatus;
  extractedData?: ParsedWordImport;
  approvedAt?: string;
  source?: string;
  importGenre?: Genre;
  reviewedEditions?: ReviewedEdition[];
  dataUrl?: string;
  completedAlbumIds?: string[];
  storagePath?: string;
  fileUrl?: string;
}


// --- Components ---
const PROMPT_TEXT = `Estoy construyendo un sitio web que importa archivos de Word de una biblioteca de música clásica (álbumes, obras, grabaciones, intérpretes, etc.).

Quiero que reorganices el archivo que te adjunto para que sea muy fácil de leer para un sistema y para una IA.

Importante:
- No elimines ninguna información del archivo original
- No inventes información nueva
- Conserva todos los detalles: intérpretes, orquesta, director, fechas, álbumes, números de catálogo, sello, formato, etc.

Objetivo:
Convertir el contenido en un formato fijo, claro y consistente, para que cada grabación tenga siempre la misma estructura.

Quiero este formato exacto:

COMPOSER
Name:
Birth Date:
Birth Place:
Death Date:
Death Place:
Nationality:
Biography:

Y después, para cada grabación:

RECORDING
Section:
Work Title:
Work Subtitle:
Opus:
Composition Date:
Premiere Date:
Soloists:
Performers:
Orchestra:
Conductor:
Choir:
Recording Date:
Recording Location:

Album Title:
Label:
Catalog Number:
Format:
Edition Year:
Country:
Notes:

Cada RECORDING debe estar en un bloque separado.

Todo el contenido debe estar organizado como field: value.

Importante:
- Si un campo no existe, déjalo vacío
- Si hay varios intérpretes, sepáralos por comas
- No dejes texto libre fuera de los campos
- No omitas ningún detalle del archivo original

Al final, devuélveme únicamente el texto reorganizado, sin explicaciones adicionales.`;

function Navbar() {
  const location = useLocation();
  const { logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [readerMode, setReaderMode] = useState(() => {
    try { return window.localStorage.getItem('musica-elegante-reader-mode') === 'large'; }
    catch { return false; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('reader-mode', readerMode);
    try { window.localStorage.setItem('musica-elegante-reader-mode', readerMode ? 'large' : 'standard'); }
    catch { /* Private browsing can disable storage. */ }
    return () => document.documentElement.classList.remove('reader-mode');
  }, [readerMode]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const navItems = [
    { name: 'Inicio', path: '/' },
    { name: 'Jazz', path: '/jazz' },
    { name: 'Clásica', path: '/classical' },
    { name: 'Mi Colección', path: '/collection' },
    { name: 'Importar Discogs', path: '/discogs' },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-paper/95 backdrop-blur-md border-b border-ink/10 px-4 md:px-6 py-3 md:py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 group min-w-0">
          <div className="w-10 h-10 rounded-full bg-ink flex items-center justify-center text-paper transition-transform group-hover:scale-110 shrink-0">
            <Music size={20} />
          </div>
          <span className="font-serif text-xl md:text-2xl tracking-tight font-semibold truncate">Música Elegante</span>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "text-sm uppercase tracking-widest font-medium transition-colors hover:text-gold",
                location.pathname === item.path ? "text-gold" : "text-ink/60"
              )}
            >
              {item.name}
            </Link>
          ))}
        </div>

        
        <div className="hidden md:flex items-center gap-2">
          <button type="button" onClick={() => setReaderMode(value => !value)}
            aria-pressed={readerMode} title="Aumentar o reducir el tamaño de lectura"
            className="rounded-full border border-ink/20 px-4 py-2 text-sm font-semibold hover:text-gold focus-visible:outline-2 focus-visible:outline-gold">
            {readerMode ? 'Texto normal' : 'Texto grande'}
          </button>
          <button type="button" onClick={() => void logout()}
            className="inline-flex items-center gap-2 rounded-full border border-ink/10 px-4 py-2 text-xs uppercase tracking-wider hover:text-gold">
            <LogOut size={16} /> Salir
          </button>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-full border border-ink/10 bg-paper text-ink hover:text-gold transition-colors"
          aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-navigation"
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            id="mobile-navigation"
            className="md:hidden absolute top-full inset-x-3 mt-2 rounded-2xl border border-ink/10 bg-paper shadow-xl overflow-hidden"
          >
            <div className="flex flex-col py-2">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "px-5 py-4 text-sm uppercase tracking-widest font-medium transition-colors",
                    location.pathname === item.path ? "text-gold bg-gold/5" : "text-ink/70 hover:text-ink hover:bg-ink/5"
                  )}
                >
                  {item.name}
                </Link>
              ))}
              <button type="button" onClick={() => setReaderMode(value => !value)}
                aria-pressed={readerMode} className="text-left px-5 py-4 border-t border-ink/10 text-base font-semibold">
                {readerMode ? 'A · Texto normal' : 'A+ · Texto grande'}
              </button>
              <button type="button" onClick={() => void logout()} className="text-left px-5 py-4 border-t border-ink/10 text-sm uppercase tracking-wider">
                Salir
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="bg-ink text-paper py-16 px-6 mt-20">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-12">
        <div className="space-y-4">
          <h3 className="font-serif text-3xl italic">Música Elegante</h3>
          <p className="text-paper/60 text-sm leading-relaxed max-w-xs">
            Una oda a la belleza de la música clásica y el jazz. Gestiona tu biblioteca personal con la sofisticación que merece.
          </p>
        </div>
        <div>
          <h4 className="text-xs uppercase tracking-widest font-bold mb-6 text-gold">Explorar</h4>
          <ul className="space-y-3 text-sm text-paper/60">
            <li><Link to="/jazz" className="hover:text-paper transition-colors">Jazz</Link></li>
            <li><Link to="/classical" className="hover:text-paper transition-colors">Música Clásica</Link></li>
            <li><Link to="/collection" className="hover:text-paper transition-colors">Mi Colección</Link></li>
            <li><Link to="/discogs" className="hover:text-paper transition-colors">Importar Discogs</Link></li>
          </ul>
        </div>
      </div>
      <div className="max-w-7xl mx-auto mt-16 pt-8 border-t border-paper/10 text-[10px] uppercase tracking-widest text-paper/40 flex justify-between">
        <span>© 2026 Música Elegante</span>
        <span>Hecho con pasión por la música</span>
      </div>
    </footer>
  );
}

// --- Pages ---

function CatalogMaintenance() {
  const { canAccess } = useAuth();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ReturnType<typeof inspectCatalog> | null>(null);
  const [message, setMessage] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [dateProposals, setDateProposals] = useState<Array<{
    artistId: string; name: string; birthDate?: string; deathDate?: string; source: string
  }> | null>(null);
  const [dateProgress, setDateProgress] = useState('');
  const [artistRepairs, setArtistRepairs] = useState<ArtistRepair[] | null>(null);
  const [tracklistProposals, setTracklistProposals] = useState<VerifiedTracklistProposal[] | null>(null);

  const loadCatalog = async () => {
    const [artistDocs, albumDocs, collectionDocs, jobDocs] = await Promise.all([
      getDocs(collection(db, 'artists')),
      getDocs(collection(db, 'albums')),
      getDocs(collection(db, 'collection')),
      getDocs(collection(db, 'import_jobs'))
    ]);
    return {
      artists: artistDocs.docs.map(item => ({ ...item.data(), id: item.id } as Artist)),
      albums: albumDocs.docs.map(item => ({ ...item.data(), id: item.id } as Album)),
      collection: collectionDocs.docs.map(item => ({ ...item.data(), id: item.id } as CollectionItem)),
      import_jobs: jobDocs.docs.map(item => ({ ...item.data(), id: item.id } as Record<string, unknown>)),
    };
  };

  const downloadBackup = async () => {
    if (running) return;
    setRunning(true);
    setMessage('Preparando copia de seguridad...');
    try {
      const data = await loadCatalog();
      const json = serializeCatalogBackup({
        format: 'musica-elegante-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        description: 'Copia de metadatos Firestore; los archivos de Firebase Storage no están incluidos.',
        ...data,
      });
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'musica-elegante-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupDownloaded(true);
      setMessage(`Archivo JSON preparado: ${data.artists.length} artistas y ${data.albums.length} álbumes. Guarda una copia segura.`);
    } catch (error) {
      console.error('Backup failed', error);
      setMessage('No se pudo exportar todo el catálogo. Comprueba la conexión y los permisos.');
    } finally { setRunning(false); }
  };

  const inspect = async () => {
    if (running) return;
    setRunning(true);
    setMessage('Analizando integridad del catálogo...');
    try {
      const data = await loadCatalog();
      const issues = inspectCatalog(data.albums, data.artists);
      setReport(issues);
      setPreviewOpen(true);
      setMessage(`Se revisaron ${data.albums.length} álbumes y ${data.artists.length} artistas; ${issues.length} observaciones para revisión. No se modificó nada.`);
    } catch (error) {
      console.error('Catalog audit failed', error);
      setMessage('No se pudo completar la revisión. No se modificó ningún registro.');
    } finally { setRunning(false); }
  };

  const reviewMissingDates = async () => {
    if (running) return;
    setRunning(true);
    setDateProposals(null);
    try {
      const snapshot = await getDocs(collection(db, 'artists'));
      const candidates = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Artist))
        .filter(artist => artist.name?.trim() && (!artist.birthDate?.trim() || !artist.deathDate?.trim()));
      const proposals: Array<{ artistId: string; name: string; birthDate?: string; deathDate?: string; source: string }> = [];
      let completed = 0;
      let lookupErrors = 0;
      // Keep requests modest; only propose exact, full Wikidata dates verified for humans.
      for (let offset = 0; offset < candidates.length; offset += 3) {
        const group = candidates.slice(offset, offset + 3);
        await Promise.all(group.map(async artist => {
          try {
            const response = await privateApiFetch('/api/artist-dates?name=' + encodeURIComponent(artist.name));
            if (!response.ok) { lookupErrors++; return; }
            const result = await response.json() as {
              birthDate?: string; deathDate?: string; source?: string
            };
            if (!result.source?.startsWith('https://www.wikidata.org/wiki/Q')) return;
            const birthDate = !artist.birthDate?.trim() ? result.birthDate : undefined;
            const deathDate = !artist.deathDate?.trim() ? result.deathDate : undefined;
            if (birthDate || deathDate) {
              proposals.push({ artistId: artist.id, name: artist.name, birthDate, deathDate, source: result.source });
            }
          } catch (error) {
            console.warn('Artist date lookup failed', artist.name, error);
            lookupErrors++;
          } finally { completed++; }
        }));
        setDateProgress(`Consultados ${completed} de ${candidates.length} artistas...`);
      }
      proposals.sort((a, b) => a.name.localeCompare(b.name));
      setDateProposals(proposals);
      setMessage(`${proposals.length} fichas con fechas verificadas propuestas. ${lookupErrors} consultas fallidas. Ningún dato fue modificado.`);
    } catch (error) {
      console.error('Cannot inspect artist dates', error);
      setMessage('No se pudo consultar la lista de artistas. No se modificó nada.');
    } finally {
      setRunning(false);
      setDateProgress('');
    }
  };

  const applyMissingDates = async () => {
    if (running || !backupDownloaded || !dateProposals?.length) return;
    if (!window.confirm(`¿Guardar fechas verificadas en ${dateProposals.length} fichas? Sólo se completarán campos vacíos. Se conservarán los datos existentes.`)) return;
    setRunning(true);
    let updated = 0, skipped = 0, failed = 0;
    for (const proposal of dateProposals) {
      try {
        const artistRef = doc(db, 'artists', proposal.artistId);
        const didUpdate = await runTransaction(db, async transaction => {
          const snapshot = await transaction.get(artistRef);
          if (!snapshot.exists() || snapshot.data().name !== proposal.name) return false;
          const current = snapshot.data();
          const changes: Record<string, string> = {};
          if (proposal.birthDate && !current.birthDate) {
            changes.birthDate = proposal.birthDate;
            changes.birthDateSource = proposal.source;
          }
          if (proposal.deathDate && !current.deathDate) {
            changes.deathDate = proposal.deathDate;
            changes.deathDateSource = proposal.source;
          }
          if (!Object.keys(changes).length) return false;
          transaction.update(artistRef, changes);
          return true;
        });
        if (didUpdate) updated++; else skipped++;
      } catch (error) {
        console.error('Date update not applied', proposal.artistId, error);
        failed++;
      }
    }
    setDateProposals(null);
    setMessage(`Fechas completadas: ${updated} artistas. Omitidos: ${skipped}. Errores: ${failed}. No se sobreescribieron fechas anteriores.`);
    setRunning(false);
  };

  const downloadAuditReport = () => {
    if (!report) return;
    const categories: Record<string, string> = {
      'missing-reference': 'Artista vinculado inexistente',
      'missing-artist': 'Nombre de artista ausente',
      'missing-title': 'Título ausente',
      'repeated-label': 'Sello repetido',
      'missing-classical-content': 'Obras o pistas clásicas sin documentar',
      'possible-duplicate': 'Posible edición duplicada (revisión manual)'
    };
    const lines = [
      'Música Elegante — Informe de integridad del catálogo',
      'Fecha: ' + new Date().toISOString(),
      'Observaciones: ' + report.length,
      'Este informe no modifica ningún dato ni demuestra que los registros sean duplicados.',
      '',
      ...report.map((issue, index) =>
        (index + 1) + '. [' + (categories[issue.kind] || issue.kind) + '] ' +
        issue.title + ' (ID: ' + issue.albumId + ') — ' + issue.detail)
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'musica-elegante-informe-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const previewArtistRepairs = async () => {
    if (running) return;
    setRunning(true);
    setMessage('Revisando nombres y enlaces con datos actuales de Firebase...');
    try {
      const data = await loadCatalog();
      const proposals = proposeArtistRepairs(data.albums, data.artists);
      setArtistRepairs(proposals);
      setMessage(`Hay ${proposals.length} correcciones propuestas. Revisa los detalles antes de aplicar; ningún dato fue cambiado.`);
    } catch (error) {
      console.error('Could not preview artist repairs:', error);
      setMessage('No se pudo revisar los enlaces de artistas. No se cambió ningún dato.');
    } finally { setRunning(false); }
  };

  const applyArtistRepairs = async () => {
    if (!backupDownloaded || !artistRepairs?.length || running) return;
    if (!window.confirm(`¿Aplicar ${artistRepairs.length} correcciones verificadas de nombres y referencias? Se conservarán los títulos, pistas, ediciones y créditos de las grabaciones.`)) return;
    setRunning(true);
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    for (const proposal of artistRepairs) {
      try {
        await runTransaction(db, async transaction => {
          const albumRef = doc(db, 'albums', proposal.albumId);
          const current = await transaction.get(albumRef);
          if (!current.exists()) throw new Error('Album no longer exists');
          const data = { ...current.data(), id: current.id } as Album;
          if (!isRepairStillApplicable(data, proposal)) throw new Error('Album changed since preview');
          const targetId = proposal.changes.artistId || data.artistId;
          const target = await transaction.get(doc(db, 'artists', targetId));
          if (!target.exists()) throw new Error('Target artist missing');
          if (proposal.changes.artistName && target.data().name !== proposal.changes.artistName) {
            throw new Error('Artist name changed since preview');
          }
          transaction.update(albumRef, proposal.changes);
        });
        updated++;
      } catch (error) {
        const note = error instanceof Error ? error.message : String(error);
        if (note.includes('changed since preview') || note.includes('no longer exists') || note.includes('Target artist missing') || note.includes('Artist name changed')) skipped++;
        else failed++;
        console.error('Artist repair not applied:', proposal.albumId, error);
      }
    }
    setRunning(false);
    setArtistRepairs(null);
    setReport(null);
    setPreviewOpen(false);
    setMessage(`Correcciones guardadas: ${updated}. Omitidas por datos cambiados: ${skipped}. Errores: ${failed}. Revisa el catálogo otra vez.`);
  };

  const previewTracklistEnrichment = async () => {
    if (running) return;
    setRunning(true);
    try {
      const snapshot = await getDocs(collection(db, 'albums'));
      const albums = snapshot.docs.map(item => ({ ...item.data(), id: item.id } as Album));
      const candidates = proposeVerifiedTracklists(albums);
      setTracklistProposals(candidates);
      setMessage(candidates.length
        ? `Se encontró ${candidates.length} edición con lista de pistas verificada. Revisa la fuente antes de guardarla.`
        : 'No quedan ediciones verificadas con pistas pendientes de completar.');
    } catch (error) {
      console.error('Tracklist preview unavailable', error);
      setMessage('No se pudieron consultar los álbumes. No se modificó nada.');
    } finally { setRunning(false); }
  };

  const applyVerifiedTracklists = async () => {
    if (running || !backupDownloaded || !tracklistProposals?.length) return;
    if (!window.confirm('¿Añadir pistas documentadas a las ediciones verificadas? No se eliminará ni reemplazará ninguna pista existente.')) return;
    setRunning(true);
    let updated = 0, skipped = 0, failed = 0;
    for (const proposal of tracklistProposals) {
      try {
        const applied = await runTransaction(db, async transaction => {
          const ref = doc(db, 'albums', proposal.albumId);
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists() || !isVerifiedTracklistStillApplicable({ id: snapshot.id, ...snapshot.data() } as Album, proposal)) return false;
          // An untouched release with no documented works is the only allowed target.
          transaction.update(ref, { discs: [proposal.disc] });
          return true;
        });
        if (applied) updated++; else skipped++;
      } catch (error) {
        failed++;
        console.error('Verified tracklist was not applied:', proposal.albumId, error);
      }
    }
    setTracklistProposals(null);
    setReport(null);
    setPreviewOpen(false);
    setMessage(`Listas de pistas completas: ${updated}. Omitidas: ${skipped}. Errores: ${failed}. Vuelve a ejecutar Revisar catálogo.`);
    setRunning(false);
  };

  const fixRepeatedLabels = async () => {
    if (!backupDownloaded || running) return;
    if (!window.confirm('¿Guardar los sellos sin repeticiones en el catálogo? Sólo se modificarán las etiquetas repetidas, nunca se borrarán álbumes.')) return;
    setRunning(true);
    try {
      const snapshot = await getDocs(collection(db, 'albums'));
      let fixed = 0;
      let failed = 0;
      for (const item of snapshot.docs) {
        const changes: Record<string, string> = {};
        for (const field of ['label', 'originalLabel'] as const) {
          const value = item.data()[field];
          if (typeof value === 'string' && normalizeRecordLabels(value) !== value) {
            changes[field] = normalizeRecordLabels(value);
          }
        }
        if (!Object.keys(changes).length) continue;
        try { await updateDoc(item.ref, changes); fixed++; }
        catch (error) { console.error('Could not correct labels', item.id, error); failed++; }
      }
      setReport(null);
      setPreviewOpen(false);
      setMessage(`Se corrigieron ${fixed} álbumes. Errores: ${failed}. Los demás datos no cambiaron.`);
    } catch (error) {
      console.error('Label correction failed', error);
      setMessage('No se pudo completar la corrección. Revisa tus permisos.');
    } finally { setRunning(false); }
  };

  if (!canAccess) return null;
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 space-y-3" aria-label="Mantenimiento y copias de seguridad">
      <div className="rounded-2xl border border-gold/30 bg-white p-4 sm:p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-serif text-xl">Seguridad e integridad del catálogo</h2>
            <p className="text-sm text-ink/60">Exportar los datos o revisar posibles inconsistencias sin eliminar registros.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={downloadBackup} disabled={running} className="rounded-full bg-ink text-paper px-4 py-3 text-sm disabled:opacity-50">Descargar copia JSON</button>
            <button type="button" onClick={inspect} disabled={running} className="rounded-full border border-ink/20 px-4 py-3 text-sm disabled:opacity-50">Revisar catálogo</button>
            <button type="button" onClick={reviewMissingDates} disabled={running}
              className="rounded-full border border-gold/50 px-4 py-3 text-sm disabled:opacity-50">
              Completar fechas de artistas
            </button>
            <button type="button" onClick={previewArtistRepairs} disabled={running}
              className="rounded-full border border-gold/50 text-ink px-4 py-3 text-sm disabled:opacity-50">Reparar enlaces de artistas</button>
            <button type="button" onClick={previewTracklistEnrichment} disabled={running}
              className="rounded-full border border-ink/20 px-4 py-3 text-sm disabled:opacity-50">
              Completar pistas verificadas
            </button>
            <button type="button" onClick={fixRepeatedLabels} disabled={running || !backupDownloaded}
              title={backupDownloaded ? 'Corregir sellos repetidos' : 'Descarga primero una copia de seguridad'}
              className="rounded-full border border-gold/50 text-gold px-4 py-3 text-sm disabled:opacity-40">
              Corregir sellos repetidos
            </button>
          </div>
        </div>
        <p className="text-xs text-ink/50">La copia incluye artistas, álbumes, colección y trabajos de importación. No incluye las imágenes ni documentos almacenados en Firebase Storage.</p>
        {message && <p role="status" className="text-sm text-ink/70">{message}</p>}
        {dateProgress && <p role="status" className="text-sm text-ink/60">{dateProgress}</p>}
        {dateProposals !== null && (
          <div className="space-y-3 border-t border-ink/10 pt-4">
            <h3 className="font-serif text-xl">Fechas contrastadas ({dateProposals.length})</h3>
            <p className="text-sm text-ink/60">Sólo personas con una coincidencia exacta, fecha completa y referencia en Wikidata. Las agrupaciones y las fechas inciertas se omiten. Revisa las fuentes antes de guardar.</p>
            <div className="max-h-72 overflow-y-auto divide-y divide-ink/10 rounded-xl border border-ink/10">
              {dateProposals.map(proposal => (
                <div key={proposal.artistId} className="p-3 text-sm space-y-1">
                  <strong>{proposal.name}</strong>
                  <p className="text-ink/70">{proposal.birthDate ? 'Nacimiento: ' + proposal.birthDate : ''}
                    {proposal.birthDate && proposal.deathDate ? ' · ' : ''}
                    {proposal.deathDate ? 'Fallecimiento: ' + proposal.deathDate : ''}</p>
                  <a href={proposal.source} target="_blank" rel="noopener noreferrer" className="text-gold underline">Ver fuente en Wikidata</a>
                </div>
              ))}
              {!dateProposals.length && <p className="p-3 text-sm text-ink/60">No se encontraron fechas completas con coincidencia segura.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={running || !backupDownloaded || !dateProposals.length}
                onClick={applyMissingDates} className="rounded-full bg-ink text-paper px-4 py-3 text-sm disabled:opacity-40">
                Guardar fechas verificadas
              </button>
              <button type="button" onClick={() => setDateProposals(null)}
                className="rounded-full border border-ink/20 px-4 py-3 text-sm">Cancelar</button>
            </div>
            {!backupDownloaded && <p className="text-sm text-ink/60">Descarga primero una copia JSON nueva en esta sesión.</p>}
          </div>
        )}
        {tracklistProposals !== null && (
          <div className="border-t border-ink/10 pt-3 space-y-3">
            <h3 className="font-serif text-xl">Pistas verificadas ({tracklistProposals.length})</h3>
            <p className="text-sm text-ink/60">Solo se completan ediciones exactas identificadas por título y número de catálogo. Si ya se añadieron pistas, la operación se omite y conserva todo lo existente.</p>
            {tracklistProposals.map(proposal => (
              <div key={proposal.albumId} className="border border-ink/10 rounded-xl p-4 space-y-2">
                <p className="font-bold">{proposal.title} · {proposal.catalogNumber}</p>
                <p className="text-sm text-ink/60">{proposal.disc.works.length} pistas con compositor y duración</p>
                <a href={proposal.source} target="_blank" rel="noopener noreferrer" className="text-sm underline text-gold">Consultar la edición original (MusicBrainz)</a>
                <ol className="list-decimal ml-5 max-h-40 overflow-y-auto text-xs text-ink/60 space-y-1">
                  {proposal.disc.works.map((work, index) => <li key={index}>{work.title} — {work.composer} ({work.movements[0]?.duration})</li>)}
                </ol>
              </div>
            ))}
            {!tracklistProposals.length && <p className="text-sm text-ink/60">No quedan propuestas verificadas.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={applyVerifiedTracklists}
                disabled={running || !backupDownloaded || tracklistProposals.length === 0}
                className="rounded-full bg-ink text-paper px-4 py-3 text-sm disabled:opacity-40">Guardar pistas verificadas</button>
              <button type="button" onClick={() => setTracklistProposals(null)} className="rounded-full border border-ink/20 px-4 py-3 text-sm">Cancelar</button>
            </div>
            {!backupDownloaded && <p className="text-xs text-ink/60">Descarga una copia JSON nueva para habilitar el guardado.</p>}
          </div>
        )}
        {artistRepairs !== null && (
          <div className="border-t border-ink/10 pt-4 space-y-3">
            <h3 className="font-serif text-xl">Vista previa: correcciones de artistas ({artistRepairs.length})</h3>
            <p className="text-xs text-ink/60">No se modificará ninguna otra propiedad. Esta acción no inventa movimientos ni borra ediciones. Primero descarga una copia JSON nueva en esta sesión.</p>
            {artistRepairs.length ? (
              <div className="max-h-80 overflow-y-auto divide-y divide-ink/10 rounded-xl border border-ink/10">
                {artistRepairs.map(proposal => (
                  <div key={proposal.albumId} className="p-3 text-sm space-y-1">
                    <p className="font-semibold">{proposal.title}</p>
                    <p className="text-ink/65">{proposal.kind === 'fill-artist-name'
                      ? `Nombre: ${proposal.changes.artistName}`
                      : `Enlace: ${proposal.expectedArtistId} → ${proposal.changes.artistId}`}</p>
                    <p className="text-xs text-ink/50">{proposal.explanation}</p>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm">No quedan reparaciones conocidas por aplicar.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!backupDownloaded || running || artistRepairs.length === 0}
                onClick={applyArtistRepairs} title={!backupDownloaded ? 'Descarga primero una copia JSON nueva' : undefined}
                className="rounded-full bg-ink text-paper px-4 py-3 text-sm disabled:opacity-40">
                Aplicar correcciones verificadas
              </button>
              <button type="button" onClick={() => setArtistRepairs(null)}
                className="rounded-full border border-ink/20 px-4 py-3 text-sm">Cancelar</button>
            </div>
          </div>
        )}
        {previewOpen && report !== null && (
          <div className="space-y-3 border-t border-ink/10 pt-3">
            <div className="flex justify-between items-center gap-3">
              <h3 className="font-medium text-sm">Observaciones ({report.length})</h3>
              <div className="flex flex-wrap gap-3 items-center">
                <button type="button" className="text-gold underline text-sm" onClick={downloadAuditReport}>Descargar informe completo</button>
                <button type="button" className="underline text-sm" onClick={() => setPreviewOpen(false)}>Ocultar</button>
              </div>
            </div>
            {report.length === 0 ? <p className="text-sm text-ink/60">No se detectaron problemas con estas comprobaciones.</p> : (
              <div className="max-h-72 overflow-y-auto divide-y divide-ink/10 border border-ink/10 rounded-xl">
                {report.slice(0, 150).map((issue, index) => (
                  <div key={issue.albumId + issue.kind + index} className="p-3 text-sm">
                    <strong>{issue.title}</strong> — {issue.detail}
                  </div>
                ))}
                {report.length > 150 && <p className="p-3 text-sm text-ink/60">Se muestran las primeras 150 observaciones.</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Home() {
  const [artists, setArtists] = useState<Artist[]>([]);
  

  useEffect(() => {
    const q = query(collection(db, 'artists'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setArtists(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Artist)));
    });
    return unsubscribe;
  }, []);

  return (
    <div className="space-y-20">
      <CatalogMaintenance />
      <section className="relative h-[80vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=1920" 
            alt="Hero" 
            className="w-full h-full object-cover opacity-40 grayscale"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-paper/0 via-paper/20 to-paper" />
        </div>
        
        <div className="relative z-10 text-center space-y-8 px-6">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="font-serif text-7xl md:text-9xl tracking-tight leading-none"
          >
            L'Arte della <br /> <span className="italic text-gold">Musica</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-sm md:text-base uppercase tracking-[0.3em] font-light text-ink/60"
          >
            Tu colección personal de Jazz y Clásica
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="flex gap-4 justify-center"
          >
            <Link to="/jazz" className="px-8 py-3 bg-ink text-paper rounded-full text-sm font-medium hover:bg-gold transition-colors">Explorar Jazz</Link>
            <Link to="/classical" className="px-8 py-3 border border-ink text-ink rounded-full text-sm font-medium hover:bg-ink hover:text-paper transition-colors">Música Clásica</Link>
            <Link to="/discogs" className="px-8 py-3 border border-gold text-gold rounded-full text-sm font-medium hover:bg-gold hover:text-white transition-colors">Importar desde Discogs</Link>
          </motion.div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-20 items-center">
        <div className="space-y-6">
          <span className="text-xs uppercase tracking-widest font-bold text-gold">Nuestra Filosofía</span>
          <h2 className="font-serif text-5xl leading-tight">La elegancia se encuentra en cada nota.</h2>
          <p className="text-ink/70 leading-relaxed">
            Música Elegante no es solo un catálogo; es un santuario para los amantes de la música que aprecian la historia detrás de cada vinilo y la maestría de cada compositor. Desde las improvisaciones de Miles Davis hasta las sinfonías de Beethoven.
          </p>
          <div className="pt-4">
            <Link to="/collection" className="group flex items-center gap-2 text-sm font-bold uppercase tracking-widest">
              Gestionar mi biblioteca <ChevronRight size={16} className="transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
        <div className="relative aspect-[4/5] rounded-2xl overflow-hidden shadow-2xl">
          <img 
            src="/Vinyl.jpg" 
            alt="Vinyl" 
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
      </section>


<section className="max-w-7xl mx-auto px-6">
  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
    <Link to="/search" className="group rounded-3xl border border-ink/10 bg-white p-8 md:p-10 shadow-sm hover:shadow-lg transition-all">
      <div className="space-y-4">
        <span className="text-xs uppercase tracking-widest font-bold text-gold">Búsqueda avanzada</span>
        <h3 className="font-serif text-3xl md:text-4xl">Buscar grabaciones y datos discográficos</h3>
        <p className="text-ink/65 leading-relaxed">
          Busca por artista, título, sello, número de catálogo, año, productor, ingeniero, solistas y músicos usando solo la información guardada en tu sitio.
        </p>
        <div className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest">
          Ir a búsqueda <ChevronRight size={16} className="transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </Link>

    <Link to="/compare" className="group rounded-3xl border border-ink/10 bg-ink text-paper p-8 md:p-10 shadow-sm hover:shadow-lg transition-all">
      <div className="space-y-4">
        <span className="text-xs uppercase tracking-widest font-bold text-gold">Comparación musicológica</span>
        <h3 className="font-serif text-3xl md:text-4xl">Comparar distintas grabaciones</h3>
        <p className="text-paper/70 leading-relaxed">
          Confronta ediciones, personal artístico, instrumentación, fechas, lugares de grabación, sello, catálogo y otros datos históricos entre dos o tres registros.
        </p>
        <div className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-gold">
          Ir a comparación <ChevronRight size={16} className="transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </Link>
  </div>
</section>

<section className="max-w-7xl mx-auto px-6">
  <Link to="/imports" className="group block rounded-3xl border border-ink/10 bg-white p-8 md:p-10 shadow-sm hover:shadow-lg transition-all">
    <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_0.7fr] gap-8 items-center">
      <div className="space-y-4">
        <span className="text-xs uppercase tracking-widest font-bold text-gold">Importación asistida</span>
        <h3 className="font-serif text-3xl md:text-4xl">Subir archivos Word y extraer datos con AI</h3>
        <p className="text-ink/65 leading-relaxed max-w-3xl">
          Sube un archivo .docx, deja que la IA identifique datos biográficos, discográficos y musicológicos, revisa el resultado y guárdalo en Firebase solo cuando lo apruebes.
        </p>
        <div className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest">
          Ir a importación <ChevronRight size={16} className="transition-transform group-hover:translate-x-1" />
        </div>
      </div>
      <div className="rounded-3xl bg-ink text-paper p-6 md:p-8 space-y-3">
        <div className="inline-flex w-12 h-12 items-center justify-center rounded-full bg-paper/10">
          <FileText size={22} />
        </div>
        <h4 className="font-serif text-2xl">Workflow sugerido</h4>
        <ul className="space-y-2 text-sm text-paper/75 leading-relaxed">
          <li>1. Subir .docx</li>
          <li>2. Extraer texto</li>
          <li>3. Analizar con AI</li>
          <li>4. Revisar antes de guardar</li>
        </ul>
      </div>
    </div>
  </Link>
</section>

<ArtistAnniversaryPopup artists={artists} />
<ArtistAnniversaries artists={artists} />
    </div>
  );
}

function getTodayArtistAnniversaries(artists: Artist[]) {
  const today = new Date();
  const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return artists.filter(artist => {
    const isBirth = artist.birthDate?.endsWith(monthDay);
    const isDeath = artist.deathDate?.endsWith(monthDay);
    return isBirth || isDeath;
  });
}

function ArtistAnniversaryPopup({ artists }: { artists: Artist[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const today = new Date();
  const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayKey = `artist-anniversary-popup-${today.getFullYear()}-${monthDay}`;
  const anniversaries = getTodayArtistAnniversaries(artists);

  useEffect(() => {
    if (anniversaries.length === 0) return;
    const alreadyClosedToday = localStorage.getItem(todayKey) === 'closed';
    if (!alreadyClosedToday) setIsOpen(true);
  }, [anniversaries.length, todayKey]);

  const closePopup = () => {
    localStorage.setItem(todayKey, 'closed');
    setIsOpen(false);
  };

  if (anniversaries.length === 0) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            className="relative w-full max-w-2xl rounded-[2rem] bg-paper p-8 shadow-2xl border border-ink/10"
          >
            <button
              type="button"
              onClick={closePopup}
              className="absolute right-5 top-5 rounded-full p-2 text-ink/45 hover:bg-ink/5 hover:text-ink transition-colors"
              aria-label="Cerrar"
            >
              <X size={20} />
            </button>

            <div className="space-y-6 pr-8">
              <div className="inline-flex items-center gap-3 rounded-full bg-gold/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-gold">
                <Calendar size={16} />
                Efemérides de hoy
              </div>

              <div>
                <h2 className="font-serif text-4xl md:text-5xl leading-tight">Hoy hay algo especial</h2>
                <p className="mt-3 text-ink/60 font-serif italic text-lg">
                  {today.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}
                </p>
              </div>

              <div className="space-y-3 max-h-[45vh] overflow-y-auto pr-2">
                {anniversaries.map(artist => {
                  const isBirth = artist.birthDate?.endsWith(monthDay);
                  const isDeath = artist.deathDate?.endsWith(monthDay);
                  return (
                    <div key={artist.id} className="rounded-2xl border border-ink/10 bg-white p-5 space-y-2">
                      <span className="text-[10px] uppercase tracking-widest font-bold text-gold">
                        {isBirth && isDeath ? 'Nacimiento y fallecimiento' : isBirth ? 'Nacimiento' : 'Fallecimiento'}
                      </span>
                      <h3 className="font-serif text-2xl">{artist.name}</h3>
                      <p className="text-sm text-ink/60 leading-relaxed">
                        {isBirth && `Nació un día como hoy en ${artist.birthDate?.split('-')[0]}. `}
                        {isDeath && `Falleció un día como hoy en ${artist.deathDate?.split('-')[0]}. `}
                      </p>
                      <Link
                        to={`/artist/${artist.id}`}
                        onClick={closePopup}
                        className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gold hover:text-ink transition-colors"
                      >
                        Ver artista <ChevronRight size={14} />
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ArtistAnniversaries({ artists }: { artists: Artist[] }) {
  const today = new Date();
  const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const anniversaries = getTodayArtistAnniversaries(artists);

  const jazzArtists = artists.filter(a => a.genre === 'jazz');
  const classicalArtists = artists.filter(a => a.genre === 'classical');

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  return (
    <section className="max-w-7xl mx-auto px-6 py-20 border-t border-ink/5 space-y-16">
      <div className="text-center space-y-4">
        <span className="text-xs uppercase tracking-widest font-bold text-gold">Efemérides Musicales</span>
        <h2 className="font-serif text-5xl">Aniversarios de Hoy</h2>
        <p className="text-ink/60 italic font-serif text-xl">
          {today.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}
        </p>
      </div>

      {anniversaries.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {anniversaries.map(artist => {
            const isBirth = artist.birthDate?.endsWith(monthDay);
            const isDeath = artist.deathDate?.endsWith(monthDay);
            return (
              <motion.div 
                key={artist.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                className="bg-ink text-paper p-8 rounded-3xl space-y-4 relative overflow-hidden group"
              >
                <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Calendar size={80} />
                </div>
                <span className="text-[10px] uppercase tracking-widest font-bold text-gold">
                  {isBirth && isDeath ? 'Nacimiento y Fallecimiento' : isBirth ? 'Nacimiento' : 'Fallecimiento'}
                </span>
                <h3 className="font-serif text-3xl">{artist.name}</h3>
                <p className="text-sm text-paper/60 leading-relaxed">
                  {isBirth && `Nació un día como hoy en ${artist.birthDate?.split('-')[0]}. `}
                  {isDeath && `Falleció un día como hoy en ${artist.deathDate?.split('-')[0]}. `}
                </p>
                <Link 
                  to={`/artist/${artist.id}`}
                  className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-gold hover:text-paper transition-colors"
                >
                  Ver Biografía <ChevronRight size={14} />
                </Link>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 bg-ink/5 rounded-3xl border border-dashed border-ink/10">
          <p className="text-ink/40 font-serif italic text-lg">No hay aniversarios registrados para el día de hoy.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 pt-10">
        <div className="space-y-8">
          <div className="flex items-center gap-4 border-b border-ink/10 pb-4">
            <div className="w-10 h-10 bg-gold/10 rounded-full flex items-center justify-center text-gold">
              <Music size={20} />
            </div>
            <h3 className="font-serif text-3xl italic">Maestros del Jazz</h3>
          </div>
          <div className="space-y-4">
            {jazzArtists.map(artist => (
              <div key={artist.id} className="flex items-center justify-between group">
                <Link to={`/artist/${artist.id}`} className="font-serif text-lg hover:text-gold transition-colors">{artist.name}</Link>
                <div className="text-[10px] uppercase tracking-widest font-bold text-ink/30 flex gap-4">
                  <span>{formatDate(artist.birthDate)}</span>
                  {artist.deathDate && <span className="text-ink/10">—</span>}
                  <span>{formatDate(artist.deathDate)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-8">
          <div className="flex items-center gap-4 border-b border-ink/10 pb-4">
            <div className="w-10 h-10 bg-gold/10 rounded-full flex items-center justify-center text-gold">
              <Music size={20} />
            </div>
            <h3 className="font-serif text-3xl italic">Genios Clásicos</h3>
          </div>
          <div className="space-y-4">
            {classicalArtists.map(artist => (
              <div key={artist.id} className="flex items-center justify-between group">
                <Link to={`/artist/${artist.id}`} className="font-serif text-lg hover:text-gold transition-colors">{artist.name}</Link>
                <div className="text-[10px] uppercase tracking-widest font-bold text-ink/30 flex gap-4">
                  <span>{formatDate(artist.birthDate)}</span>
                  {artist.deathDate && <span className="text-ink/10">—</span>}
                  <span>{formatDate(artist.deathDate)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function GenrePage({ genre }: { genre: Genre }) {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'name' | 'none'>('none');
  const { canAccess } = useAuth();
  const [addingImages, setAddingImages] = useState(false);
  const [imageFeedback, setImageFeedback] = useState('');

  const fillMissingPortraits = async () => {
    const missing = artists.filter(artist => !artist.imageUrl?.trim());
    if (!missing.length || !canAccess || addingImages) return;
    if (!window.confirm(`Buscar y guardar retratos para ${missing.length} artistas sin imagen? No se modificarán las fotos existentes.`)) return;
    setAddingImages(true);
    setImageFeedback('Buscando imágenes...');
    let updated = 0;
    let unresolved = 0;
    let failed = 0;
    for (const artist of missing) {
      try {
        const imageUrl = await findArtistPortrait(artist.name);
        if (!imageUrl) { unresolved++; continue; }
        const artistRef = doc(db, 'artists', artist.id);
        const current = await getDoc(artistRef);
        if (!current.exists() || current.data().imageUrl) continue;
        await updateDoc(artistRef, { imageUrl });
        updated++;
      } catch (error) {
        failed++;
        console.error('Could not save portrait for', artist.name, error);
      }
    }
    setImageFeedback(`${updated} fotos guardadas; ${unresolved} sin coincidencia segura; ${failed} errores.`);
    setAddingImages(false);
  };


  useEffect(() => {
    const q = query(collection(db, 'artists'), where('genre', '==', genre));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Artist));
      setArtists(data);
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'artists'));
    return unsubscribe;
  }, [genre]);

  const sortedArtists = [...artists].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return 0;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 sm:py-20 space-y-8 sm:space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-4">
          <span className="text-xs uppercase tracking-widest font-bold text-gold">Explorar Género</span>
          <h1 className="font-serif text-4xl sm:text-6xl md:text-8xl capitalize leading-tight break-words">{genre === 'classical' ? 'Música Clásica' : genre}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-ink/5 p-1 rounded-full">
            <button 
              onClick={() => setViewMode('grid')}
              className={cn(
                "p-2 rounded-full transition-all",
                viewMode === 'grid' ? "bg-paper text-gold shadow-sm" : "text-ink/40 hover:text-ink"
              )}
            >
              <LayoutGrid size={18} />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={cn(
                "p-2 rounded-full transition-all",
                viewMode === 'list' ? "bg-paper text-gold shadow-sm" : "text-ink/40 hover:text-ink"
              )}
            >
              <List size={18} />
            </button>
          </div>
          <button 
            onClick={() => setSortBy(sortBy === 'name' ? 'none' : 'name')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all border",
              sortBy === 'name' ? "bg-gold/10 border-gold text-gold" : "border-ink/10 text-ink/40 hover:border-ink/20"
            )}
          >
            <ArrowDownAZ size={16} />
            <span>A-Z</span>
          </button>
          {canAccess && artists.some(artist => !artist.imageUrl?.trim()) && (
            <button type="button" onClick={fillMissingPortraits} disabled={addingImages}
              className="px-4 py-3 border border-gold text-gold rounded-full text-xs font-bold disabled:opacity-50">
              {addingImages ? 'Buscando fotos...' : 'Completar fotos'}
            </button>
          )}
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center justify-center gap-2 px-5 sm:px-6 py-3 bg-ink text-paper rounded-full text-sm font-medium hover:bg-gold transition-colors min-h-11"
          >
            <Plus size={18} />
            <span>Añadir Artista</span>
          </button>
        </div>
      </div>

      {imageFeedback && <p role="status" className="text-sm text-ink/60">{imageFeedback}</p>}
      <div className={cn(
        "grid gap-10",
        viewMode === 'grid' ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"
      )}>
        {sortedArtists.map((artist) => (
          <div key={artist.id}>
            <ArtistCard artist={artist} viewMode={viewMode} />
          </div>
        ))}
        {!loading && artists.length === 0 && (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-ink/10 rounded-3xl">
            <p className="text-ink/40 font-serif italic text-xl">No hay artistas registrados en esta categoría aún.</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {isAdding && (
          <ArtistModal 
            genre={genre} 
            onClose={() => setIsAdding(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ArtistCard({ artist, viewMode = 'grid' }: { artist: Artist, viewMode?: 'grid' | 'list' }) {
  const portrait = useArtistPortrait(artist.name, artist.imageUrl);
  if (viewMode === 'list') {
    return (
      <Link to={`/artist/${artist.id}`} className="group flex items-center gap-6 p-4 rounded-2xl hover:bg-ink/5 transition-colors">
        <div className="w-16 h-16 rounded-xl overflow-hidden bg-ink/5 flex-shrink-0">
          {portrait ? (
            <img 
              src={portrait} 
              alt={artist.name} 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink/10">
              <UserIcon size={24} />
            </div>
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-serif text-xl group-hover:text-gold transition-colors">{artist.name}</h3>
          <p className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">{artist.genre}</p>
        </div>
        <ChevronRight size={18} className="text-ink/10 group-hover:text-gold transition-colors" />
      </Link>
    );
  }

  return (
    <Link to={`/artist/${artist.id}`} className="group block space-y-4">
      <div className="relative aspect-square rounded-2xl overflow-hidden bg-ink/5">
        {portrait ? (
          <img 
            src={portrait} 
            alt={artist.name} 
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink/10">
            <UserIcon size={64} />
          </div>
        )}
        <div className="absolute inset-0 bg-ink/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="px-6 py-2 bg-paper text-ink text-xs uppercase tracking-widest font-bold rounded-full">Ver Detalles</span>
        </div>
      </div>
      <div className="space-y-1">
        <h3 className="font-serif text-2xl group-hover:text-gold transition-colors">{artist.name}</h3>
        <p className="text-xs uppercase tracking-widest text-ink/40 font-bold">{artist.genre}</p>
      </div>
    </Link>
  );
}

function ArtistDetail() {
  const { id } = useParams<{ id: string }>();
  const [artist, setArtist] = useState<Artist | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [sidemanAlbums, setSidemanAlbums] = useState<Album[]>([]);
  const [sharedAlbums, setSharedAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isAddingAlbum, setIsAddingAlbum] = useState(false);
  const [showLoadingPopup, setShowLoadingPopup] = useState(false);
  const portrait = useArtistPortrait(artist?.name || '', artist?.imageUrl);
  const navigate = useNavigate();
  const lastGenre = useRef<Genre | null>(null);

  useEffect(() => {
    if (!id) return;

    const unsubscribeArtist = onSnapshot(
      doc(db, 'artists', id),
      (doc) => {
        if (doc.exists()) {
          const data = { id: doc.id, ...doc.data() } as Artist;
          setArtist(data);
          lastGenre.current = data.genre;
        } else {
          navigate(lastGenre.current ? `/${lastGenre.current}` : '/');
        }
        setLoading(false);
      },
      (error) => handleFirestoreError(error, OperationType.GET, `artists/${id}`)
    );

    const q = query(collection(db, 'albums'), where('artistId', '==', id));
    const unsubscribeAlbums = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Album));
        setAlbums(data);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'albums')
    );

    const qSideman = query(collection(db, 'albums'), where('sidemenIds', 'array-contains', id));
    const unsubscribeSideman = onSnapshot(
      qSideman,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Album));
        setSidemanAlbums(data);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'albums')
    );

    const qShared = query(collection(db, 'albums'), where('allArtistIds', 'array-contains', id));
    const unsubscribeShared = onSnapshot(
      qShared,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Album));
        setSharedAlbums(data);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'albums')
    );

    return () => {
      unsubscribeArtist();
      unsubscribeAlbums();
      unsubscribeSideman();
      unsubscribeShared();
    };
  }, [id, navigate]);

  const calculateAge = (birth?: string, death?: string) => {
    if (!birth) return null;
    const birthDate = new Date(birth);
    const endDate = death ? new Date(death) : new Date();
    let age = endDate.getFullYear() - birthDate.getFullYear();
    const m = endDate.getMonth() - birthDate.getMonth();

    if (m < 0 || (m === 0 && endDate.getDate() < birthDate.getDate())) {
      age--;
    }

    return age;
  };

  if (loading || !artist) {
    return (
      <div className="h-screen flex items-center justify-center font-serif italic text-2xl">
        Cargando...
      </div>
    );
  }

  const age = calculateAge(artist.birthDate, artist.deathDate);
  const groupedAlbums = groupArtistAlbums(albums, sidemanAlbums, sharedAlbums);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  return (
    <div className="space-y-12 sm:space-y-20 pb-12 sm:pb-20">
      <section className="relative min-h-[340px] h-[48vh] md:h-[60vh] flex items-end px-4 sm:px-6 pb-8 md:pb-12 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            src={portrait || '/Vinyl.jpg'}
            alt={artist.name}
            className="w-full h-full object-cover opacity-50 grayscale"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-paper via-paper/40 to-transparent" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto w-full flex flex-col md:flex-row md:items-end justify-between gap-8">
          <div className="space-y-4">
            <span className="text-xs uppercase tracking-widest font-bold text-gold">
              {artist.genre}
            </span>
            <h1 className="font-serif text-4xl sm:text-6xl md:text-8xl tracking-tight leading-tight break-words">
              {artist.name}
            </h1>
          </div>

          <div className="flex gap-4">
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-2 px-6 py-3 bg-ink text-paper rounded-full text-sm font-medium hover:bg-gold transition-colors"
            >
              <Edit2 size={18} />
              <span>Editar Biografía</span>
            </button>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-3 gap-10 lg:gap-20">
        <div className="lg:col-span-2 space-y-12">
          {artist.biography && (
            <div className="space-y-6">
              <h2 className="text-xs uppercase tracking-widest font-bold text-gold">
                Biografía
              </h2>

              {artist.biographySections && artist.biographySections.length > 0 ? (
                <div className="space-y-4">
                  {artist.biographySections.map((section, index) => (
                    <div
                      key={index}
                      className="rounded-xl border border-stone-200 bg-white/70 p-4 shadow-sm"
                    >
                      <h3 className="mb-2 text-lg font-semibold text-stone-800">
                        {section.title}
                      </h3>
                      <p className="leading-relaxed text-stone-700 whitespace-pre-line">
                        {section.content}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="prose prose-ink max-w-none">
                  {artist.biography
                    ?.split(/\n+/)
                    .filter((p) => p.trim() !== '')
                    .map((paragraph, index) => (
                      <p
                        key={index}
                        className="text-lg leading-relaxed text-ink/80"
                      >
                        {paragraph}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-xs uppercase tracking-widest font-bold text-gold">
                Discografía Principal
              </h2>
              <button
                onClick={() => setIsAddingAlbum(true)}
                className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest hover:text-gold transition-colors"
              >
                <Plus size={16} />
                <span>Añadir Álbum</span>
              </button>
            </div>

            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-8">
              {groupedAlbums.primary.map((album) => (
                <div key={album.id}>
                  <AlbumCard album={album} />
                </div>
              ))}

              {groupedAlbums.primary.length === 0 && (
                <p className="col-span-full text-ink/40 font-serif italic">
                  No hay álbumes principales registrados.
                </p>
              )}
            </div>
          </div>

          {groupedAlbums.collaborations.length > 0 && (
            <div className="space-y-8">
              <h2 className="text-xs uppercase tracking-widest font-bold text-gold">
                Colaboraciones (Sideman)
              </h2>
              <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-8">
                {groupedAlbums.collaborations.map((album) => (
                  <div key={album.id}>
                    <AlbumCard album={album} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {groupedAlbums.otherShared.length > 0 && (
            <div className="space-y-8">
              <h2 className="text-xs uppercase tracking-widest font-bold text-gold">
                Álbumes Compartidos
              </h2>
              <p className="text-sm text-ink/50 -mt-4">
                Estos discos incluyen grabaciones de varios artistas. Las grabaciones de {artist?.name} están destacadas en dorado.
              </p>
              <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-3 gap-4 sm:gap-8">
                {groupedAlbums.otherShared.map((album) => (
                  <div key={album.id}>
                    <AlbumCard album={album} highlightArtistId={id} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-12">
          <div className="bg-ink/5 p-8 rounded-3xl space-y-6">
            <h3 className="font-serif text-2xl italic">
              Detalles del Artista
            </h3>

            <div className="space-y-4 text-sm">
              {artist.instruments && artist.instruments.length > 0 && (
                <div className="flex justify-between py-2 border-b border-ink/10">
                  <span className="text-ink/40 uppercase tracking-widest font-bold text-[10px]">
                    Instrumentos
                  </span>
                  <span className="text-right">{artist.instruments.join(', ')}</span>
                </div>
              )}

              {((artist.periods && artist.periods.length > 0) || artist.period) && (
                <div className="flex justify-between py-2 border-b border-ink/10">
                  <span className="text-ink/40 uppercase tracking-widest font-bold text-[10px]">
                    {artist.genre === 'jazz' ? 'Sub-géneros' : 'Periodos'}
                  </span>
                  <span className="text-right">
                    {artist.periods?.join(', ') || artist.period}
                  </span>
                </div>
              )}

              {artist.birthDate && (
                <div className="flex justify-between py-2 border-b border-ink/10">
                  <span className="text-ink/40 uppercase tracking-widest font-bold text-[10px]">
                    Nacimiento
                  </span>
                  <div className="text-right">
                    <div>{formatDate(artist.birthDate)}</div>
                    {artist.birthPlace && (
                      <div className="text-[10px] text-ink/40">
                        {artist.birthPlace}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {artist.deathDate && (
                <div className="flex justify-between py-2 border-b border-ink/10">
                  <span className="text-ink/40 uppercase tracking-widest font-bold text-[10px]">
                    Fallecimiento
                  </span>
                  <div className="text-right">
                    <div>{formatDate(artist.deathDate)}</div>
                    <div className="text-[10px] text-ink/40">
                      {artist.deathPlace}
                    </div>
                  </div>
                </div>
              )}

              {age !== null && (
                <div className="flex justify-between py-2 border-b border-ink/10">
                  <span className="text-ink/40 uppercase tracking-widest font-bold text-[10px]">
                    Edad {artist.deathDate ? 'al fallecer' : 'actual'}
                  </span>
                  <span>{age} años</span>
                </div>
              )}

              <div className="flex justify-between py-2 border-b border-ink/10">
                <span className="text-ink/40 uppercase tracking-widest font-bold text-[10px]">
                  Género
                </span>
                <span className="capitalize">{artist.genre}</span>
              </div>
            </div>
          </div>

          <div className="aspect-[3/4] rounded-3xl overflow-hidden shadow-xl">
            <img
              src={portrait || '/Vinyl.jpg'}
              alt={artist.name}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      </section>

      <AnimatePresence>
        {isEditing && (
          <ArtistModal
            artist={artist}
            genre={artist.genre}
            onClose={() => setIsEditing(false)}
          />
        )}

        {isAddingAlbum && (
          <AlbumModal
            artistId={artist.id}
            genre={artist.genre}
            onClose={() => setIsAddingAlbum(false)}
          />
        )}
      </AnimatePresence>

      {showLoadingPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="rounded-2xl bg-white px-8 py-6 shadow-xl text-center space-y-3">
            <div className="text-lg font-semibold text-ink">
              Cargando artista...
            </div>
            <div className="text-sm text-ink/60">
              Esto puede tardar unos segundos
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AlbumCard({ album, viewMode = 'grid', highlightArtistId }: { album: Album, viewMode?: 'grid' | 'list', highlightArtistId?: string }) {
  const [status, setStatus] = useState<'owned' | 'wishlist' | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isViewing, setIsViewing] = useState(false);
  const [artistName, setArtistName] = useState<string>('');

  useEffect(() => {
    const q = query(collection(db, 'collection'), where('userId', '==', 'public'), where('albumId', '==', album.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        setStatus(snapshot.docs[0].data().status);
      } else {
        setStatus(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'collection');
    });
    return unsubscribe;
  }, [album.id]);

  useEffect(() => {
    const fetchArtist = async () => {
      const artistDoc = await getDoc(doc(db, 'artists', album.artistId));
      if (artistDoc.exists()) {
        setArtistName(artistDoc.data().name);
      }
    };
    fetchArtist();
  }, [album.artistId]);

  if (viewMode === 'list') {
    return (
      <div 
        onClick={() => setIsViewing(true)}
        className="group flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-6 p-3 sm:p-4 rounded-2xl hover:bg-ink/5 transition-colors cursor-pointer"
      >
        <div className="w-16 h-16 rounded-xl overflow-hidden bg-ink/5 flex-shrink-0 shadow-sm">
          {album.imageUrl ? (
            <img 
              src={album.imageUrl} 
              loading="lazy" decoding="async"
              alt={album.title} 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink/10">
              <DiscIcon size={24} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif text-xl group-hover:text-gold transition-colors truncate" title={album.title}>{album.title}</h3>
          <p className="text-[10px] uppercase tracking-widest text-ink/40 font-bold truncate">
            {artistName}{getCatalogRecordType(album) === 'work' ? ' • Obra musical' : ''}{album.releaseYear && ` • ${album.releaseYear}`}{album.label && ` • ${album.label}`}
          </p>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end sm:justify-start">
          <CollectionButton albumId={album.id} status="owned" currentStatus={status} />
          <CollectionButton albumId={album.id} status="wishlist" currentStatus={status} />
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            className="p-2 text-ink/20 hover:text-gold transition-colors"
          >
            <Edit2 size={16} />
          </button>
        </div>
        <AnimatePresence>
          {isViewing && (
            <AlbumDetailModal 
              album={album}
              highlightArtistId={highlightArtistId}
              onClose={() => setIsViewing(false)} 
              onEdit={() => {
                setIsViewing(false);
                setIsEditing(true);
              }}
            />
          )}
          {isEditing && (
            <AlbumModal 
              album={album} 
              artistId={album.artistId} 
              genre={album.genre} 
              onClose={() => setIsEditing(false)} 
            />
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="group min-w-0 space-y-3">
      <div 
        onClick={() => setIsViewing(true)}
        className="relative aspect-square rounded-xl overflow-hidden bg-ink/5 shadow-md group-hover:shadow-xl transition-all duration-500 cursor-pointer"
      >
        {album.imageUrl ? (
          <img 
            src={album.imageUrl} 
            alt={album.title} 
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink/10">
            <DiscIcon size={48} />
          </div>
        )}
        
        <div className="album-card-actions absolute top-2 right-2 flex flex-col gap-2 md:translate-x-12 md:group-hover:translate-x-0 transition-transform duration-300">
          <CollectionButton albumId={album.id} status="owned" currentStatus={status} />
          <CollectionButton albumId={album.id} status="wishlist" currentStatus={status} />
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            className="w-8 h-8 rounded-full bg-paper/90 backdrop-blur-sm flex items-center justify-center text-ink hover:text-gold transition-colors shadow-sm"
          >
            <Edit2 size={14} />
          </button>
        </div>

        {status && (
          <div className={cn(
            "absolute bottom-2 left-2 px-3 py-1 rounded-full text-[10px] uppercase tracking-widest font-bold shadow-sm",
            status === 'owned' ? "bg-emerald-500 text-white" : "bg-gold text-white"
          )}>
            {status === 'owned' ? 'En Casa' : 'Deseado'}
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-1 overflow-hidden cursor-pointer" onClick={() => setIsViewing(true)}>
        <h4 className="block w-full min-w-0 truncate font-serif text-lg leading-tight group-hover:text-gold transition-colors" title={album.title}>{album.title}</h4>
        <div className="min-w-0 space-y-1">
          <p className="block w-full min-w-0 truncate text-xs uppercase tracking-wide text-ink/60 font-bold" title={artistName}>
            {artistName}{getCatalogRecordType(album) === 'work' ? ' · Obra musical' : ''}
          </p>
          <p className="block w-full min-w-0 truncate text-xs uppercase tracking-wide text-ink/50 font-bold"
            title={[album.releaseYear, album.label].filter(Boolean).join(' • ')}>
            {[album.releaseYear, album.label].filter(Boolean).join(' • ')}
          </p>
        </div>
      </div>

      <AnimatePresence>
        {isViewing && (
          <AlbumDetailModal 
            album={album} 
            onClose={() => setIsViewing(false)} 
            onEdit={() => {
              setIsViewing(false);
              setIsEditing(true);
            }}
          />
        )}
        {isEditing && (
          <AlbumModal 
            album={album} 
            artistId={album.artistId} 
            genre={album.genre} 
            onClose={() => setIsEditing(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CollectionButton({ albumId, status, currentStatus }: { albumId: string, status: 'owned' | 'wishlist', currentStatus: string | null }) {
  const { canAccess } = useAuth();
  const isActive = currentStatus === status;

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canAccess) return;
    
    try {
      const collectionRef = collection(db, 'collection');
      const q = query(collectionRef, where('userId', '==', 'public'), where('albumId', '==', albumId));
      
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        const docRef = doc(db, 'collection', querySnapshot.docs[0].id);
        if (isActive) {
          await deleteDoc(docRef);
        } else {
          await updateDoc(docRef, { status });
        }
      } else {
        await addDoc(collectionRef, { 
          userId: 'public', 
          albumId, 
          status,
          addedAt: new Date().toISOString()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'collection');
    }
  };

  return (
    <button 
      onClick={handleClick}
      disabled={!canAccess}
      aria-label={!canAccess ? 'Acceso reservado a los dos miembros' : undefined}
      className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm",
        isActive ? "bg-gold text-white" : "bg-paper/90 backdrop-blur-sm text-ink hover:text-gold"
      )}
      title={status === 'owned' ? 'Lo tengo' : 'Lo quiero'}
    >
      {status === 'owned' ? <DiscIcon size={14} /> : <Heart size={14} className={isActive ? "fill-current" : ""} />}
    </button>
  );
}

// --- Seed Data Utility ---
// Para usar imágenes locales, coloca tus archivos en la carpeta correspondiente:
// Jazz:
//   Artistas: /public/photos/jazz/artists/ -> imageUrl: '/photos/jazz/artists/archivo.jpg'
//   Álbumes:  /public/photos/jazz/albums/  -> imageUrl: '/photos/jazz/albums/archivo.jpg'
// Clásica:
//   Artistas: /public/photos/classical/artists/ -> imageUrl: '/photos/classical/artists/archivo.jpg'
//   Álbumes:  /public/photos/classical/albums/  -> imageUrl: '/photos/classical/albums/archivo.jpg'

const SEED_DATA: { artist: Partial<Artist>, albums: Partial<Album>[] }[] = [
  { 
    artist: { 
      name: 'Miles Davis', 
      genre: 'jazz', 
      birthDate: '1926-05-26',
      deathDate: '1991-09-28',
      biography: 'Miles Dewey Davis III fue un trompetista y compositor estadounidense de jazz. Se trata de una de las figuras más relevantes, innovadoras e influyentes de la historia del jazz.', 
      imageUrl: 'https://images.unsplash.com/photo-1485579149621-3123dd979885?auto=format&fit=crop&q=80&w=1000' 
    },
    albums: [
      { title: 'Kind of Blue', releaseYear: '1959', imageUrl: 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&q=80&w=600', genre: 'jazz' },
      { title: 'Bitches Brew', releaseYear: '1970', imageUrl: 'https://images.unsplash.com/photo-1459749411177-042180ce673c?auto=format&fit=crop&q=80&w=600', genre: 'jazz' }
    ]
  },
  { 
    artist: { 
      name: 'John Coltrane', 
      genre: 'jazz', 
      birthDate: '1926-09-23',
      deathDate: '1967-07-17',
      biography: 'John William Coltrane fue un saxofonista tenor y saxofonista soprano estadounidense de jazz. Ocasionalmente tocó el saxo alto y la flauta.', 
      imageUrl: 'https://images.unsplash.com/photo-1511192336575-5a79af67a629?auto=format&fit=crop&q=80&w=1000' 
    },
    albums: [
      { title: 'A Love Supreme', releaseYear: '1965', imageUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=600', genre: 'jazz' },
      { title: 'Blue Train', releaseYear: '1958', imageUrl: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?auto=format&fit=crop&q=80&w=600', genre: 'jazz' }
    ]
  },
  { 
    artist: { 
      name: 'Ludwig van Beethoven', 
      genre: 'classical', 
      birthDate: '1770-12-17',
      deathDate: '1827-03-26',
      periods: ['Clásico', 'Romántico'],
      biography: 'Ludwig van Beethoven fue un compositor, director de orquesta y pianista alemán. Su legado musical abarca, cronológicamente, desde el Clasicismo hasta los inicios del Romanticismo.', 
      imageUrl: 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?auto=format&fit=crop&q=80&w=1000' 
    },
    albums: [
      { title: 'Symphony No. 9', releaseYear: '1824', imageUrl: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&q=80&w=600', genre: 'classical' },
      { title: 'Moonlight Sonata', releaseYear: '1801', imageUrl: 'https://images.unsplash.com/photo-1520529011850-be19705970ff?auto=format&fit=crop&q=80&w=600', genre: 'classical' }
    ]
  },
  { 
    artist: { 
      name: 'Wolfgang Amadeus Mozart', 
      genre: 'classical', 
      birthDate: '1756-01-27',
      deathDate: '1791-12-05',
      periods: ['Clásico'],
      biography: 'Wolfgang Amadeus Mozart fue un compositor, pianista, director de orquesta y profesor del antiguo Arzobispado de Salzburgo, maestro del Clasicismo.', 
      imageUrl: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&q=80&w=1000' 
    },
    albums: [
      { title: 'Requiem', releaseYear: '1791', imageUrl: 'https://images.unsplash.com/photo-1465821185615-20b3c2fbf41b?auto=format&fit=crop&q=80&w=600', genre: 'classical' },
      { title: 'The Marriage of Figaro', releaseYear: '1786', imageUrl: 'https://images.unsplash.com/photo-1514119412350-e174d90d280e?auto=format&fit=crop&q=80&w=600', genre: 'classical' }
    ]
  },
  { 
    artist: { 
      name: 'Max Reger', 
      genre: 'classical', 
      birthDate: '1873-03-19',
      deathDate: '1916-05-11',
      periods: ['Romántico Tardío'],
      biography: 'Johann Baptist Joseph Maximilian Reger fue un compositor, organista, pianista and director de orquesta alemán.', 
      imageUrl: 'https://images.unsplash.com/photo-1507838153414-b4b713384a76?auto=format&fit=crop&q=80&w=1000' 
    },
    albums: [
      { title: 'Variations and Fugue on a Theme by Mozart', releaseYear: '1914', imageUrl: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&q=80&w=600', genre: 'classical' }
    ]
  },
];

function SearchPage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<'year' | 'artist' | 'title' | 'label'>('year');
  const [recordTypeFilter, setRecordTypeFilter] = useState<'all' | CatalogRecordType>('all');
  const [genreFilter, setGenreFilter] = useState<'all' | Genre>('all');
  const [formatFilter, setFormatFilter] = useState('all');
  const [labelFilter, setLabelFilter] = useState('all');
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    const q = query(collection(db, 'albums'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAlbums(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Album)));
    });
    return unsubscribe;
  }, []);

  const normalizeSearch = (value: unknown) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
  const normalizedQuery = normalizeSearch(searchText);
  const availableLabels = Array.from(new Set<string>(albums.flatMap(album =>
    normalizeRecordLabels(album.label).split(',').map(value => value.trim()).filter(Boolean))))
    .sort((a, b) => a.localeCompare(b));
  const availableFormats = Array.from(new Set(albums.flatMap(album => album.formats || []))).sort();

  const filteredAlbums = [...albums]
    .filter((album) => {
      if (genreFilter !== 'all' && album.genre !== genreFilter) return false;
      if (recordTypeFilter !== 'all' && getCatalogRecordType(album) !== recordTypeFilter) return false;
      if (formatFilter !== 'all' && !(album.formats || []).includes(formatFilter as 'CD' | 'Vinilo' | 'DVD' | 'Bluray')) return false;
      if (labelFilter !== 'all' && !normalizeRecordLabels(album.label).split(',').some(value => normalizeSearch(value) === normalizeSearch(labelFilter))) return false;
      const year = Number(album.releaseYear);
      if (yearFrom && (!year || year < Number(yearFrom))) return false;
      if (yearTo && (!year || year > Number(yearTo))) return false;
      if (!normalizedQuery) return true;

      const searchableValues = [
        album.title,
        album.artistName,
        album.label,
        album.catalogNumber,
        album.originalLabel,
        album.originalCatalogNumber,
        album.editionCatalogNumber,
        album.releaseYear,
        album.recordingDates,
        album.location,
        album.country,
        album.producer,
        album.engineer,
        album.masteringEngineer,
        album.orchestra,
        album.conductor,
        ...(album.formats || []),
        ...(album.musicians || []).flatMap((m) => [m.name, m.instrument, m.notes || '']),
        ...(album.soloists || []).flatMap((s) => [s.name, s.instrument, s.birthPlace || '', s.deathPlace || '']),
        ...(album.tracks || []).flatMap(track => [track.title, track.orchestra || '', track.conductor || '', ...(track.soloists || []).map(soloist => soloist.name)]),
        ...(album.discs || []).flatMap(disc => [
          disc.title || '',
          ...(disc.works || []).flatMap(work => [
            work.title, work.composer || '', work.orchestra || '', work.conductor || '',
            ...(work.soloists || []).map(soloist => soloist.name),
            ...(work.movements || []).flatMap(movement => [
              movement.title, movement.orchestra || '', movement.conductor || '',
              ...(movement.soloists || []).map(soloist => soloist.name)
            ])
          ])
        ]),
      ]
        .filter(Boolean)
        .join(' ');
      const searchable = normalizeSearch(searchableValues);
      return normalizedQuery.split(/\s+/).every(word => searchable.includes(word));
    })
    .sort((a, b) => {
      if (sortBy === 'year') return Number(a.releaseYear || 0) - Number(b.releaseYear || 0);
      if (sortBy === 'artist') return String(a.artistName || '').localeCompare(String(b.artistName || ''));
      if (sortBy === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
      return String(a.label || '').localeCompare(String(b.label || ''));
    });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-20 space-y-8 sm:space-y-10">
      <div className="space-y-4">
        <span className="text-xs uppercase tracking-widest font-bold text-gold">Búsqueda avanzada</span>
        <h1 className="font-serif text-4xl sm:text-5xl md:text-7xl leading-tight">Buscar grabaciones</h1>
        <p className="text-ink/65 max-w-3xl leading-relaxed">
          Localiza registros por artista, título, sello, número de catálogo, año, personal artístico y otros metadatos presentes en tu catálogo.
        </p>
      </div>

      <div className="rounded-3xl border border-ink/10 bg-white p-5 md:p-6 shadow-sm space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.5fr_0.75fr_0.75fr] gap-4">
          <input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Buscar artista, álbum, sello, catálogo, músico..."
            className="w-full bg-ink/5 rounded-2xl px-4 py-3 border-none focus:ring-2 focus:ring-gold transition-all"
          />
          <select
            value={genreFilter}
            onChange={(e) => setGenreFilter(e.target.value as 'all' | Genre)}
            className="w-full bg-ink/5 rounded-2xl px-4 py-3 border-none focus:ring-2 focus:ring-gold transition-all"
          >
            <option value="all">Todos los géneros</option>
            <option value="jazz">Jazz</option>
            <option value="classical">Clásica</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'year' | 'artist' | 'title' | 'label')}
            className="w-full bg-ink/5 rounded-2xl px-4 py-3 border-none focus:ring-2 focus:ring-gold transition-all"
          >
            <option value="year">Ordenar por año</option>
            <option value="artist">Ordenar por artista</option>
            <option value="title">Ordenar por título</option>
            <option value="label">Ordenar por sello</option>
          </select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink/60">Tipo de registro
            <select value={recordTypeFilter} onChange={e => setRecordTypeFilter(e.target.value as 'all' | CatalogRecordType)} className="w-full min-w-0 bg-ink/5 rounded-xl px-3 py-3 text-base text-ink border-none">
              <option value="all">Obras y grabaciones</option>
              <option value="recording">Discos / grabaciones</option>
              <option value="work">Obras musicales</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink/60">Sello discográfico
            <select value={labelFilter} onChange={e => setLabelFilter(e.target.value)}
              className="w-full min-w-0 bg-ink/5 rounded-xl px-3 py-3 text-base text-ink border-none">
              <option value="all">Todos los sellos</option>
              {availableLabels.map(label => <option key={label} value={label}>{label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink/60">Formato
            <select value={formatFilter} onChange={e => setFormatFilter(e.target.value)}
              className="w-full min-w-0 bg-ink/5 rounded-xl px-3 py-3 text-base text-ink border-none">
              <option value="all">Todos los formatos</option>
              {availableFormats.map(format => <option key={format} value={format}>{format}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink/60">Año desde
            <input type="number" inputMode="numeric" min="1000" max="2100" placeholder="Ej. 1950"
              value={yearFrom} onChange={e => setYearFrom(e.target.value)}
              className="w-full bg-ink/5 rounded-xl px-3 py-3 text-base text-ink border-none" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink/60">Año hasta
            <input type="number" inputMode="numeric" min="1000" max="2100" placeholder="Ej. 2000"
              value={yearTo} onChange={e => setYearTo(e.target.value)}
              className="w-full bg-ink/5 rounded-xl px-3 py-3 text-base text-ink border-none" />
          </label>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-ink/50">
            {filteredAlbums.length} resultado{filteredAlbums.length === 1 ? '' : 's'}
          </p>
          <button type="button" className="text-xs underline text-ink/60" onClick={() => {
            setSearchText(''); setGenreFilter('all'); setFormatFilter('all'); setLabelFilter('all'); setRecordTypeFilter('all'); setYearFrom(''); setYearTo('');
          }}>Limpiar filtros</button>
          <div className="flex bg-ink/5 p-1 rounded-full w-fit">
            <button onClick={() => setViewMode('grid')} className={cn("p-2 rounded-full", viewMode === 'grid' ? "bg-paper text-gold" : "text-ink/40")}>
              <LayoutGrid size={18} />
            </button>
            <button onClick={() => setViewMode('list')} className={cn("p-2 rounded-full", viewMode === 'list' ? "bg-paper text-gold" : "text-ink/40")}>
              <List size={18} />
            </button>
          </div>
        </div>
      </div>

      {filteredAlbums.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-ink/15 p-10 text-center text-ink/50 bg-white">
          No se encontraron grabaciones con esos criterios.
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
          {filteredAlbums.map((album) => (
            <div key={album.id}><AlbumCard album={album} viewMode="grid" /></div>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-ink/10 bg-white overflow-hidden divide-y divide-ink/10">
          {filteredAlbums.map((album) => (
            <div key={album.id} className="p-2">
              <AlbumCard album={album} viewMode="list" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function uploadWordFileToStorage(file: File) {
  const storagePath = `imports/word/${Date.now()}-${file.name}`;
  const storageRef = ref(storage, storagePath);
  const snapshot = await uploadBytes(storageRef, file);
  const downloadURL = await getDownloadURL(snapshot.ref);
  return { storagePath, downloadURL };
}

/** Firestore has a 1 MiB/document limit. Large reviews live in authenticated Storage. */
async function persistWordReview(jobId:string, parsed:ParsedWordImport, editions:ReviewedEdition[]) {
  const serialized=JSON.stringify({extractedData:parsed,reviewedEditions:editions});
  if(new TextEncoder().encode(serialized).length<600000){
    return {extractedData:parsed,reviewedEditions:editions,dataUrl:''};
  }
  const place=ref(storage,'imports/word/reviews/'+jobId+'.json');
  const snapshot=await uploadBytes(place,new Blob([serialized],{type:'application/json'}));
  return {extractedData:null,reviewedEditions:[],dataUrl:await getDownloadURL(snapshot.ref)};
}

async function uploadWordDocument(file: File): Promise<ParsedWordImport> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await privateApiFetch('/api/import-word', {
    method: 'POST',
    body: formData,
  });

  const rawText = await response.text();

  let payload: any = null;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    throw new Error(
      `Server returned a non-JSON response (${response.status}). Body: ${rawText.slice(0, 300)}`
    );
  }

  if (!response.ok) {
    throw new Error(payload?.error || 'No se pudo procesar el archivo Word.');
  }

  return payload as ParsedWordImport;
}

function ImportWordPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [batchResults, setBatchResults] = useState<Array<{file:File;data:ParsedWordImport|null;error:string;editions?:ReviewedEdition[]}>>([]);
  const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
  const [reviewedEditions, setReviewedEditions] = useState<ReviewedEdition[]>([]);
  const [existingArtist, setExistingArtist] = useState<Artist | null>(null);
  const [catalogForReview, setCatalogForReview] = useState<Album[]>([]);
  const [biographyChoice, setBiographyChoice] = useState<'keep'|'replace'|'edit'>('keep');
  const [biographyDraft, setBiographyDraft] = useState('');
  const [backupReady, setBackupReady] = useState(false);
  const [backupDetails, setBackupDetails] = useState('');
  const [activeJobId, setActiveJobId] = useState('');
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [restorePreview, setRestorePreview] = useState<{artist:Artist|null;albums:Album[]}|null>(null);
  const [parsedData, setParsedData] = useState<ParsedWordImport | null>(null);
  const [recentImports, setRecentImports] = useState<ImportJobRecord[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [importGenreSelection, setImportGenreSelection] = useState<Genre>('classical');
  const [discogsMatches, setDiscogsMatches] = useState<Record<string, Array<{id:number;title:string;year:string;catno:string;labels:string[];formats:string[]}>>>({});
  const [discogsSelection, setDiscogsSelection] = useState<Record<string,string>>({});
  const [enrichedWordAlbums, setEnrichedWordAlbums] = useState<Record<string, WordAlbumCandidate & {
    imageUrl?: string; discogsReleaseId?: number; discs?: Disc[]; tracks?: Track[];
    producer?: string; engineer?: string; conductor?: string; orchestra?: string;
  }>>({});
  const [enrichingAlbum, setEnrichingAlbum] = useState('');
  const [enrichMessage, setEnrichMessage] = useState('');
  const [batchSearching, setBatchSearching] = useState(false);
  const extractedCandidates = wordAlbumCandidates(parsedData?.albums || [], parsedData?.recordings || []);
  const albumsForImport = reviewedEditions;
  const markReviewChanged = () => { setBackupReady(false); setBackupDetails(''); };
  const updateReviewedEdition = (key:string, change:(edition:ReviewedEdition)=>ReviewedEdition) => {
    setReviewedEditions(current=>current.map(item=>item.sourceKey===key?change(item):item));
    markReviewChanged();
  };
  const setActiveParsed = (result:ParsedWordImport|null, editions?:ReviewedEdition[]) => {
    setParsedData(result);
    setReviewedEditions(editions || (result?wordAlbumCandidates(result.albums||[],result.recordings||[]).map(makeReview):[]));
    setExistingArtist(null);
    setBiographyChoice('keep');
    setBiographyDraft(result?.composer?.biography||'');
    setDiscogsMatches({});
    setDiscogsSelection({});
    setEnrichedWordAlbums({});
    setBackupReady(false);
    setBackupDetails('');
  };

  useEffect(() => {
    const importsQuery = query(collection(db, 'import_jobs'));
    const unsubscribe = onSnapshot(importsQuery, (snapshot) => {
      const jobs = snapshot.docs
        .map((jobDoc) => ({ id: jobDoc.id, ...jobDoc.data() } as ImportJobRecord))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      setRecentImports(jobs.slice(0, 8));
    });

    return unsubscribe;
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []) as File[];
    const valid = files.filter(file=>file.name.toLowerCase().endsWith('.docx') && file.size <= 8*1024*1024);
    setPendingFiles(valid);
    setSelectedFile(valid[0]||null);
    setCurrentBatchIndex(0);
    setBatchResults([]);
    setActiveJobId('');
    setActiveParsed(null);
    setMessage(valid.length!==files.length?'Sólo se admiten .docx de hasta 8 MB. Se omitieron archivos no válidos.':'');
    setEnrichMessage('');
  };

  const handleProcessFile = async () => {
    if (!pendingFiles.length) {
      setMessage('Selecciona uno o varios archivos .docx antes de continuar.');
      return;
    }
    setIsUploading(true);setIsBatchProcessing(true);setMessage('');
    const results:Array<{file:File;data:ParsedWordImport|null;error:string}>=[];
    for(const [index,file] of pendingFiles.entries()){
      setMessage(`Procesando archivo ${index+1}/${pendingFiles.length}: ${file.name}`);
      try {
        const data=await uploadWordDocument(file);
        results.push({file,data,error:''});
      }catch(error){
        results.push({file,data:null,error:error instanceof Error?error.message:String(error)});
      }
    }
    setBatchResults(results);
    const first=results.findIndex(item=>Boolean(item.data));
    if(first>=0){
      setCurrentBatchIndex(first);setSelectedFile(results[first].file);
      setActiveParsed(results[first].data);
    }
    setMessage(`${results.filter(r=>r.data).length}/${results.length} archivo(s) procesados. Revisa y aprueba cada documento por separado.`);
    setIsUploading(false);setIsBatchProcessing(false);
  };
  const activateBatch = (index:number)=>{
    const item=batchResults[index];
    if(!item)return;
    setBatchResults(current=>current.map((entry,i)=>i===currentBatchIndex
      ? {...entry,data:parsedData,editions:reviewedEditions}:entry));
    setCurrentBatchIndex(index);setSelectedFile(item.file);setActiveJobId('');
    setActiveParsed(item.data,item.editions);
    setMessage(item.error||`Revisando ${item.file.name}`);
  };
  useEffect(()=>{
    if(!parsedData){setCatalogForReview([]);return;}
    let active=true;
    getDocs(collection(db,'albums')).then(snapshot=>{
      if(active)setCatalogForReview(snapshot.docs.map(item=>({id:item.id,...item.data()} as Album)));
    }).catch(()=>{if(active)setMessage('No se pudo revisar el catálogo existente. Comprueba la conexión.');});
    return()=>{active=false;};
  },[parsedData?.sourceFileName, parsedData?.composer?.name]);
  useEffect(()=>{
    const name=parsedData?.composer?.name?.trim();
    if(!name){setExistingArtist(null);return;}
    let active=true;
    getArtistByName(name).then(artist=>{
      if(active) setExistingArtist(artist||null);
    }).catch(()=>{if(active)setMessage('No se pudo comprobar si el artista ya existe; no guardes hasta revisar la conexión.');});
    return()=>{active=false};
  },[parsedData?.composer?.name]);

  const lookupWordAlbum = async (album: ReviewedEdition) => {
    const key = album.sourceKey;
    const identifier = album.barcode || album.catalogNumber;
    if (!identifier) {
      setEnrichMessage('El álbum necesita un código de barras o número de catálogo para buscar en Discogs.');
      return;
    }
    setEnrichingAlbum(key);
    setEnrichMessage('');
    try {
      const param = album.barcode ? 'barcode' : 'catno';
      const response = await privateApiFetch('/api/discogs-search-by-catalog?' + param + '=' + encodeURIComponent(identifier));
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'No se encontró en Discogs.');
      const candidates = (Array.isArray(result.candidates) ? result.candidates : []).filter((item: {labels:string[];formats:string[]}) => {
        // Keep alternative labels visible: a different sello is a review conflict, not a hidden result.
        const documentFormat = normalizePhysicalFormat(album.format);
        const formatMatch = !documentFormat || item.formats.some(format => normalizePhysicalFormat(format) === documentFormat);
        return formatMatch;
      });
      setDiscogsMatches(current => ({...current, [key]: candidates}));
      setEnrichMessage(candidates.length ? 'Elige la edición exacta antes de completar sus datos.' :
        'No se encontraron ediciones compatibles con el sello/formato del documento. Conservamos los datos originales.');
    } catch (error) {
      setEnrichMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setEnrichingAlbum('');
    }
  };

  const searchAllWordAlbums = async () => {
    const searchables = reviewedEditions.filter(album => album.include && (album.barcode || album.catalogNumber));
    if (!searchables.length) {
      setEnrichMessage('No hay números de catálogo ni códigos de barras para buscar.');
      return;
    }
    setBatchSearching(true);
    setEnrichMessage(`Buscando ${searchables.length} ediciones en Discogs. Los resultados requieren revisión.`);
    try {
      // Sequential requests avoid sending a burst to Discogs from a single import.
      for (let index = 0; index < searchables.length; index++) {
        await lookupWordAlbum(searchables[index]);
        setEnrichMessage(`Búsquedas completadas: ${index + 1}/${searchables.length}. Elige las ediciones correctas antes de guardar.`);
      }
    } finally {
      setBatchSearching(false);
    }
  };

  const confirmWordDiscogsRelease = async (album: ReviewedEdition) => {
    const key = album.sourceKey;
    const releaseId = discogsSelection[key];
    if (!releaseId || !discogsMatches[key]?.some(item => String(item.id) === releaseId)) return;
    setEnrichingAlbum(key);
    setEnrichMessage('');
    try {
      const response = await privateApiFetch('/api/discogs-search-by-catalog?releaseId=' + encodeURIComponent(releaseId));
      const found = await response.json();
      if (!response.ok) throw new Error(found?.error || 'No se pudo cargar la edición.');
      const selectedCandidate=discogsMatches[key].find(item=>String(item.id)===releaseId);
      if(!selectedCandidate)throw new Error('La edición no está entre las opciones verificadas.');
      const releaseFormat=selectedCandidate.formats.map(normalizePhysicalFormat).find(Boolean);
      if(album.format && releaseFormat && normalizePhysicalFormat(album.format)!==releaseFormat) {
        throw new Error('El formato elegido no coincide con el ejemplar del Word. Selecciona la edición correcta.');
      }
      updateReviewedEdition(key,current=>reviewDiscogsMatch(current,{
        releaseId:Number(releaseId),
        title:found.title||'',label:String(found.label||'').split(',')[0].trim(),
        catno:found.catno||'',year:String(found.year||''),country:found.country||'',
        imageUrl:found.coverImage||found.thumb||'',discCount:found.discCount,
        discs:Array.isArray(found.discs)?found.discs:[]
      }));
      setEnrichMessage('Discogs contrastado. Resuelve los campos contradictorios antes de guardar.');
    } catch (error) {
      setEnrichMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setEnrichingAlbum('');
    }
  };

  const resolveJobId = async () => {
    if (activeJobId) return activeJobId;
    if (!selectedFile) throw new Error('Selecciona de nuevo el Word.');
    const hash = await crypto.subtle.digest('SHA-256', await selectedFile.arrayBuffer());
    return 'word_' + Array.from(new Uint8Array(hash)).map(value => value.toString(16).padStart(2, '0')).join('');
  };
  const handleSaveDraft = async () => {
    if (!parsedData || (!selectedFile && !activeJobId)) return;
    setIsSavingDraft(true);setMessage('');
    try {
      const jobId = await resolveJobId(), jobRef = doc(db, 'import_jobs', jobId);
      const previous = await getDoc(jobRef);
      if (previous.exists() && previous.data().status === 'approved') {
        setMessage('Este Word ya fue importado. No se sobrescribirán registros anteriores.');return;
      }
      const upload = selectedFile && !previous.data()?.fileUrl ? await uploadWordFileToStorage(selectedFile) : null;
      await setDoc(jobRef, {
        fileName: selectedFile?.name || parsedData.sourceFileName || previous.data()?.fileName || 'Word',
        createdAt: previous.data()?.createdAt || new Date().toISOString(),
        status: 'draft', source: 'word_upload', importGenre:importGenreSelection,
        fileUrl: upload?.downloadURL || previous.data()?.fileUrl || '',
        storagePath: upload?.storagePath || previous.data()?.storagePath || '',
        ...(await persistWordReview(jobId,parsedData,reviewedEditions)),
        completedAlbumIds: previous.data()?.completedAlbumIds || [],
      }, {merge:true});
      setActiveJobId(jobId);
      setMessage('Borrador guardado. Se puede recuperar desde el historial.');
    } catch(error) {
      setMessage('Error guardando borrador: ' + (error instanceof Error ? error.message : String(error)));
    } finally {setIsSavingDraft(false);}
  };
  const resumeWordJob = async (job:ImportJobRecord) => {
    if((!job.extractedData&&!job.dataUrl)||job.status==='approved'){
      setMessage('Este trabajo está aprobado o no tiene datos que reanudar.');return;
    }
    try {
      let parsed=job.extractedData||null,editions=job.reviewedEditions;
      if(!parsed&&job.dataUrl){
        const response=await fetch(job.dataUrl);
        if(!response.ok)throw new Error('No se pudo obtener la revisión guardada.');
        const payload=await response.json();
        parsed=payload.extractedData;
        editions=payload.reviewedEditions;
      }
      if(!parsed)throw new Error('Faltan los datos de la revisión.');
      setSelectedFile(null);setPendingFiles([]);setBatchResults([]);
      setActiveJobId(job.id);
      setActiveParsed(parsed,editions?.length?editions:undefined);
      setImportGenreSelection(job.importGenre||'classical');
      setMessage('Borrador recuperado. Revisa los datos y descarga un backup nuevo antes de guardar.');
    }catch(error){setMessage('No se pudo recuperar: '+(error instanceof Error?error.message:String(error)));}
  };

  const prepareWordBackup = async () => {
    if (!parsedData?.composer?.name) return;
    setMessage('');
    try {
      const existingPerson = await getArtistByName(parsedData.composer.name);
      const albums = await getDocs(collection(db, 'albums'));
      const affected = albums.docs.filter(album => {
        const data = album.data() as Album;
        return reviewedEditions.some(edition => edition.include && (
          edition.discogsReleaseId && data.discogsReleaseId === edition.discogsReleaseId ||
          (edition.catalogNumber && data.catalogNumber === edition.catalogNumber &&
            data.label?.trim().toLowerCase() === edition.label.trim().toLowerCase())
        ));
      }).map(album => ({id:album.id,...album.data()}));
      const backup = {
        savedAt:new Date().toISOString(), sourceFile:selectedFile?.name || parsedData.sourceFileName,
        note:'Copia de fichas afectadas; no incluye imágenes en Firebase Storage.',
        existingArtist:existingPerson||null, matchingExistingAlbums:affected,
        proposedArtist:parsedData.composer, reviewedEditions, recordings:parsedData.recordings||[],
      };
      const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
      const anchor=document.createElement('a');anchor.href=url;
      anchor.download=fileBackupFilename(selectedFile?.name||parsedData.sourceFileName||'import');
      document.body.appendChild(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      setBackupReady(true);
      setBackupDetails(affected.length+' posibles coincidencias existentes. Backup preparado.');
    } catch(error) {
      setBackupReady(false);
      setMessage('Error preparando copia: '+(error instanceof Error?error.message:String(error)));
    }
  };

  const readRestoreBackup = async (event: React.ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];
    setRestorePreview(null);
    if(!file)return;
    if(file.size>5*1024*1024){setMessage('El backup JSON supera 5 MB; no se ha cargado.');return;}
    try{
      const json=JSON.parse(await file.text()) as Record<string,unknown>;
      const artist=json.existingArtist;
      const albums=json.matchingExistingAlbums;
      if(!Array.isArray(albums)||albums.length>300 ||
         albums.some(item=>!item||typeof item!=='object'||typeof item.id!=='string'||
           !item.id||item.id.includes('/')||typeof item.title!=='string'||
           typeof item.artistId!=='string'||!['classical','jazz'].includes(item.genre)) ||
         (artist!=null && (typeof artist!=='object'||typeof (artist as Artist).id!=='string'||
           typeof (artist as Artist).name!=='string'||(artist as Artist).id.includes('/')))){
        throw new Error('El archivo no contiene una copia válida creada por esta pantalla.');
      }
      setRestorePreview({artist:artist as Artist|null,albums:albums as Album[]});
      setMessage('Backup verificado: se restaurarán únicamente fichas ausentes, nunca se sobrescribirán fichas existentes.');
    }catch(error){setMessage('No se pudo leer el backup: '+(error instanceof Error?error.message:String(error)));}
    event.target.value='';
  };
  const restoreMissingFromBackup = async () => {
    if(!restorePreview||isApproving)return;
    if(!window.confirm('¿Restaurar sólo los registros faltantes de este backup? Los datos actuales jamás serán reemplazados.'))return;
    setIsApproving(true);
    let restored=0,skipped=0;
    try{
      const entries:Array<{collectionName:'artists'|'albums';id:string;data:Record<string,unknown>}>=[];
      if(restorePreview.artist)entries.push({
        collectionName:'artists',id:restorePreview.artist.id,
        data:{...restorePreview.artist}
      });
      for(const album of restorePreview.albums)entries.push({
        collectionName:'albums',id:album.id,data:{...album}
      });
      for(const entry of entries){
        const reference=doc(db,entry.collectionName,entry.id);
        const created=await runTransaction(db,async tx=>{
          if((await tx.get(reference)).exists())return false;
          const {id,...data}=entry.data;
          tx.set(reference,data);
          return true;
        });
        if(created)restored++;else skipped++;
      }
      setMessage('Recuperadas '+restored+' fichas ausentes; '+skipped+
        ' existentes conservadas. No se han borrado ni sobrescrito datos.');
      setRestorePreview(null);
    }catch(error){
      setMessage('Restauración parcial ('+restored+' fichas). Puedes repetir sin sobrescribir: '+
        (error instanceof Error?error.message:String(error)));
    }finally{setIsApproving(false);}
  };
  const handleApproveAndSave = async () => {
    if (!parsedData || isApproving) return;
    if (!backupReady) {setMessage('Descarga primero el backup de los datos revisados.');return;}
    if (pendingReviewConflicts(reviewedEditions).length) {
      setMessage('Resuelve las diferencias entre Word y Discogs antes de guardar.');return;
    }
    const name=parsedData.composer?.name?.trim();
    if (!name) {setMessage('Falta el nombre del artista.');return;}
    const selected=reviewedEditions.filter(edition=>edition.include);
    if(selected.some(edition=>!edition.title.trim())) {
      setMessage('Hay ediciones seleccionadas sin título.');return;
    }
    if (!selectedFile && !activeJobId) {setMessage('Guarda el borrador primero.');return;}
    if (!window.confirm('¿Confirmas guardar '+selected.length+' edición(es) revisadas? Nunca se reemplazarán álbumes existentes.')) return;
    setIsApproving(true);setMessage('');
    let savedCount=0,skippedCount=0;
    try {
      const jobId=await resolveJobId(),jobRef=doc(db,'import_jobs',jobId);
      const prior=await getDoc(jobRef);
      if(prior.exists()&&prior.data().status==='approved'){
        setMessage('Este Word ya fue importado. No se han modificado los datos.');return;
      }
      let fileUrl=String(prior.data()?.fileUrl||'');
      let storagePath=String(prior.data()?.storagePath||'');
      if(!fileUrl && selectedFile) {
        const upload=await uploadWordFileToStorage(selectedFile);
        fileUrl=upload.downloadURL;storagePath=upload.storagePath;
      }
      if(!fileUrl) throw new Error('Falta el Word original guardado. Recupera el archivo antes de continuar.');
      await setDoc(jobRef,{
        fileName:selectedFile?.name||parsedData.sourceFileName||'Word',
        createdAt:prior.data()?.createdAt||new Date().toISOString(),
        source:'word_upload',status:'draft',fileUrl,storagePath,importGenre:importGenreSelection,
        ...(await persistWordReview(jobId,parsedData,reviewedEditions)),
        completedAlbumIds:prior.data()?.completedAlbumIds||[],
        lastAttemptAt:new Date().toISOString(),
      },{merge:true});
      setActiveJobId(jobId);
      const artistInfo=await getArtistByName(name);
      const artistId=artistInfo?.id||slugifyArtistId(name);
      if(!artistId)throw new Error('Identificador de artista inválido.');
      const artistRef=doc(db,'artists',artistId);
      const currentSnapshot=await getDoc(artistRef);
      const existing=currentSnapshot.exists()?currentSnapshot.data() as Partial<Artist>:null;
      const proposedBiography=String(parsedData.composer?.biography||'').trim();
      const selectedBiography=biographyChoice==='edit'?biographyDraft.trim():proposedBiography;
      if(existing?.biography?.trim() && biographyChoice!=='keep' &&
         existing.biography.trim()!==existingArtist?.biography?.trim()){
        throw new Error('La biografía existente cambió desde la revisión. Vuelve a comparar y descarga otro backup.');
      }
      const artistPatch:Record<string,unknown>=existing?{}:{name,genre:importGenreSelection};
      if(selectedBiography && (!existing?.biography?.trim()||biographyChoice!=='keep')){
        artistPatch.biography=selectedBiography;
      }
      if(!existing?.nationality && parsedData.composer?.nationality)
        artistPatch.nationality=parsedData.composer.nationality;
      for(const field of ['birthDate','birthPlace','deathDate','deathPlace'] as const){
        if(!existing?.[field] && parsedData.composer?.[field]) artistPatch[field]=parsedData.composer[field];
      }
      if(Object.keys(artistPatch).length){
        await runTransaction(db,async tx=>{
          const fresh=await tx.get(artistRef);
          const latest=fresh.exists()?fresh.data() as Partial<Artist>:null;
          const patch={...artistPatch};
          if(latest?.biography?.trim() && biographyChoice==='keep')delete patch.biography;
          if(latest?.biography?.trim() && biographyChoice!=='keep' &&
              latest.biography.trim()!==existing?.biography?.trim()) throw new Error('La biografía cambió al guardar.');
          for(const field of ['birthDate','birthPlace','deathDate','deathPlace'] as const){
            if(latest?.[field]) delete patch[field];
          }
          if(Object.keys(patch).length) tx.set(artistRef,patch,{merge:true});
        });
      }

      const albumsSnapshot=await getDocs(collection(db,'albums'));
      const inCatalog=albumsSnapshot.docs.map(entry=>({id:entry.id,data:entry.data() as Album}));
      const normalize=(value:unknown)=>String(value||'').normalize('NFKC').replace(/[\s-]/g,'').trim().toLowerCase();
      const completed=new Set<string>(prior.data()?.completedAlbumIds||[]);
      for(const edition of selected) {
        const physicalFormat=normalizePhysicalFormat(edition.format);
        const duplicate=inCatalog.find(item=>
          Boolean(edition.discogsReleaseId && item.data.discogsReleaseId===edition.discogsReleaseId)||
          Boolean(normalize(edition.catalogNumber||edition.barcode) &&
            [item.data.catalogNumber,item.data.barcode].some(v=>normalize(v)===normalize(edition.catalogNumber||edition.barcode)) &&
            normalize(item.data.label)===normalize(edition.label) &&
            (!edition.editionYear || !item.data.releaseYear || edition.editionYear===item.data.releaseYear) &&
            physicalFormat && item.data.formats?.some(f=>normalizePhysicalFormat(f)===physicalFormat))
        );
        const albumId=duplicate?.id||slugifyAlbumId(name,edition.title,edition.editionYear,
          [edition.label,edition.catalogNumber,edition.barcode,edition.format].filter(Boolean).join('-'));
        if(!albumId)throw new Error('No se pudo identificar una edición.');
        if(completed.has(albumId)||duplicate){skippedCount++;continue;}
        const related=(parsedData.recordings||[]).filter(rec=>sameWordEdition(edition,rec));
        const {assigned,unassigned}=splitReviewedWorks(edition,related);
        const albumRef=doc(db,'albums',albumId);
        const created=await runTransaction(db,async tx=>{
          if((await tx.get(albumRef)).exists())return false;
          tx.set(albumRef,{
            artistId,artistName:name,allArtistIds:[artistId],genre:importGenreSelection,title:edition.title,
            releaseYear:edition.editionYear,country:edition.country,
            label:normalizeRecordLabels(edition.label),originalLabel:edition.originalLabel||'',
            catalogNumber:edition.catalogNumber,barcode:edition.barcode,
            discCount:edition.discCount,formats:physicalFormat?[physicalFormat]:[],
            recordingDates:related.map(r=>r.recordingDate).filter(Boolean).join('; '),
            location:related.find(r=>r.recordingLocation)?.recordingLocation||'',
            orchestra:related.find(r=>r.orchestra)?.orchestra||'',
            conductor:related.find(r=>r.conductor)?.conductor||'',
            musicians:related.flatMap(r=>(r.performers||[]).map(name=>({name,instrument:''}))),
            discs:importGenreSelection==='classical'?(edition.discs?.length?edition.discs:assigned):[],
            unassignedWorks:importGenreSelection==='classical'?unassigned:[],
            tracks:importGenreSelection==='jazz'?related.map((r,i)=>({
              trackNumber:i+1,title:r.workTitle||edition.title,duration:''})):[],
            anecdotes:[edition.notes,...related.map(r=>r.notes)].filter(Boolean).join('\n'),
            imageUrl:edition.imageUrl||'',
            importSource:{fileName:selectedFile?.name||parsedData.sourceFileName||'Word',
              method:'Word + verificación',fieldOrigins:edition.origin,...(edition.discogsReleaseId?{discogsReleaseId:edition.discogsReleaseId}:{})},
            ...(edition.discogsReleaseId?{discogsReleaseId:edition.discogsReleaseId}:{}),
          });
          return true;
        });
        if(created){savedCount++;inCatalog.push({id:albumId,data:{
          id:albumId,artistId,genre:importGenreSelection,title:edition.title,
          label:edition.label,catalogNumber:edition.catalogNumber,barcode:edition.barcode,
          formats:physicalFormat?[physicalFormat]:[],discogsReleaseId:edition.discogsReleaseId
        }});}
        else skippedCount++;
        completed.add(albumId);
        await setDoc(jobRef,{completedAlbumIds:[...completed],lastSavedAt:new Date().toISOString()},{merge:true});
      }
      await setDoc(jobRef,{
        status:'approved',approvedAt:new Date().toISOString(),
        completedAlbumIds:[...completed],...(await persistWordReview(jobId,parsedData,reviewedEditions)),
      },{merge:true});
      setMessage('✓ Guardados '+savedCount+' álbum(es); '+skippedCount+
        ' ediciones existentes omitidas. Progreso registrado y backup disponible.');
      setBackupReady(false);
    } catch(error){
      setMessage('Importación interrumpida; '+savedCount+' álbum(es) nuevos. Reabre el borrador para continuar: '+
        (error instanceof Error?error.message:String(error)));
    } finally {setIsApproving(false);}
  };

  const extractedArtist = parsedData?.composer;
  const extractedAlbums = parsedData?.recordings || [];

  return (
    <div className="max-w-7xl mx-auto px-6 py-16 space-y-12">
      <div className="space-y-4">
        <span className="text-xs uppercase tracking-widest font-bold text-gold">Importación con AI</span>
        <h1 className="font-serif text-5xl md:text-7xl leading-tight">Subir un Word y extraer datos automáticamente</h1>
        <p className="text-ink/65 max-w-3xl leading-relaxed">
          Esta sección toma un archivo .docx, extrae el texto, solicita a la IA un resumen estructurado de datos biográficos y discográficos, y te deja revisarlo antes de guardarlo en Firebase.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[0.9fr_1.1fr] gap-8">
        <div className="rounded-3xl border border-ink/10 bg-white p-4 sm:p-6 md:p-8 shadow-sm space-y-6">
          <div className="space-y-2">
            <h2 className="font-serif text-3xl">1. Seleccionar archivo</h2>
            <p className="text-sm text-ink/60 leading-relaxed">
              Usa archivos .docx bien estructurados. Cuanto más claro esté el documento, mejor será la extracción.
            </p>
          </div>

          <label className="block rounded-2xl border border-dashed border-ink/20 bg-ink/[0.03] p-6 hover:border-gold/50 transition-colors">
            <input type="file" accept=".docx" multiple className="hidden" onChange={handleFileChange} />
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-ink text-paper flex items-center justify-center">
                <Upload size={20} />
              </div>
              <div>
                <p className="font-medium text-ink">{pendingFiles.length ? pendingFiles.map(file=>file.name).join(' · ') : 'Haz clic para elegir uno o varios archivos Word'}</p>
                <p className="text-sm text-ink/50">Archivos .docx (hasta 8 MB por archivo) · Selección múltiple</p>
              </div>
            </div>
          </label>

          <div className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-ink/[0.03] p-4">
            <span className="text-sm font-medium text-ink/70">Género musical:</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setImportGenreSelection('classical')}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-colors",
                  importGenreSelection === 'classical' ? "bg-ink text-paper" : "border border-ink/15 text-ink/60 hover:border-ink/30"
                )}
              >
                Clásica
              </button>
              <button
                type="button"
                onClick={() => setImportGenreSelection('jazz')}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-colors",
                  importGenreSelection === 'jazz' ? "bg-ink text-paper" : "border border-ink/15 text-ink/60 hover:border-ink/30"
                )}
              >
                Jazz
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleProcessFile}
              disabled={!pendingFiles.length || isUploading}
              className="px-6 py-3 rounded-full bg-ink text-paper text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gold transition-colors"
            >
              {isUploading ? 'Procesando…' : 'Procesar archivos con AI'}
            </button>

            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={!parsedData || isSavingDraft || isApproving}
              className="px-6 py-3 rounded-full border border-ink/15 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ink hover:text-paper transition-colors"
            >
              {isSavingDraft ? 'Guardando…' : 'Guardar borrador'}
            </button>

            <button type="button" onClick={prepareWordBackup} disabled={!parsedData || isApproving || isSavingDraft}
              className="rounded-full border border-ink/20 px-5 py-3 text-sm font-medium disabled:opacity-40">
              {backupReady ? 'Descargar backup actualizado ✓' : 'Descargar backup antes de guardar'}
            </button>
            {backupDetails && <p role="status" className="w-full text-xs text-ink/60">{backupDetails}</p>}

            <button
              type="button"
              onClick={handleApproveAndSave}
              disabled={!parsedData || isApproving || !backupReady || pendingReviewConflicts(reviewedEditions).length>0}
              className="px-6 py-3 rounded-full bg-gold text-ink text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-95 transition-all"
            >
              {isApproving ? 'Guardando…' : 'Aprobar y guardar'}
            </button>
          </div>

          <div className="mt-6 rounded-2xl border border-ink/10 bg-ink/[0.02] p-5 space-y-4">
            <div className="space-y-2">
              <h3 className="text-lg font-semibold">¿Tu archivo está desordenado?</h3>
              <p className="text-sm text-ink/70 leading-relaxed">
                Si tu archivo está poco organizado, puedes mejorarlo con ayuda de ChatGPT antes de procesarlo aquí.
                Copia el siguiente prompt, pégalo en ChatGPT junto con tu archivo original y pide una nueva versión ordenada.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-ink/60">Prompt</span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(PROMPT_TEXT);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="text-xs px-3 py-1 rounded-full border border-ink/15 hover:bg-ink hover:text-paper transition"
                >
                  {copied ? 'Copiado ✓' : 'Copiar'}
                </button>
              </div>

              <textarea
                readOnly
                spellCheck={false}
                value={PROMPT_TEXT}
                className="h-64 w-full rounded-xl border border-ink/10 bg-white p-4 text-sm text-ink/80 leading-relaxed resize-none"
              />

              <p className="text-xs text-ink/55">
                Consejo: guarda el resultado final como archivo .docx antes de subirlo.
              </p>
            </div>
            </div>

          <div className="rounded-2xl bg-ink/[0.03] p-5 space-y-3 text-sm text-ink/70 leading-relaxed">
            <div className="font-medium text-ink">Pipeline sugerido</div>
            <ol className="space-y-2 list-decimal pl-5">
              <li>Subir el archivo .docx</li>
              <li>Extraer texto desde el servidor</li>
              <li>Normalizar con IA a JSON estricto</li>
              <li>Revisar el contenido</li>
              <li>Guardar en Firebase</li>
            </ol>
          </div>

          <details className="rounded-2xl border border-ink/10 p-4 space-y-3">
            <summary className="text-sm font-semibold cursor-pointer">Restaurar fichas ausentes desde backup JSON</summary>
            <p className="text-xs text-ink/55 my-3">Recuperación no destructiva: sólo recrea fichas eliminadas. No deshace las altas de importaciones ni sobrescribe cambios posteriores.</p>
            <input aria-label="Archivo backup JSON" type="file" accept=".json,application/json"
              onChange={readRestoreBackup} className="block w-full text-xs"/>
            {restorePreview && (
              <div className="space-y-2">
                <p className="text-xs">{restorePreview.artist?'1 artista':'0 artistas'} · {restorePreview.albums.length} álbum(es) en el backup</p>
                <button type="button" disabled={isApproving} onClick={restoreMissingFromBackup}
                  className="rounded-full border border-ink/20 px-4 py-2 text-xs font-semibold disabled:opacity-40">
                  Restaurar sólo fichas ausentes
                </button>
              </div>
            )}
          </details>
          {batchResults.length>0 && (
            <div className="rounded-2xl border border-ink/10 p-4 space-y-3">
              <h3 className="text-xs uppercase tracking-widest font-bold text-gold">Archivos del lote</h3>
              <div className="flex flex-wrap gap-2">
                {batchResults.map((item,index)=>(
                  <button key={index} type="button" onClick={()=>activateBatch(index)}
                    className={cn('rounded-full px-3 py-2 text-xs border',
                      currentBatchIndex===index?'border-gold bg-gold/10':'border-ink/15')}>
                    {item.data?'✓':'!'} {item.file.name}
                  </button>
                ))}
              </div>
              {batchResults[currentBatchIndex]?.error && <p role="alert" className="text-xs text-red-600">{batchResults[currentBatchIndex].error}</p>}
              <p className="text-xs text-ink/50">Cada Word se revisa y guarda por separado; cambiar de archivo no fusiona artistas diferentes.</p>
            </div>
          )}
          {message ? (
            <div className="rounded-2xl border border-ink/10 bg-paper p-4 text-sm text-ink/75">{message}</div>
          ) : null}
        </div>

        <div className="space-y-8">
          <div className="rounded-3xl border border-ink/10 bg-white p-6 md:p-8 shadow-sm space-y-6">
            <div className="space-y-2">
              <h2 className="font-serif text-3xl">2. Resultado extraído</h2>
              <p className="text-sm text-ink/60">
                Revisa los datos antes de aprobarlos. La IA puede ayudar mucho, pero no reemplaza la revisión humana.
              </p>
            </div>

            {parsedData ? (
              <div className="space-y-8">
                <div className="space-y-3">
                  <h3 className="text-xs uppercase tracking-widest font-bold text-gold">Artista</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="rounded-2xl bg-ink/[0.03] p-4"><span className="text-ink/45">Nombre</span><div className="font-medium mt-1">{parsedData?.composer?.name || extractedArtist?.name || '—'}</div></div>
                    <div className="rounded-2xl bg-ink/[0.03] p-4"><span className="text-ink/45">Nacionalidad</span><div className="font-medium mt-1">{(extractedArtist as ServerComposer)?.nationality || '—'}</div></div>
                    <div className="rounded-2xl bg-ink/[0.03] p-4"><span className="text-ink/45">Nacimiento</span><div className="font-medium mt-1">{extractedArtist?.birthDate || '—'} {extractedArtist?.birthPlace ? `· ${extractedArtist.birthPlace}` : ''}</div></div>
                    <div className="rounded-2xl bg-ink/[0.03] p-4"><span className="text-ink/45">Fallecimiento</span><div className="font-medium mt-1">{extractedArtist?.deathDate || '—'} {extractedArtist?.deathPlace ? `· ${extractedArtist.deathPlace}` : ''}</div></div>
                  </div>
                  <div className="rounded-2xl border border-ink/10 p-4 space-y-4">
                    <h4 className="font-medium text-sm">Biografía · Comparar antes de guardar</h4>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <div className="rounded-xl bg-ink/[0.03] p-3">
                        <p className="text-xs uppercase tracking-widest text-ink/40 mb-2">Actual en el catálogo</p>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{existingArtist?.biography || 'Sin biografía guardada'}</p>
                      </div>
                      <div className="rounded-xl bg-gold/[0.06] p-3">
                        <p className="text-xs uppercase tracking-widest text-gold mb-2">Del documento Word</p>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{extractedArtist?.biography || 'Sin biografía en el Word'}</p>
                      </div>
                    </div>
                    {existingArtist?.biography?.trim() ? (
                      <div className="space-y-2">
                        <p className="text-xs text-ink/60">Elige qué hacer con la biografía existente:</p>
                        <div className="flex flex-wrap gap-2">
                          {([['keep','Conservar actual'],['replace','Reemplazar con Word'],['edit','Editar/combinar']] as const).map(([value,label])=>(
                            <button type="button" key={value} aria-pressed={biographyChoice===value}
                              onClick={()=>{setBiographyChoice(value);markReviewChanged();}}
                              className={cn('rounded-full border px-4 py-2 text-xs',
                                biographyChoice===value?'bg-ink text-paper border-ink':'border-ink/15')}>
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : <p className="text-xs text-ink/60">No hay biografía existente: se añadirá la del Word, sin sobrescribir datos.</p>}
                    {biographyChoice==='edit' && (
                      <textarea aria-label="Biografía editada" rows={7} value={biographyDraft}
                        onChange={event=>{setBiographyDraft(event.target.value);markReviewChanged();}}
                        className="w-full rounded-xl border border-ink/10 bg-white p-3 text-sm leading-relaxed"/>
                    )}
                  </div>
                </div>

                <section className="space-y-4">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className="font-serif text-2xl">Ediciones discográficas encontradas</h3>
                      <p className="text-xs text-ink/50 mt-1">Se importará cada edición una sola vez. Discogs es opcional y sólo se aplican ediciones que elijas.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs rounded-full bg-gold/10 px-3 py-2 font-semibold text-gold">{albumsForImport.length} álbum(es)</span>
                      <button type="button" onClick={searchAllWordAlbums} disabled={batchSearching || !extractedCandidates.some(a => a.catalogNumber || a.barcode)}
                        className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-paper disabled:opacity-40">
                        {batchSearching ? 'Buscando en Discogs...' : 'Buscar todos en Discogs'}
                      </button>
                    </div>
                  </div>
                  {enrichMessage && <p role="status" className="text-xs rounded-lg bg-ink/5 p-3 text-ink/70">{enrichMessage}</p>}
                  {albumsForImport.map((candidate, index) => {
                    const key=candidate.sourceKey;
                    const matches=discogsMatches[key]||[];
                    const existingEdition=catalogForReview.find(album=>
                      Boolean(candidate.discogsReleaseId && album.discogsReleaseId===candidate.discogsReleaseId) ||
                      Boolean(candidate.catalogNumber && album.catalogNumber===candidate.catalogNumber &&
                        album.label?.toLowerCase().trim()===candidate.label.toLowerCase().trim() &&
                        (!candidate.editionYear || !album.releaseYear || album.releaseYear===candidate.editionYear) &&
                        normalizePhysicalFormat(album.formats?.[0]||'')===normalizePhysicalFormat(candidate.format)));
                    const fields: Array<[ReviewField,string]> = [
                      ['title','Título del álbum'], ['label','Sello de tu ejemplar'],
                      ['catalogNumber','Nº de catálogo'],['barcode','Barcode'],
                      ['format','Formato (CD/Vinilo)'],['editionYear','Año de edición'],
                      ['country','País']
                    ];
                    return <div key={key} className="rounded-2xl border border-ink/10 p-4 sm:p-5 space-y-4">
                      <div className="flex items-start gap-3">
                        {candidate.imageUrl?
                          <img src={candidate.imageUrl} alt="" className="w-20 h-20 rounded-xl object-cover shrink-0"/>:
                          <div className="w-20 h-20 shrink-0 rounded-xl bg-ink/5 flex items-center justify-center">
                            <DiscIcon size={26} className="text-ink/20"/>
                          </div>}
                        <div className="flex-1 min-w-0">
                          <p className="font-serif text-xl break-words">{candidate.title||'Sin título'}</p>
                          <p className="text-xs text-ink/55">{candidate.label||'Sin sello'} · {candidate.catalogNumber||'Sin catálogo'}</p>
                          <p className="text-xs text-ink/50 mt-1">
                            {candidate.discogsReleaseId?'Discogs release #'+candidate.discogsReleaseId:'Datos extraídos del Word; falta verificar la edición'}
                          </p>
                        </div>
                        <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                          <input type="checkbox" checked={candidate.include} onChange={event=>
                            updateReviewedEdition(key,item=>({...item,include:event.target.checked}))}/>
                          Importar
                        </label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {fields.map(([field,label])=>(
                          <label key={field} className="space-y-1 min-w-0">
                            <span className="text-xs font-medium text-ink/60">{label}</span>
                            <input value={String(candidate[field]||'')}
                              onChange={event=>updateReviewedEdition(key,item=>
                                editReviewField(item,field,event.target.value))}
                              className="w-full min-w-0 rounded-xl bg-ink/[0.035] border border-ink/10 px-3 py-2 text-sm"/>
                            <span className="block text-[10px] text-ink/40">Fuente: {candidate.origin[field]||'Sin identificar'}</span>
                            {candidate.discogsSuggestions?.[field] && (
                              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gold/[0.08] p-2">
                                <span className="text-[11px] text-ink/70 break-all">
                                  Discogs: {candidate.discogsSuggestions[field]}
                                </span>
                                <button type="button" onClick={()=>updateReviewedEdition(key,item=>
                                  applyDiscogsReviewField(item,field))}
                                  className="rounded-full border border-gold/30 px-3 py-1.5 text-[11px] font-bold hover:bg-white">
                                  Usar este dato
                                </button>
                              </div>
                            )}
                          </label>
                        ))}
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-ink/60">Sello Original · primera edición histórica (no el sello de tu copia)</span>
                          <input value={candidate.originalLabel||''} onChange={event=>
                            updateReviewedEdition(key,item=>({...item,originalLabel:event.target.value}))}
                            className="w-full rounded-xl bg-ink/[0.035] border border-ink/10 px-3 py-2 text-sm"
                            placeholder="Dejar en blanco si se desconoce"/>
                        </label>
                        <label className="space-y-1">
                          <span className="text-xs font-medium text-ink/60">Discos físicos en el paquete</span>
                          <input type="number" min="1" max="100" value={candidate.discCount}
                            onChange={event=>updateReviewedEdition(key,item=>({...item,
                              discCount:Math.min(100,Math.max(1,Number(event.target.value)||1))}))}
                            className="w-full rounded-xl bg-ink/[0.035] border border-ink/10 px-3 py-2 text-sm"/>
                        </label>
                      </div>
                      {(candidate.barcode||candidate.catalogNumber)&&(
                        <div className="space-y-2 border-t border-ink/10 pt-3">
                          <button type="button" disabled={Boolean(enrichingAlbum)} onClick={()=>lookupWordAlbum(candidate)}
                            className="rounded-full border border-ink/15 px-4 py-2 text-xs font-semibold disabled:opacity-40">
                            {enrichingAlbum===key?'Buscando...':'Contrastar con Discogs'}
                          </button>
                          {!!matches.length&&(
                            <div className="flex flex-col sm:flex-row gap-2">
                              <select aria-label={'Edición de '+candidate.title} value={discogsSelection[key]||''}
                                onChange={event=>setDiscogsSelection(current=>({...current,[key]:event.target.value}))}
                                className="flex-1 min-w-0 bg-ink/5 rounded-xl px-3 py-2 text-sm">
                                <option value="">Elige una edición comprobable...</option>
                                {matches.map(match=><option value={match.id} key={match.id}>
                                  {match.title} · {match.year} · {match.catno} · {match.labels.join('/')} · {match.formats.join('/')}
                                </option>)}
                              </select>
                              <button type="button" disabled={!discogsSelection[key]||Boolean(enrichingAlbum)}
                                onClick={()=>confirmWordDiscogsRelease(candidate)}
                                className="rounded-xl bg-ink text-paper px-4 py-2 text-xs disabled:opacity-40">Aplicar edición</button>
                            </div>
                          )}
                        </div>
                      )}
                      {candidate.discogsReleaseId && (
                        <section className="rounded-xl border border-gold/20 bg-gold/[0.05] p-3 space-y-3">
                          <h5 className="text-xs font-semibold uppercase tracking-widest text-gold">
                            Otros datos disponibles en Discogs
                          </h5>
                          <p className="text-xs text-ink/60">
                            Ninguno se aplica sin tu elección. El sello original nunca se completa por suposición.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {candidate.discogsSuggestedImageUrl && (
                              <button type="button" onClick={()=>updateReviewedEdition(key,item=>
                                applyDiscogsReviewExtras(item,'image'))}
                                className="rounded-full border border-ink/15 px-4 py-2 text-xs">Usar portada de Discogs</button>
                            )}
                            {Boolean(candidate.discogsSuggestedDiscCount) && (
                              <button type="button" onClick={()=>updateReviewedEdition(key,item=>
                                applyDiscogsReviewExtras(item,'discCount'))}
                                className="rounded-full border border-ink/15 px-4 py-2 text-xs">
                                Usar cantidad de discos ({candidate.discogsSuggestedDiscCount})
                              </button>
                            )}
                            {Boolean(candidate.discogsSuggestedDiscs?.length) && (
                              <button type="button" onClick={()=>updateReviewedEdition(key,item=>
                                applyDiscogsReviewExtras(item,'discs'))}
                                className="rounded-full border border-ink/15 px-4 py-2 text-xs">
                                Usar lista de obras ({candidate.discogsSuggestedDiscs?.length} discos)
                              </button>
                            )}
                          </div>
                        </section>
                      )}
                      {existingEdition && (
                        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                          <p className="text-xs font-semibold text-amber-900">Posible edición existente · Se omitirá en vez de sobrescribir</p>
                          <p className="text-xs text-ink/65">{existingEdition.title} · {existingEdition.label||'Sin sello'} · {existingEdition.catalogNumber||'Sin catálogo'} · {existingEdition.releaseYear||'s/f'}</p>
                          <p className="text-xs text-ink/50">Puedes revisar el álbum existente desde el catálogo. Esta importación nunca modifica esa ficha automáticamente.</p>
                        </div>
                      )}
                      {candidate.conflicts.length>0&&(
                        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 space-y-2">
                          <h5 className="text-xs font-semibold text-amber-900">Diferencias detectadas · Revisión obligatoria</h5>
                          {candidate.conflicts.map(conflict=>(
                            <div key={conflict.field} className="rounded-lg bg-white p-3 space-y-2">
                              <p className="text-xs font-semibold">{conflict.field} {conflict.resolved?'✓':'· pendiente'}</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <button type="button" onClick={()=>updateReviewedEdition(key,item=>
                                    resolveReviewConflict(item,conflict.field,'Word'))}
                                  className="text-left rounded-lg border border-ink/10 px-3 py-2 text-xs">
                                  <b>Word:</b> {conflict.word}
                                </button>
                                <button type="button" onClick={()=>updateReviewedEdition(key,item=>
                                    resolveReviewConflict(item,conflict.field,'Discogs'))}
                                  className="text-left rounded-lg border border-ink/10 px-3 py-2 text-xs">
                                  <b>Discogs:</b> {conflict.discogs}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-ink/50">
                        Fuentes: Word ({parsedData?.sourceFileName||selectedFile?.name||'documento'})
                        {candidate.discogsReleaseId?' · Discogs release '+candidate.discogsReleaseId:''}.
                        {candidate.discogsReleaseId && <a className="ml-1 underline text-gold"
                          target="_blank" rel="noopener noreferrer"
                          href={'https://www.discogs.com/release/'+candidate.discogsReleaseId}>Ver fuente</a>}
                        La portada y la lista de pistas se incorporan sólo al confirmar una edición exacta.
                      </p>
                    </div>;
                  })}
                  {!albumsForImport.length && <p className="text-sm text-ink/50 rounded-xl border border-dashed border-ink/20 p-4">No se detectaron ediciones discográficas. Puedes guardar la biografía; no se inventarán álbumes a partir de obras aisladas.</p>}
                </section>

                <div className="space-y-3">
                  <h3 className="text-xs uppercase tracking-widest font-bold text-gold">Grabaciones y obras extraídas del documento</h3>
                  {(extractedAlbums as ServerRecording[]).length > 0 ? (
                    <div className="space-y-4">
                      {extractedAlbums.map((rec, index) => (
                        <div key={`${(rec as ServerRecording).albumTitle || (rec as ServerRecording).workTitle || 'rec'}-${index}`} className="rounded-2xl border border-ink/10 p-5 space-y-3">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h4 className="font-serif text-2xl">{(rec as ServerRecording).albumTitle || (rec as ServerRecording).workTitle || `Grabación ${index + 1}`}</h4>
                              <p className="text-sm text-ink/60">
                                {(rec as ServerRecording).section || extractedArtist?.name || 'Artista no identificado'}
                              </p>
                            </div>
                            <span className="text-xs uppercase tracking-widest font-bold text-gold">{(rec as ServerRecording).format || '—'}</span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-ink/10 pt-3">
                            <label className="space-y-1">
                              <span className="text-xs text-ink/60">Título de la obra · Corregir</span>
                              <input value={rec.workTitle||''} onChange={event=>{
                                setParsedData(current=>current?{...current,recordings:(current.recordings||[]).map((item,i)=>
                                  i===index?{...item,workTitle:event.target.value}:item)}:current);
                                markReviewChanged();
                              }} className="w-full min-w-0 bg-ink/5 rounded-lg p-2 text-sm"/>
                            </label>
                            <label className="space-y-1">
                              <span className="text-xs text-ink/60">Disco físico · Sólo si está verificado</span>
                              <select value={rec.discNumber||''} onChange={event=>{
                                const value=event.target.value?Number(event.target.value):undefined;
                                setParsedData(current=>current?{...current,recordings:(current.recordings||[]).map((item,i)=>
                                  i===index?{...item,discNumber:value}:item)}:current);
                                markReviewChanged();
                              }} className="w-full min-w-0 bg-ink/5 rounded-lg p-2 text-sm">
                                <option value="">Sin asignar / No documentado</option>
                                {Array.from({length:Math.min(100,Math.max(1,
                                  reviewedEditions.find(item=>sameWordEdition(item,rec))?.discCount||1))},
                                  (_,i)=>i+1).map(d=><option key={d} value={d}>Disco {d}</option>)}
                              </select>
                            </label>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div><span className="text-ink/45">Sello</span><div className="mt-1">{(rec as ServerRecording).label || '—'}</div></div>
                            <div><span className="text-ink/45">Catálogo</span><div className="mt-1">{(rec as ServerRecording).catalogNumber || '—'}</div></div>
                            <div><span className="text-ink/45">Fechas de grabación</span><div className="mt-1">{(rec as ServerRecording).recordingDate || '—'}</div></div>
                            <div><span className="text-ink/45">Lugar</span><div className="mt-1">{(rec as ServerRecording).recordingLocation || '—'}</div></div>
                            <div><span className="text-ink/45">Director</span><div className="mt-1">{(rec as ServerRecording).conductor || '—'}</div></div>
                            <div><span className="text-ink/45">Orquesta</span><div className="mt-1">{(rec as ServerRecording).orchestra || '—'}</div></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-ink/15 p-6 text-sm text-ink/55">
                      La IA no detectó álbumes claros en este documento. Puedes guardar solo el artista como borrador.
                    </div>
                  )}
                </div>

                {(parsedData.warnings?.length || parsedData.notes?.length) ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-gold/10 p-4 text-sm">
                      <div className="text-xs uppercase tracking-widest font-bold text-gold mb-2">Advertencias</div>
                      <ul className="space-y-2 list-disc pl-5 text-ink/70">
                        {(parsedData.warnings || []).map((warning, index) => <li key={index}>{warning}</li>)}
                      </ul>
                    </div>
                    <div className="rounded-2xl bg-ink/[0.03] p-4 text-sm">
                      <div className="text-xs uppercase tracking-widest font-bold text-gold mb-2">Notas</div>
                      <ul className="space-y-2 list-disc pl-5 text-ink/70">
                        {(parsedData.notes || []).map((note, index) => <li key={index}>{note}</li>)}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-ink/15 p-10 text-center text-ink/50">
                Aún no hay resultados. Sube un archivo .docx y procésalo con AI.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-ink/10 bg-white p-6 md:p-8 shadow-sm space-y-5">
            <div className="space-y-2">
              <h2 className="font-serif text-3xl">3. Historial reciente</h2>
              <p className="text-sm text-ink/60">
                Estos registros se guardan en la colección <code className="px-1.5 py-0.5 bg-ink/[0.04] rounded-md">import_jobs</code>.
              </p>
            </div>

            {recentImports.length > 0 ? (
              <div className="space-y-3">
                {recentImports.map((job) => (
                  <div key={job.id} className="rounded-2xl border border-ink/10 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <div className="font-medium text-ink">{job.fileName}</div>
                      <div className="text-sm text-ink/50">{job.createdAt || 'Sin fecha'}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={cn(
                        'inline-flex items-center rounded-full px-3 py-1 text-xs uppercase tracking-widest font-bold',
                        job.status === 'approved' ? 'bg-gold/15 text-gold' : job.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-ink/5 text-ink/60'
                      )}>{job.status}</div>
                      {job.status!=='approved' && Boolean(job.extractedData||job.dataUrl) && (
                        <button type="button" onClick={()=>resumeWordJob(job)}
                          className="rounded-full border border-ink/15 px-3 py-2 text-xs">Reabrir / Reanudar</button>
                      )}
                      {(job.completedAlbumIds?.length||0)>0 && <span className="text-xs text-ink/50">
                        {job.completedAlbumIds?.length} álbum(es) registrados
                      </span>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-ink/15 p-6 text-sm text-ink/55">
                Todavía no hay importaciones guardadas en Firebase.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ComparePage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedAlbum1, setSelectedAlbum1] = useState('');
  const [selectedAlbum2, setSelectedAlbum2] = useState('');
  const [selectedAlbum3, setSelectedAlbum3] = useState('');
  

  useEffect(() => {
    const q = query(collection(db, 'albums'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAlbums(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Album)));
    });
    return unsubscribe;
  }, []);

  const comparedAlbums = [selectedAlbum1, selectedAlbum2, selectedAlbum3]
    .map((id) => albums.find((album) => album.id === id))
    .filter(Boolean) as Album[];

  const formatPeopleList = (items?: { name: string; instrument?: string }[]) => {
    if (!items || items.length === 0) return '—';
    return items.map((item) => item.instrument ? `${item.name} (${item.instrument})` : item.name).join(', ');
  };

  const formatTrackCount = (album?: Album) => {
    if (!album) return '—';
    if (album.genre === 'jazz' && album.tracks) return String(album.tracks.length);
    if (album.genre === 'classical' && album.discs) {
      const total = album.discs.reduce((sum, disc) => sum + disc.works.reduce((workSum, work) => workSum + work.movements.length, 0), 0);
      return String(total);
    }
    return album.discCount ? String(album.discCount) : '—';
  };

  const comparisonRows = [
    { label: 'Título', getValue: (a: Album) => a.title || '—' },
    { label: 'Artista', getValue: (a: Album) => a.artistName || '—' },
    { label: 'Género', getValue: (a: Album) => a.genre || '—' },
    { label: 'Año de edición', getValue: (a: Album) => a.releaseYear || '—' },
    { label: 'Fecha de publicación', getValue: (a: Album) => a.releaseDate || '—' },
    { label: 'Fechas de grabación', getValue: (a: Album) => a.recordingDates || '—' },
    { label: 'Lugar de grabación', getValue: (a: Album) => a.location || '—' },
    { label: 'País', getValue: (a: Album) => a.country || '—' },
    { label: 'Sello discográfico', getValue: (a: Album) => normalizeRecordLabels(a.label) || '—' },
    { label: 'Número de catálogo', getValue: (a: Album) => a.catalogNumber || '—' },
    { label: 'Sello original', getValue: (a: Album) => normalizeRecordLabels(a.originalLabel) || '—' },
    { label: 'Año original', getValue: (a: Album) => a.originalYear || '—' },
    { label: 'Catálogo original', getValue: (a: Album) => a.originalCatalogNumber || '—' },
    { label: 'Catálogo de edición', getValue: (a: Album) => a.editionCatalogNumber || '—' },
    { label: 'Fecha de edición', getValue: (a: Album) => a.editionDate || '—' },
    { label: 'Productor', getValue: (a: Album) => a.producer || '—' },
    { label: 'Ingeniero', getValue: (a: Album) => a.engineer || '—' },
    { label: 'Mastering', getValue: (a: Album) => a.masteringEngineer || '—' },
    { label: 'Director', getValue: (a: Album) => a.conductor || '—' },
    { label: 'Orquesta', getValue: (a: Album) => a.orchestra || '—' },
    { label: 'Solistas', getValue: (a: Album) => formatPeopleList(a.soloists) },
    { label: 'Músicos', getValue: (a: Album) => formatPeopleList(a.musicians) },
    { label: 'Formatos', getValue: (a: Album) => a.formats?.join(', ') || '—' },
    { label: 'Cantidad de discos / pistas', getValue: (a: Album) => formatTrackCount(a) },
  ];

  return (
    <div className="max-w-7xl mx-auto px-6 py-16 md:py-20 space-y-10">
      <div className="space-y-4">
        <span className="text-xs uppercase tracking-widest font-bold text-gold">Comparación musicológica</span>
        <h1 className="font-serif text-5xl md:text-7xl leading-tight">Comparar grabaciones</h1>
        <p className="text-ink/65 max-w-3xl leading-relaxed">
          Compara dos o tres registros usando solamente la información interna del sitio: fechas, lugares, personal, instrumentación, sello, catálogos y ediciones.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[selectedAlbum1, selectedAlbum2, selectedAlbum3].map((selected, index) => (
          <select
            key={index}
            value={selected}
            onChange={(e) => {
              const value = e.target.value;
              if (index === 0) setSelectedAlbum1(value);
              if (index === 1) setSelectedAlbum2(value);
              if (index === 2) setSelectedAlbum3(value);
            }}
            className="w-full bg-white rounded-2xl px-4 py-3 border border-ink/10 focus:ring-2 focus:ring-gold transition-all"
          >
            <option value="">Seleccionar grabación {index + 1}</option>
            {albums.map((album) => (
              <option key={album.id} value={album.id}>
                {album.artistName ? `${album.artistName} — ${album.title}` : album.title}
              </option>
            ))}
          </select>
        ))}
      </div>

      {comparedAlbums.length >= 2 ? (
        <div className="overflow-x-auto rounded-3xl border border-ink/10 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-ink text-paper">
              <tr>
                <th className="text-left px-5 py-4 uppercase tracking-widest text-[10px]">Campo</th>
                {comparedAlbums.map((album) => (
                  <th key={album.id} className="text-left px-5 py-4 uppercase tracking-widest text-[10px] min-w-[240px]">
                    {album.artistName ? `${album.artistName} — ${album.title}` : album.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row) => (
                <tr key={row.label} className="border-t border-ink/10 align-top">
                  <td className="px-5 py-4 font-bold text-ink/70 whitespace-nowrap">{row.label}</td>
                  {comparedAlbums.map((album) => (
                    <td key={album.id + row.label} className="px-5 py-4 text-ink/80">
                      {row.getValue(album)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-ink/15 p-10 text-center text-ink/50 bg-white">
          Selecciona al menos dos grabaciones para ver la comparación.
        </div>
      )}
    </div>
  );
}


function getDiscogsLabelOptions(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return Array.from(new Set(values.map(value => String(value).trim()).filter(Boolean)));
}

function DiscogsImportPage() {
  const navigate = useNavigate();
  const [searchMode, setSearchMode] = useState<'catno' | 'barcode'>('catno');
  const [searchValue, setSearchValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discogsUrl, setDiscogsUrl] = useState('');
  const [message, setMessage] = useState('');
  const [allArtistNames, setAllArtistNames] = useState<string[]>([]);
  const [selectedArtistNames, setSelectedArtistNames] = useState<string[]>([]);
  const [manualArtistName, setManualArtistName] = useState('');
  const [existingArtists, setExistingArtists] = useState<Artist[]>([]);
  const [artistToAdd, setArtistToAdd] = useState('');
  const [collectionStatus, setCollectionStatus] = useState<'none' | 'owned' | 'wishlist'>('none');

  const [artistName, setArtistName] = useState('');
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState<Genre>('jazz');
  const [releaseYear, setReleaseYear] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [country, setCountry] = useState('');
  const [label, setLabel] = useState('');
  const [discogsLabelOptions, setDiscogsLabelOptions] = useState<string[]>([]);
  const [catalogEditorSellos, setCatalogEditorSellos] = useState<string[]>([]);
  const [editionCandidates, setEditionCandidates] = useState<DiscogsEditionCandidate[]>([]);
  const [editionDialogOpen, setEditionDialogOpen] = useState(false);
  const [editionConfirmed, setEditionConfirmed] = useState(false);
  const [editionLabel, setEditionLabel] = useState('');
  const [editionFormat, setEditionFormat] = useState<'CD' | 'Vinilo' | ''>('');
  const editorSelloChoices = editorSelloOptions(
    catalogEditorSellos,
    [...discogsLabelOptions, ...editionCandidates.flatMap(candidate => candidate.labels)],
    [label, editionLabel]
  );
  const [editionReleaseId, setEditionReleaseId] = useState('');
  const [editionMode, setEditionMode] = useState<'discogs' | 'manual'>('discogs');
  const [manualTitle, setManualTitle] = useState('');
  const [manualArtist, setManualArtist] = useState('');
  const [manualCatalog, setManualCatalog] = useState('');
  const [manualBarcode, setManualBarcode] = useState('');
  const [manualOriginalLabel, setManualOriginalLabel] = useState('');
  const [manualYear, setManualYear] = useState('');
  const [manualCountry, setManualCountry] = useState('');
  const [manualDiscCount, setManualDiscCount] = useState(1);
  const [editionLoading, setEditionLoading] = useState(false);
  const [editionError, setEditionError] = useState('');
  const [catalogNumber, setCatalogNumber] = useState('');
  const [originalCatalogNumber, setOriginalCatalogNumber] = useState('');
  const [editionCatalogNumber, setEditionCatalogNumber] = useState('');
  const [editionDate, setEditionDate] = useState('');
  const [originalLabel, setOriginalLabel] = useState('');
  const [originalYear, setOriginalYear] = useState('');
  const [orchestra, setOrchestra] = useState('');
  const [conductor, setConductor] = useState('');
  const [producer, setProducer] = useState('');
  const [engineer, setEngineer] = useState('');
  const [masteringEngineer, setMasteringEngineer] = useState('');
  const [releaseDate, setReleaseDate] = useState('');
  const [recordingDates, setRecordingDates] = useState('');
  const [location, setLocation] = useState('');
  const [anecdotes, setAnecdotes] = useState('');
  const [showArtistTools, setShowArtistTools] = useState(false);
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);
  const [showTrackEditor, setShowTrackEditor] = useState(false);
  const [importError, setImportError] = useState('');
  const [discCount, setDiscCount] = useState(1);
  const [formats, setFormats] = useState<('CD' | 'Vinilo' | 'DVD' | 'Bluray')[]>(['CD']);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [discs, setDiscs] = useState<Disc[]>([]);

  const formatList = formats.join(', ');
  const setFormatList = (value: string) => {
    const normalized = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const lower = item.toLowerCase();
        if (lower.includes('vinyl') || lower.includes('vinilo') || lower.includes('lp')) return 'Vinilo';
        if (lower.includes('dvd')) return 'DVD';
        if (lower.includes('blu')) return 'Bluray';
        return 'CD';
      });
    setFormats(Array.from(new Set(normalized)) as ('CD' | 'Vinilo' | 'DVD' | 'Bluray')[]);
  };

  const resetDiscogsImportForm = () => {
    setSearchValue('');
    setDiscogsUrl('');
    setMessage('');
    setAllArtistNames([]);
    setSelectedArtistNames([]);
    setManualArtistName('');
    setArtistToAdd('');
    setCollectionStatus('none');
    setArtistName('');
    setTitle('');
    setGenre('jazz');
    setReleaseYear('');
    setImageUrl('');
    setCountry('');
    setLabel('');
    setDiscogsLabelOptions([]);
    setEditionCandidates([]);
    setEditionDialogOpen(false);
    setEditionConfirmed(false);
    setEditionLabel('');
    setEditionFormat('');
    setEditionReleaseId('');
    setEditionMode('discogs');
    setManualTitle('');
    setManualArtist('');
    setManualCatalog('');
    setManualBarcode('');
    setManualOriginalLabel('');
    setManualYear('');
    setManualCountry('');
    setManualDiscCount(1);
    setEditionError('');
    setCatalogNumber('');
    setOriginalCatalogNumber('');
    setEditionCatalogNumber('');
    setEditionDate('');
    setOriginalLabel('');
    setOriginalYear('');
    setOrchestra('');
    setConductor('');
    setProducer('');
    setEngineer('');
    setMasteringEngineer('');
    setReleaseDate('');
    setRecordingDates('');
    setLocation('');
    setAnecdotes('');
    setShowArtistTools(false);
    setShowAdvancedDetails(false);
    setShowTrackEditor(false);
    setImportError('');
    setDiscCount(1);
    setFormats(['CD']);
    setTracks([]);
    setDiscs([]);
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'artists'), (snapshot) => {
      const artists = snapshot.docs
        .map((artistDoc) => ({ id: artistDoc.id, ...artistDoc.data() } as Artist))
        .sort((a, b) => a.name.localeCompare(b.name));
      setExistingArtists(artists);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'artists');
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;
    // Offer labels already used on physical editions in this catalog, not original labels.
    getDocs(collection(db, 'albums')).then(snapshot => {
      if (mounted) setCatalogEditorSellos(snapshot.docs.map(album => String(album.data().label || '')));
    }).catch(error => {
      console.warn('No se pudo cargar la lista de sellos existentes', error);
    });
    return () => { mounted = false; };
  }, []);

  const normalizeArtistName = (value: string) => value.trim().replace(/\s+/g, ' ');

  const addSelectedArtist = (name: string) => {
    const cleanName = normalizeArtistName(name);
    if (!cleanName) return;
    setSelectedArtistNames((current) => {
      const exists = current.some((existingName) => existingName.toLowerCase() === cleanName.toLowerCase());
      return exists ? current : [...current, cleanName];
    });
    setArtistName((current) => current.trim() ? current : cleanName);
  };

  const removeSelectedArtist = (name: string) => {
    setSelectedArtistNames((current) => {
      const next = current.filter((existingName) => existingName !== name);
      if (artistName === name) setArtistName(next[0] || '');
      return next;
    });
  };

  const addManualArtist = () => {
    addSelectedArtist(manualArtistName);
    setManualArtistName('');
  };

  const addExistingArtist = () => {
    addSelectedArtist(artistToAdd);
    setArtistToAdd('');
  };

  const applyDiscogsData = (data: any, value: string) => {
      const detectedGenre: Genre = data.isClassical ? 'classical' : 'jazz';
      setGenre(detectedGenre);
      const foundArtistNames = Array.isArray(data.allArtistNames) && data.allArtistNames.length ? data.allArtistNames : [data.artist].filter(Boolean);
      const cleanFoundArtistNames = Array.from(new Set(foundArtistNames.map((name: string) => normalizeArtistName(String(name))).filter(Boolean)));
      const primary = normalizeArtistName(String(data.primaryArtist || cleanFoundArtistNames[0] || ''));
      setArtistName(primary);
      setSelectedArtistNames(Array.from(new Set([primary, ...cleanFoundArtistNames].filter(Boolean))));
      setTitle(data.title || '');
      setReleaseYear(data.year ? String(data.year) : '');
      setEditionDate(data.year ? String(data.year) : '');
      setCountry(data.country || '');
      setReleaseDate(data.releaseDate || '');
      setRecordingDates('');
      setLocation('');
      setAnecdotes('');
      setShowArtistTools(false);
      setShowAdvancedDetails(false);
      setShowTrackEditor(false);
      const labelOptions = getDiscogsLabelOptions(data.label);
      setDiscogsLabelOptions(labelOptions);
      const onlyLabel = labelOptions.length === 1 ? labelOptions[0] : '';
      setLabel(onlyLabel);
      setOriginalLabel(data.originalLabel || '');
      setCatalogNumber(data.catno || value);
      setEditionCatalogNumber(data.catno || value);
      setOriginalCatalogNumber(data.originalCatalogNumber || '');
      setOriginalYear(data.originalYear ? String(data.originalYear) : '');
      setImageUrl(data.coverImage || data.thumb || '');
      setDiscogsUrl(data.discogsUrl || '');
      setAllArtistNames(cleanFoundArtistNames);
      setOrchestra(data.orchestra || '');
      setConductor(data.conductor || '');
      setProducer(data.producer || '');
      setEngineer(data.engineer || '');
      setMasteringEngineer(data.masteringEngineer || '');
      setDiscCount(typeof data.discCount === 'number' && data.discCount > 0 ? data.discCount : 1);

      if (data.format) {
        setFormatList(String(data.format));
      }
      setTracks(Array.isArray(data.tracks) ? data.tracks : []);
      setDiscs(Array.isArray(data.discs) ? data.discs : []);

      setMessage('Datos de Discogs cargados. Revisa la edición antes de guardar.');
  };

  const matchingCandidates = matchingDiscogsEditions(editionCandidates, editionLabel, editionFormat);

  const confirmManualEdition = () => {
    let physicalCopy: ReturnType<typeof buildManualEdition>;
    try {
      physicalCopy=buildManualEdition({
        title:manualTitle,artist:manualArtist,label:editionLabel,format:editionFormat,
        catalogNumber:manualCatalog,barcode:manualBarcode,year:manualYear,
        country:manualCountry,originalLabel:manualOriginalLabel,discCount:manualDiscCount
      });
    } catch(error) {
      setEditionError(error instanceof Error?error.message:String(error));
      return;
    }
    // A manually identified copy must not inherit edition-specific metadata from a search result.
    setTitle(physicalCopy.title);
    setArtistName(physicalCopy.artist);
    setSelectedArtistNames([physicalCopy.artist]);
    setAllArtistNames([]);
    setLabel(physicalCopy.label);
    setDiscogsLabelOptions([]);
    setFormats(physicalCopy.formats);
    setCatalogNumber(physicalCopy.catalogNumber);
    setEditionCatalogNumber(physicalCopy.catalogNumber);
    setReleaseYear(physicalCopy.releaseYear);
    setEditionDate(physicalCopy.releaseYear);
    setCountry(physicalCopy.country);
    setDiscCount(physicalCopy.discCount);
    setReleaseDate('');
    setRecordingDates('');
    setLocation('');
    setImageUrl('');
    setDiscogsUrl('');
    setOriginalLabel(physicalCopy.originalLabel);
    setOriginalCatalogNumber('');
    setOriginalYear('');
    setOrchestra('');
    setConductor('');
    setProducer('');
    setEngineer('');
    setMasteringEngineer('');
    setTracks([]);
    setDiscs([]);
    setEditionReleaseId('');
    setCollectionStatus('owned');
    setEditionConfirmed(true);
    setEditionDialogOpen(false);
    setEditionError('');
    setMessage('Edición manual preparada. Completa los datos antes de guardar. No se atribuye a Discogs.');
  };

  const confirmEdition = async () => {
    const selectedId = editionReleaseId || (matchingCandidates.length === 1 ? String(matchingCandidates[0].id) : '');
    if (!editionLabel || !editionFormat || !selectedId ||
        !matchingCandidates.some(candidate => String(candidate.id) === selectedId)) {
      setEditionError('Selecciona el sello, el formato y una edición de Discogs.');
      return;
    }
    setEditionLoading(true);
    setEditionError('');
    try {
      const response = await privateApiFetch('/api/discogs-search-by-catalog?releaseId=' + encodeURIComponent(selectedId));
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'No se pudo cargar la edición.');
      if (!getDiscogsLabelOptions(data.label).includes(editionLabel) ||
          !String(data.format || '').split(',').some((item: string) => discogsPhysicalFormat(item) === editionFormat)) {
        throw new Error('La edición no coincide con el sello y formato elegidos.');
      }
      applyDiscogsData(data, searchValue.trim());
      setLabel(editionLabel);
      setFormats([editionFormat]);
      setEditionReleaseId(selectedId);
      setCollectionStatus('owned');
      setEditionConfirmed(true);
      setEditionDialogOpen(false);
    } catch (error) {
      setEditionError(error instanceof Error ? error.message : String(error));
    } finally {
      setEditionLoading(false);
    }
  };

  const fetchFromDiscogs = async () => {
    const value = searchValue.trim();
    if (!value) {
      alert(searchMode === 'barcode' ? 'Introduce un código de barras.' : 'Introduce un número de catálogo.');
      return;
    }

    setLoading(true);
    setEditionConfirmed(false);
    setEditionDialogOpen(false);
    setMessage('');
    setImportError('');
    try {
      const param = searchMode === 'barcode'
        ? `barcode=${encodeURIComponent(value)}`
        : `catno=${encodeURIComponent(value)}`;
      const response = await privateApiFetch(`/api/discogs-search-by-catalog?${param}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'No se pudo buscar en Discogs.');

      applyDiscogsData(data, value);
      setEditionCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      setEditionMode('discogs');
      setManualTitle(String(data.title || ''));
      setManualArtist(String(data.primaryArtist || data.artist || ''));
      setManualCatalog('');
      setManualBarcode('');
      setManualOriginalLabel('');
      setManualYear('');
      setManualCountry('');
      setManualDiscCount(1);
      setEditionConfirmed(false);
      setEditionDialogOpen(true);
      setEditionLabel('');
      setEditionFormat('');
      setEditionReleaseId('');
      setEditionError('');
    } catch (error: any) {
      console.error('Discogs import error:', error);
      if (String(error.message || '').includes('No Discogs release found')) {
        setTitle('');
        setArtistName('');
        setSelectedArtistNames([]);
        setEditionCandidates([]);
        setEditionMode('manual');
        setManualTitle('');
        setManualArtist('');
        setManualCatalog(searchMode === 'catno' ? value : '');
        setManualBarcode(searchMode === 'barcode' ? value : '');
        setManualOriginalLabel('');
        setManualYear('');
        setManualCountry('');
        setManualDiscCount(1);
        setEditionLabel('');
        setEditionFormat('');
        setEditionReleaseId('');
        setEditionDialogOpen(true);
        setImportError('');
      } else {
        setImportError(error.message || 'No se pudo obtener información desde Discogs.');
      }
    } finally {
      setLoading(false);
    }
  };

  const findExistingAlbumId = async () => {
    const snapshot = await getDocs(collection(db, 'albums'));
    const normalized = (value?: string) => String(value || '').trim().toLocaleLowerCase();
    const candidateCat = normalized(catalogNumber);
    for (const albumDoc of snapshot.docs) {
      const existing = albumDoc.data() as Album & { discogsReleaseId?: number };
      if (editionMode === 'discogs' && editionReleaseId &&
          existing.discogsReleaseId === Number(editionReleaseId)) return albumDoc.id;
      const sameEdition = normalized(existing.title) === normalized(title) &&
        normalized(existing.artistName || existing.artistId) === normalized(artistName) &&
        normalized(existing.catalogNumber) === candidateCat &&
        (editionMode !== 'manual' || !manualBarcode.trim() ||
          normalized(existing.barcode) === normalized(manualBarcode)) &&
        normalized(existing.label) === normalized(label) &&
        normalized(existing.releaseYear) === normalized(releaseYear) &&
        existing.formats?.includes(formats[0]);
      if (sameEdition) return albumDoc.id;
    }
    return null;
  };

  const saveApprovedImport = async () => {
    if (!editionConfirmed) {
      setImportError('Confirma primero el sello y el formato de tu ejemplar.');
      setEditionDialogOpen(true);
      return;
    }
    setImportError('');
    const artistsToSave: string[] = Array.from(new Set<string>(selectedArtistNames.map(name => normalizeArtistName(name)).filter(name => name.length > 0)));
    const mainArtistName = normalizeArtistName(artistName || artistsToSave[0] || '');

    if (editionMode === 'discogs' && discogsLabelOptions.length > 1 && !discogsLabelOptions.includes(label)) {
      setImportError('Selecciona el sello discográfico de tu edición antes de guardar.');
      return;
    }

    if (!mainArtistName || artistsToSave.length === 0 || !title.trim()) {
      setImportError('Faltan artista(s) y/o título del álbum.');
      return;
    }

    if (!artistsToSave.some((name) => name.toLowerCase() === mainArtistName.toLowerCase())) {
      artistsToSave.unshift(mainArtistName);
    }

    const approved = window.confirm(`¿Guardar definitivamente este álbum en la base de datos y vincularlo a: ${artistsToSave.join(', ')}?`);
    if (!approved) return;

    setSaving(true);
    try {
      const existingAlbumId = await findExistingAlbumId();
      if (existingAlbumId) {
        alert('Este álbum ya existe en la base de datos. No se creó un duplicado.');
        return;
      }

      const mainArtistId = slugifyArtistId(mainArtistName);
      const resolvedArtistIds: string[] = [];
      let createdNewArtist = false;

      for (const name of artistsToSave) {
        const artistId = slugifyArtistId(name);
        const artistRef = doc(db, 'artists', artistId);
        const artistSnap = await getDoc(artistRef);
        if (!artistSnap.exists()) {
          createdNewArtist = true;
          await setDoc(artistRef, {
            name,
            genre,
            imageUrl: '',
            biography: '',
            instruments: [],
            periods: [],
          });
        }
        resolvedArtistIds.push(artistId);
      }

      // Manual editions have no Discogs release ID and use an independent catalog identity.
      const manualIdentity = editionMode === 'manual'
        ? manualEditionIdentity(buildManualEdition({
            title,artist:mainArtistName,label,format:formats[0] as 'CD' | 'Vinilo' | '',
            catalogNumber,barcode:manualBarcode,year:releaseYear,country,originalLabel,discCount
          }))
        : '';
      const albumId = editionMode === 'manual'
        ? slugifyAlbumId(mainArtistName, title, releaseYear, manualIdentity) + '_manual'
        : slugifyAlbumId(mainArtistName, title, releaseYear, catalogNumber) + '_discogs_' + editionReleaseId;
      const albumRef = doc(db, 'albums', albumId);
      const existingExactId = await getDoc(albumRef);
      if (existingExactId.exists()) {
        setImportError('Esta edición ya existe. No se ha sobrescrito ningún álbum.');
        return;
      }
      await setDoc(albumRef, {
        ...(editionMode === 'discogs' ? { discogsReleaseId: Number(editionReleaseId) } : {}),
        importSource: { fileName: '', method: editionMode === 'manual' ? 'manual-edition' : 'Discogs' },
        ...(editionMode === 'manual' && manualBarcode.trim() ? { barcode: manualBarcode.trim() } : {}),
        artistId: mainArtistId,
        artistName: mainArtistName,
        allArtistIds: Array.from(new Set(resolvedArtistIds)),
        title: title.trim(),
        genre,
        releaseYear,
        imageUrl,
        country,
        releaseDate,
        recordingDates,
        location,
        anecdotes,
        label: normalizeRecordLabels(label),
        catalogNumber,
        originalCatalogNumber,
        editionCatalogNumber,
        editionDate,
        originalLabel: normalizeRecordLabels(originalLabel),
        originalYear,
        orchestra,
        conductor,
        producer,
        engineer,
        masteringEngineer,
        discCount,
        formats,
        tracks: genre === 'jazz' ? tracks : [],
        discs: genre === 'classical' ? discs : [],
      });

      if (collectionStatus !== 'none') {
        await addDoc(collection(db, 'collection'), {
          userId: 'public',
          albumId,
          status: collectionStatus,
          addedAt: new Date().toISOString(),
        });
      }

      alert('Guardado correctamente.');
      if (createdNewArtist) {
        navigate(`/artist/${mainArtistId}`);
      } else {
        resetDiscogsImportForm();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'discogs-import');
      setImportError('No se pudo guardar: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-16 space-y-8 sm:space-y-10">
      <div className="space-y-4">
        <span className="text-xs uppercase tracking-widest font-bold text-gold">Importación Discogs</span>
        <h1 className="font-serif text-4xl sm:text-5xl italic leading-tight break-words">Agregar un álbum</h1>
        <p className="text-ink/60 max-w-3xl leading-relaxed">
          1. Busca el disco · 2. Confirma su edición · 3. Revisa las pistas y guarda. El artista principal y los datos disponibles se completan automáticamente.
        </p>
      </div>

      <div className="rounded-3xl border border-ink/10 bg-white p-6 md:p-8 shadow-sm space-y-6">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSearchMode('catno')} className={cn('px-4 py-2 rounded-full text-xs uppercase tracking-widest font-bold', searchMode === 'catno' ? 'bg-ink text-paper' : 'border border-ink/15 text-ink/60')}>Nº Catálogo</button>
          <button type="button" onClick={() => setSearchMode('barcode')} className={cn('px-4 py-2 rounded-full text-xs uppercase tracking-widest font-bold', searchMode === 'barcode' ? 'bg-ink text-paper' : 'border border-ink/15 text-ink/60')}>Código de barras</button>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input value={searchValue} onChange={(e) => setSearchValue(e.target.value)} className="flex-1 bg-ink/5 border-none rounded-2xl px-5 py-4 focus:ring-2 focus:ring-gold" placeholder={searchMode === 'barcode' ? 'Ej. 028941512321' : 'Ej. 415 123-2'} />
          <button type="button" onClick={fetchFromDiscogs} disabled={loading || !searchValue.trim()} className="px-7 py-4 rounded-2xl bg-ink text-paper text-sm font-bold uppercase tracking-widest hover:bg-gold transition disabled:opacity-50">
            {loading ? 'Buscando...' : 'Buscar en Discogs'}
          </button>
        </div>
        {message && <p role="status" className="text-sm text-gold font-medium">{message}</p>}
        {importError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{importError}</p>}
        <button type="button" onClick={()=>{
          setEditionMode('manual');
          setManualTitle(title||'');
          setManualArtist(artistName||'');
          setManualCatalog(searchMode==='catno'?searchValue.trim():'');
          setManualBarcode(searchMode==='barcode'?searchValue.trim():'');
          setManualOriginalLabel('');
          setManualYear('');
          setManualCountry('');
          setManualDiscCount(1);
          setEditionLabel('');
          setEditionFormat('');
          setEditionReleaseId('');
          setEditionCandidates([]);
          setEditionConfirmed(false);
          setEditionError('');
          setEditionDialogOpen(true);
        }} className="text-sm underline text-ink/60 hover:text-gold">
          ¿No encuentras tu edición? Añadir otra edición manualmente
        </button>
        {discogsUrl && <a href={discogsUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm underline text-ink/60 hover:text-gold">Ver release en Discogs</a>}
      </div>

      {editionDialogOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-ink/70 p-3 sm:p-6">
          <div role="dialog" aria-modal="true" aria-labelledby="edition-dialog-heading"
            className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-3xl bg-paper p-5 sm:p-8 shadow-2xl space-y-5">
            <div className="space-y-2">
              <span className="text-xs uppercase tracking-widest font-bold text-gold">Confirmar tu ejemplar</span>
              <h2 id="edition-dialog-heading" className="font-serif text-3xl">¿Qué edición tienes en casa?</h2>
              <p className="text-sm text-ink/60">
                Puedes elegir una edición de Discogs o introducir los datos de tu ejemplar si no aparece.
                Nadie está obligado a usar una edición que no coincide.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" aria-pressed={editionMode==='discogs'} disabled={!editionCandidates.length}
                onClick={() => { setEditionMode('discogs'); setEditionLabel(''); setEditionReleaseId(''); setEditionError(''); }}
                className={cn('rounded-xl border px-3 py-3 text-sm font-medium disabled:opacity-40',
                  editionMode==='discogs'?'border-gold bg-gold/10':'border-ink/15')}>
                Edición de Discogs
              </button>
              <button type="button" aria-pressed={editionMode==='manual'}
                onClick={() => { setEditionMode('manual'); setEditionLabel(''); setEditionReleaseId(''); setEditionError(''); }}
                className={cn('rounded-xl border px-3 py-3 text-sm font-medium',
                  editionMode==='manual'?'border-gold bg-gold/10':'border-ink/15')}>
                Otra edición / No aparece
              </button>
            </div>
            {editionMode==='discogs' ? (
              <div className="space-y-2">
                <label htmlFor="edition-label" className="text-sm font-semibold">Sello de la edición en Discogs</label>
                <select id="edition-label" value={editionLabel}
                  onChange={e => { setEditionLabel(e.target.value); setEditionReleaseId(''); setEditionError(''); }}
                  className="w-full rounded-xl bg-ink/5 px-4 py-3">
                  <option value="">Selecciona un sello...</option>
                  {Array.from(new Set(editionCandidates.flatMap(candidate => candidate.labels))).sort().map(item =>
                    <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink/60">
                  Introduce los datos tal como figuran en el disco o su funda. Son independientes de Discogs.
                  Podrás editar más detalles después de confirmar.
                </p>
                <label className="block space-y-1">
                  <span className="text-sm font-semibold">Título del álbum *</span>
                  <input value={manualTitle} onChange={e=>setManualTitle(e.target.value)}
                    className="w-full rounded-xl bg-ink/5 px-4 py-3" placeholder="Título de tu álbum"/>
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-semibold">Artista principal *</span>
                  <input value={manualArtist} onChange={e=>setManualArtist(e.target.value)}
                    className="w-full rounded-xl bg-ink/5 px-4 py-3" placeholder="Artista de tu álbum"/>
                </label>
                <div className="space-y-2">
                  <label htmlFor="manual-editor-sello" className="block text-sm font-semibold">Sello Editor de tu ejemplar *</label>
                  <input id="manual-editor-sello" list="manual-editor-sello-suggestions"
                    value={editionLabel} onChange={e=>setEditionLabel(e.target.value)}
                    className="w-full rounded-xl bg-ink/5 px-4 py-3" placeholder="Buscar o escribir un sello"/>
                  <datalist id="manual-editor-sello-suggestions">
                    {editorSelloChoices.map(sello=><option key={sello} value={sello}/>)}
                  </datalist>
                  <label htmlFor="manual-editor-sello-list" className="block text-xs text-ink/60">
                    O seleccionar un sello de la lista
                  </label>
                  <select id="manual-editor-sello-list"
                    value={editorSelloChoices.includes(editionLabel) ? editionLabel : ''}
                    onChange={e=>{setEditionLabel(e.target.value);setEditionError('');}}
                    className="w-full rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm">
                    <option value="">Seleccionar sello...</option>
                    {editorSelloChoices.map(sello=><option key={sello} value={sello}>{sello}</option>)}
                  </select>
                  <p className="text-xs text-ink/50">
                    Lista de sellos usados en el catálogo y encontrados en Discogs.
                    Si tu sello no aparece, puedes escribir uno nuevo arriba.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-sm font-semibold">Número de catálogo</span>
                    <input value={manualCatalog} onChange={e=>setManualCatalog(e.target.value)}
                      className="w-full rounded-xl bg-ink/5 px-4 py-3" placeholder="Nº de tu copia"/>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-sm font-semibold">Código de barras</span>
                    <input value={manualBarcode} onChange={e=>setManualBarcode(e.target.value)}
                      className="w-full rounded-xl bg-ink/5 px-4 py-3" placeholder="Opcional"/>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-sm font-semibold">Año de edición</span>
                    <input value={manualYear} onChange={e=>setManualYear(e.target.value)}
                      className="w-full rounded-xl bg-ink/5 px-4 py-3" placeholder="Ej. 2021"/>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-sm font-semibold">País de edición</span>
                    <input value={manualCountry} onChange={e=>setManualCountry(e.target.value)}
                      className="w-full rounded-xl bg-ink/5 px-4 py-3" placeholder="Ej. US"/>
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-sm font-semibold">Sello Original (histórico, si se conoce)</span>
                  <input value={manualOriginalLabel} onChange={e=>setManualOriginalLabel(e.target.value)}
                    className="w-full rounded-xl bg-ink/5 px-4 py-3" placeholder="Dejar en blanco si se desconoce"/>
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-semibold">Cantidad de discos</span>
                  <input type="number" min="1" max="100" value={manualDiscCount}
                    onChange={e=>setManualDiscCount(Math.max(1,Math.min(100,Number(e.target.value)||1)))}
                    className="w-full rounded-xl bg-ink/5 px-4 py-3"/>
                </label>
              </div>
            )}
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">Formato de tu ejemplar *</legend>
              <div className="grid grid-cols-2 gap-3">
                {(['CD','Vinilo'] as const).map(value=>(
                  <button key={value} type="button" aria-pressed={editionFormat===value}
                    onClick={()=>{setEditionFormat(value);setEditionReleaseId('');setEditionError('');}}
                    className={cn('rounded-xl border px-4 py-4 font-medium',
                      editionFormat===value?'border-gold bg-gold/10':'border-ink/15')}>
                    {value}
                  </button>
                ))}
              </div>
            </fieldset>
            {editionMode==='discogs' && editionLabel && editionFormat && (
              <div className="space-y-2">
                <label htmlFor="edition-release" className="text-sm font-semibold">Edición que corresponde a tu copia</label>
                {matchingCandidates.length ? (
                  <select id="edition-release"
                    value={editionReleaseId || (matchingCandidates.length===1?String(matchingCandidates[0].id):'')}
                    onChange={e=>{setEditionReleaseId(e.target.value);setEditionError('');}}
                    className="w-full rounded-xl bg-ink/5 px-4 py-3 text-sm">
                    <option value="">Seleccionar edición...</option>
                    {matchingCandidates.map(candidate=>(
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.title} · {candidate.year||'s/f'} · {candidate.catno||'s/n'} · Discogs #{candidate.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p role="status" className="text-sm text-amber-700">
                    No encontramos una edición que coincida con ese sello y formato. Puedes elegir «Otra edición» e introducir tu copia manualmente.
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-ink/50">
              Sello Editor y Sello Original son datos independientes. Una edición manual no recibirá un identificador falso de Discogs.
            </p>
            {editionError && <p role="alert" className="text-sm text-red-700">{editionError}</p>}
            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
              <button type="button" disabled={editionLoading} onClick={()=>setEditionDialogOpen(false)}
                className="rounded-full border border-ink/15 px-5 py-3 text-sm">Volver sin confirmar</button>
              <button type="button" disabled={editionLoading || (editionMode==='manual'
                ? (!manualTitle.trim() || !manualArtist.trim() || !editionLabel.trim() || !editionFormat)
                : (!editionLabel || !editionFormat || !matchingCandidates.length ||
                  (matchingCandidates.length>1 && !editionReleaseId)))}
                onClick={editionMode==='manual'?confirmManualEdition:confirmEdition}
                className="rounded-full bg-ink px-6 py-3 text-sm font-semibold text-white disabled:opacity-40">
                {editionLoading?'Cargando edición...':editionMode==='manual'?'Continuar con mi edición':'Confirmar y completar datos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {title && (
        <div className="rounded-3xl border border-ink/10 bg-white p-4 sm:p-6 md:p-8 shadow-sm space-y-8">
          <div className="flex flex-col md:flex-row gap-8">
            <div className="w-full md:w-56 shrink-0 space-y-3">
              <div className="aspect-square rounded-3xl overflow-hidden bg-ink/5 shadow-md">
                {imageUrl ? <img src={imageUrl} alt={title} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <div className="w-full h-full flex items-center justify-center text-ink/20"><DiscIcon size={48} /></div>}
              </div>
              <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 text-xs focus:ring-2 focus:ring-gold" placeholder="URL imagen" />
            </div>

            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 rounded-2xl border border-ink/10 bg-ink/[0.03] p-4 sm:p-5 min-w-0 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-widest font-bold text-gold">Artista principal · Automático</p>
                    <p className="font-serif text-xl mt-1 break-words">{artistName || 'No identificado'}</p>
                    <p className="text-xs text-ink/50 mt-1">{selectedArtistNames.length} artista(s) vinculados. Los perfiles que falten se crean al guardar.</p>
                  </div>
                  <button type="button" onClick={() => setShowArtistTools(value => !value)}
                    className="shrink-0 rounded-full border border-ink/15 px-4 py-2 text-xs font-bold hover:bg-white">
                    {showArtistTools ? 'Cerrar' : 'Corregir artistas'}
                  </button>
                </div>
                {showArtistTools && (
                  <div className="space-y-4 pt-3 border-t border-ink/10">
                    <div className="space-y-1">
                      <label className="text-xs text-ink/60">Artista principal</label>
                      <select value={artistName} onChange={e => setArtistName(e.target.value)}
                        className="w-full min-w-0 rounded-xl bg-white px-3 py-3">
                        <option value="">Selecciona un artista</option>
                        {selectedArtistNames.map(name => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedArtistNames.map(name => (
                        <span key={name} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-2 text-xs">
                          <span className="truncate">{name}</span>
                          <button type="button" onClick={() => removeSelectedArtist(name)} aria-label={`Quitar ${name}`}><X size={14}/></button>
                        </span>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex min-w-0 gap-2">
                        <select value={artistToAdd} onChange={e => setArtistToAdd(e.target.value)}
                          className="flex-1 min-w-0 rounded-xl bg-white px-3 py-2 text-sm">
                          <option value="">Artista existente</option>
                          {existingArtists.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                        </select>
                        <button type="button" onClick={addExistingArtist} disabled={!artistToAdd}
                          className="shrink-0 rounded-xl bg-ink px-3 py-2 text-xs text-white disabled:opacity-30">Agregar</button>
                      </div>
                      <div className="flex min-w-0 gap-2">
                        <input value={manualArtistName} onChange={e => setManualArtistName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManualArtist(); } }}
                          className="flex-1 min-w-0 rounded-xl bg-white px-3 py-2 text-sm" placeholder="Nuevo artista (opcional)"/>
                        <button type="button" onClick={addManualArtist} disabled={!manualArtistName.trim()}
                          className="shrink-0 rounded-xl bg-ink px-3 py-2 text-xs text-white disabled:opacity-30">Agregar</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Título del álbum" value={title} setValue={setTitle}/>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Género</label>
                  <select value={genre} onChange={e => setGenre(e.target.value as Genre)} className="w-full min-w-0 bg-ink/5 rounded-xl px-4 py-3">
                    <option value="jazz">Jazz</option>
                    <option value="classical">Música Clásica</option>
                  </select>
                </div>
                <Field label="Año de edición" value={releaseYear} setValue={setReleaseYear}/>
                <Field label="Número de catálogo" value={catalogNumber} setValue={setCatalogNumber}/>
                <div className="space-y-2 sm:col-span-2">
                  <label htmlFor="import-sello" className="text-[10px] uppercase tracking-widest font-bold text-ink/40">
                    Sello discográfico de tu ejemplar (no el original)
                  </label>
                  <input id="import-sello" list="import-sellos-sugeridos" value={label}
                    onChange={e => setLabel(e.target.value)}
                    className="w-full min-w-0 bg-ink/5 rounded-xl px-4 py-3"
                    placeholder="Seleccionar o escribir el sello de tu ejemplar"/>
                  <datalist id="import-sellos-sugeridos">
                    {editorSelloChoices.map(item => <option key={item} value={item}/>)}
                  </datalist>
                  <select aria-label="Elegir Sello Editor de la lista"
                    value={editorSelloChoices.includes(label) ? label : ''}
                    onChange={e=>setLabel(e.target.value)}
                    className="w-full min-w-0 bg-white border border-ink/10 rounded-xl px-4 py-3 text-sm">
                    <option value="">Seleccionar sello de la lista...</option>
                    {editorSelloChoices.map(item=><option key={item} value={item}>{item}</option>)}
                  </select>
                  <p className="text-xs text-ink/50">
                    Corresponde a la edición que tienes en casa. Puedes corregirlo manualmente;
                    no altera el Sello Original.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Sello Original · primera edición histórica</label>
                  <input value={originalLabel} onChange={e=>setOriginalLabel(e.target.value)}
                    className="w-full min-w-0 bg-ink/5 rounded-xl px-4 py-3"
                    placeholder="Desconocido: dejar en blanco"/>
                  <p className="text-xs text-ink/50">No se deduce del sello de la reedición ni se copia desde Discogs automáticamente.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Mi colección</label>
                  <select value={collectionStatus} onChange={e => setCollectionStatus(e.target.value as 'none' | 'owned' | 'wishlist')}
                    className="w-full min-w-0 bg-ink/5 rounded-xl px-4 py-3">
                    <option value="none">No agregar todavía</option>
                    <option value="owned">En casa</option>
                    <option value="wishlist">Deseados</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button type="button" onClick={() => setShowAdvancedDetails(value => !value)}
                    className="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm font-semibold hover:bg-ink/5">
                    {showAdvancedDetails ? 'Ocultar detalles adicionales' : 'Ver y completar más datos'}
                  </button>
                </div>
              </div>
              {showAdvancedDetails && (
                <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-ink/10 pt-5">
                  <Field label="Fecha de publicación (AAAA-MM-DD)" value={releaseDate} setValue={setReleaseDate}/>
                  <Field label="Fechas de grabación" value={recordingDates} setValue={setRecordingDates}/>
                  <Field label="Lugar de grabación" value={location} setValue={setLocation}/>
                  <Field label="País" value={country} setValue={setCountry}/>
                  <Field label="Nº catálogo edición" value={editionCatalogNumber} setValue={setEditionCatalogNumber}/>
                  <Field label="Nº catálogo original" value={originalCatalogNumber} setValue={setOriginalCatalogNumber}/>

                  <Field label="Año original" value={originalYear} setValue={setOriginalYear}/>
                  <Field label="Fecha edición" value={editionDate} setValue={setEditionDate}/>
                  <div className="space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Formato de tu ejemplar</label>
                    <div className="flex gap-2">
                      <span className="flex-1 rounded-xl bg-ink/5 px-4 py-3 text-sm">{formatList || 'Sin seleccionar'}</span>
                      <button type="button" onClick={() => setEditionDialogOpen(true)} className="rounded-xl border border-ink/15 px-3 py-2 text-xs">Cambiar edición</button>
                    </div>
                  </div>
                  <Field label="Cantidad de discos" value={String(discCount)} setValue={v => setDiscCount(Math.max(1, Number(v) || 1))}/>
                  <Field label="Orquesta" value={orchestra} setValue={setOrchestra}/>
                  <Field label="Director" value={conductor} setValue={setConductor}/>
                  <Field label="Productor" value={producer} setValue={setProducer}/>
                  <Field label="Ingeniero" value={engineer} setValue={setEngineer}/>
                  <Field label="Ingeniero de mastering" value={masteringEngineer} setValue={setMasteringEngineer}/>
                  <div className="sm:col-span-2 space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Notas y comentarios</label>
                    <textarea rows={3} value={anecdotes} onChange={e => setAnecdotes(e.target.value)}
                      className="w-full bg-ink/5 rounded-xl px-4 py-3 text-sm" placeholder="Información adicional de tu copia"/>
                  </div>
                </div>
              )}
            </div>
          </div>

          {allArtistNames.length > 1 && (
            <p className="text-xs text-ink/50">Créditos identificados en Discogs: {allArtistNames.join(', ')}.</p>
          )}

          <section className="rounded-2xl border border-ink/10 bg-ink/[0.025] p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-serif text-xl">Pistas encontradas</h3>
                <p className="text-xs text-ink/50 mt-1">{genre === 'classical'
                  ? `${discs.length} disco(s) · ${discs.reduce((total, d) => total + d.works.reduce((sum, w) => sum + w.movements.length, 0), 0)} movimientos`
                  : `${tracks.length} pista(s)`}</p>
              </div>
              <button type="button" onClick={() => setShowTrackEditor(value => !value)}
                className="rounded-full border border-ink/20 px-4 py-2 text-xs font-bold hover:bg-white">
                {showTrackEditor ? 'Cerrar revisión' : 'Revisar y corregir pistas'}
              </button>
            </div>
            {showTrackEditor && (genre === 'jazz' ? (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {tracks.map((track, index) => (
                  <div key={index} className="grid grid-cols-[2rem_minmax(0,1fr)] sm:grid-cols-[2rem_minmax(0,1fr)_5rem] gap-2 items-center">
                    <span className="text-xs text-ink/40">{track.trackNumber}</span>
                    <input aria-label={`Título pista ${index + 1}`} value={track.title}
                      onChange={e => setTracks(current => current.map((t, i) => i === index ? {...t, title:e.target.value} : t))}
                      className="min-w-0 bg-white border border-ink/10 rounded-lg px-3 py-2 text-sm" />
                    <input aria-label={`Duración pista ${index + 1}`} value={track.duration}
                      onChange={e => setTracks(current => current.map((t, i) => i === index ? {...t, duration:e.target.value} : t))}
                      placeholder="Duración" className="col-start-2 sm:col-start-auto min-w-0 bg-white border border-ink/10 rounded-lg px-2 py-2 text-sm" />
                  </div>
                ))}
                {!tracks.length && <p className="text-sm text-ink/50">Discogs no devolvió pistas para esta edición.</p>}
              </div>
            ) : (
              <div className="space-y-4 max-h-[28rem] overflow-y-auto">
                {discs.map((disc, d) => (
                  <div key={d} className="rounded-xl bg-white p-3 space-y-3">
                    <h4 className="font-semibold text-sm">Disco {disc.discNumber}</h4>
                    {disc.works.map((work, w) => (
                      <div key={w} className="space-y-2">
                        <input aria-label={`Obra ${w + 1} disco ${d + 1}`} value={work.title}
                          onChange={e => setDiscs(current => current.map((cd, di) => di !== d ? cd : ({
                            ...cd, works: cd.works.map((cw, wi) => wi !== w ? cw : {...cw,title:e.target.value})
                          })))} className="w-full min-w-0 bg-ink/5 rounded-lg px-3 py-2 font-medium text-sm" />
                        {work.movements.map((movement, m) => (
                          <div key={m} className="grid grid-cols-[2rem_minmax(0,1fr)] sm:grid-cols-[2rem_minmax(0,1fr)_5rem] gap-2 items-center">
                            <span className="text-xs text-ink/40">{movement.trackNumber}</span>
                            <input aria-label={`Movimiento ${m + 1}`} value={movement.title}
                              onChange={e => setDiscs(current => current.map((cd, di) => di !== d ? cd : ({
                                ...cd, works: cd.works.map((cw, wi) => wi !== w ? cw : ({
                                  ...cw, movements: cw.movements.map((cm, mi) => mi !== m ? cm : {...cm,title:e.target.value})
                                }))
                              })))} className="min-w-0 bg-white border border-ink/10 rounded-lg px-3 py-2 text-sm" />
                            <input aria-label={`Duración movimiento ${m + 1}`} value={movement.duration}
                              onChange={e => setDiscs(current => current.map((cd, di) => di !== d ? cd : ({
                                ...cd, works: cd.works.map((cw, wi) => wi !== w ? cw : ({
                                  ...cw, movements: cw.movements.map((cm, mi) => mi !== m ? cm : {...cm,duration:e.target.value})
                                }))
                              })))} placeholder="Duración"
                              className="col-start-2 sm:col-start-auto min-w-0 bg-white border border-ink/10 rounded-lg px-2 py-2 text-sm" />
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
                {!discs.length && <p className="text-sm text-ink/50">Discogs no devolvió obras o movimientos.</p>}
              </div>
            ))}
            <p className="text-xs text-ink/50">Se guardarán las pistas de la edición seleccionada. Puedes corregir los títulos antes de aprobar.</p>
          </section>

          <div className="flex flex-col sm:flex-row gap-3 justify-end border-t border-ink/10 pt-6">
            <button type="button" onClick={() => navigate('/')} className="px-6 py-3 rounded-full border border-ink/15 text-sm font-bold uppercase tracking-widest hover:bg-ink/5">Cancelar</button>
            <button type="button" onClick={saveApprovedImport} disabled={saving} className="px-8 py-3 rounded-full bg-gold text-white text-sm font-bold uppercase tracking-widest hover:bg-ink transition disabled:opacity-50">
              {saving ? 'Guardando...' : 'Aprobar y guardar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, setValue }: { label: string; value: string; setValue: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">{label}</label>
      <input value={value} onChange={(e) => setValue(e.target.value)} className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all" />
    </div>
  );
}

function CollectionPage() {
  const [items, setItems] = useState<(CollectionItem & { album: Album })[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [sortBy, setSortBy] = useState<'title' | 'none'>('none');

  useEffect(() => {
    const q = query(collection(db, 'collection'), where('userId', '==', 'public'));
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const itemData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CollectionItem));
      
      // Fetch album details for each item
      const enrichedItems = await Promise.all(itemData.map(async (item) => {
        const albumDoc = await getDoc(doc(db, 'albums', item.albumId));
        return { ...item, album: { id: albumDoc.id, ...albumDoc.data() } as Album };
      }));

      setItems(uniqueCollectionItems(enrichedItems.filter(item => Boolean(item.album?.title))));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'collection');
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const sortedItems = [...items].sort((a, b) => {
    if (sortBy === 'title') return a.album.title.localeCompare(b.album.title);
    return 0;
  });

  const owned = sortedItems.filter(i => i.status === 'owned');
  const wishlist = sortedItems.filter(i => i.status === 'wishlist');

  const renderAlbumGrid = (sectionItems: (CollectionItem & { album: Album })[]) => (
    <div className={cn(
      "grid gap-8",
      viewMode === 'grid' ? "grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : "grid-cols-1"
    )}>
      {sectionItems.map(item => (
        <div key={item.id}>
          <AlbumCard album={item.album} viewMode={viewMode} />
        </div>
      ))}
    </div>
  );

  const renderGenreGroups = (
    sectionItems: (CollectionItem & { album: Album })[],
    emptyMessage: string
  ) => {
    const jazzItems = sectionItems.filter(item => item.album.genre === 'jazz');
    const classicalItems = sectionItems.filter(item => item.album.genre === 'classical');

    if (sectionItems.length === 0) {
      return (
        <div className="py-20 text-center border-2 border-dashed border-ink/10 rounded-3xl">
          <p className="text-ink/40 font-serif italic text-xl">{emptyMessage}</p>
        </div>
      );
    }

    return (
      <div className="space-y-12">
        <div className="space-y-6">
          <h3 className="font-serif text-3xl italic text-ink/80">Jazz <span className="text-base font-sans not-italic text-ink/40 ml-2">({jazzItems.length})</span></h3>
          {jazzItems.length > 0 ? renderAlbumGrid(jazzItems) : (
            <div className="py-10 text-center border-2 border-dashed border-ink/10 rounded-3xl">
              <p className="text-ink/40 font-serif italic text-lg">No hay discos de Jazz en esta sección.</p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <h3 className="font-serif text-3xl italic text-ink/80">Música Clásica <span className="text-base font-sans not-italic text-ink/40 ml-2">({classicalItems.length})</span></h3>
          {classicalItems.length > 0 ? renderAlbumGrid(classicalItems) : (
            <div className="py-10 text-center border-2 border-dashed border-ink/10 rounded-3xl">
              <p className="text-ink/40 font-serif italic text-lg">No hay discos de Música Clásica en esta sección.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-20 space-y-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-4">
          <span className="text-xs uppercase tracking-widest font-bold text-gold">Mi Biblioteca</span>
          <h1 className="font-serif text-6xl md:text-8xl">Mi Colección</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-ink/5 p-1 rounded-full">
            <button 
              onClick={() => setViewMode('grid')}
              className={cn(
                "p-2 rounded-full transition-all",
                viewMode === 'grid' ? "bg-paper text-gold shadow-sm" : "text-ink/40 hover:text-ink"
              )}
            >
              <LayoutGrid size={18} />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={cn(
                "p-2 rounded-full transition-all",
                viewMode === 'list' ? "bg-paper text-gold shadow-sm" : "text-ink/40 hover:text-ink"
              )}
            >
              <List size={18} />
            </button>
          </div>
          <button 
            onClick={() => setSortBy(sortBy === 'title' ? 'none' : 'title')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all border",
              sortBy === 'title' ? "bg-gold/10 border-gold text-gold" : "border-ink/10 text-ink/40 hover:border-ink/20"
            )}
          >
            <ArrowDownAZ size={16} />
            <span>A-Z</span>
          </button>
        </div>
      </div>

      <div className="space-y-12">
        <div className="flex items-center justify-between border-b border-ink/10 pb-6">
          <h2 className="font-serif text-4xl italic">En Casa <span className="text-xl font-sans not-italic text-ink/40 ml-2">({owned.length})</span></h2>
        </div>
        {renderGenreGroups(owned, 'Tu colección está vacía. ¡Empieza a añadir tus tesoros!')}
      </div>

      <div className="space-y-12">
        <div className="flex items-center justify-between border-b border-ink/10 pb-6">
          <h2 className="font-serif text-4xl italic">Deseados <span className="text-xl font-sans not-italic text-ink/40 ml-2">({wishlist.length})</span></h2>
        </div>
        {renderGenreGroups(wishlist, 'No tienes deseos pendientes. ¿Qué será lo próximo?')}
      </div>
    </div>
  );
}

// --- Modals ---

const INSTRUMENTS = [
  'Piano', 'Trompeta', 'Saxofón Tenor', 'Saxofón Alto', 'Saxofón Soprano', 'Saxofón Barítono',
  'Contrabajo', 'Batería', 'Guitarra', 'Trombón', 'Clarinete', 'Voz', 'Vibráfono', 'Órgano',
  'Violín', 'Violonchelo', 'Flauta', 'Arpa', 'Clavecín', 'Otro'
];

const JAZZ_SUBGENRES = [
  'Bebop', 'Ragtime', 'Cool Jazz', 'Dixieland Jazz', 'Free Jazz', 'Gypsy Jazz',
  'Hard Bop', 'Fusion', 'Mellow Jazz', 'Modal Jazz', 'Smooth Jazz', 'Soul Jazz',
  'Trad Jazz', 'Post-Bop', 'Swing', 'Otro'
];

const CLASSICAL_PERIODS = [
  'Barroco', 'Clásico', 'Romántico', 'Impresionismo', 'Modernismo', 'Contemporáneo', 'Otro'
];

function ArtistModal({ artist, genre, onClose }: { artist?: Artist, genre: Genre, onClose: () => void }) {
  const [name, setName] = useState(artist?.name || '');
  const [biography, setBiography] = useState(artist?.biography || '');
  const [imageUrl, setImageUrl] = useState(artist?.imageUrl || '');
  const [birthDate, setBirthDate] = useState(artist?.birthDate || '');
  const [deathDate, setDeathDate] = useState(artist?.deathDate || '');
  const [birthPlace, setBirthPlace] = useState(artist?.birthPlace || '');
  const [deathPlace, setDeathPlace] = useState(artist?.deathPlace || '');
  const [instruments, setInstruments] = useState<string[]>(artist?.instruments || []);
  const [periods, setPeriods] = useState<string[]>(artist?.periods || []);
  const [autoGenerateDiscography, setAutoGenerateDiscography] = useState(false);
  const [fetchingMetadata, setFetchingMetadata] = useState(false);
  const [findingPortrait, setFindingPortrait] = useState(false);
  const [allArtists, setAllArtists] = useState<Artist[]>([]);
  const [resolving, setResolving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving, setSaving] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log("--- Starting Artist Image Upload (Base64) ---");
    console.log("File name:", file.name);
    console.log("File size:", file.size, "bytes");
    
    setUploading(true);
setUploadProgress(10);

try {
  let fileToUpload: File | Blob = file;

  // Compress image if it's large
  if (file.size > 200 * 1024) {
    console.log("Compressing image...");
    try {
      const options = {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 1200,
        useWebWorker: true,
      };
      fileToUpload = await imageCompression(file, options);
      console.log("Compressed size:", fileToUpload.size, "bytes");
    } catch (compressionError) {
      console.error("Compression failed, using original:", compressionError);
      fileToUpload = file;
    }
  }

  setUploadProgress(20);

  const fileName = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
  const storageRef = ref(storage, `images/${fileName}`);
  console.log("Storage reference path:", storageRef.fullPath);

  console.log("Uploading to Firebase Storage...");
  await uploadBytes(storageRef, fileToUpload);

  const url = await getDownloadURL(storageRef);
  console.log("Download URL obtained:", url);

  setImageUrl(url);
  setUploadProgress(100);
  setUploading(false);
  console.log("--- Artist Image Upload Complete ---");
} catch (error: any) {
  console.error("CRITICAL ERROR in handleFileUpload:", error);
  let errorMessage = "Error al subir la imagen.";
  if (error.code) errorMessage += `\nCódigo: ${error.code}`;
  if (error.message) errorMessage += `\nMensaje: ${error.message}`;
  alert(errorMessage);
  setUploading(false);
}
};

  const resolveImage = async () => {
    if (!imageUrl || imageUrl.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) return;
    setResolving(true);
    try {
      const response = await privateApiFetch(`/api/resolve-image?url=${encodeURIComponent(imageUrl)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.imageUrl) {
          setImageUrl(data.imageUrl);
        }
      }
    } catch (error) {
      console.error("Error resolving image:", error);
    } finally {
      setResolving(false);
    }
  };
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'artists'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAllArtists(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Artist)));
    });
    return unsubscribe;
  }, []);

  const handleFindPortrait = async () => {
    if (!name.trim() || imageUrl.trim()) return;
    setFindingPortrait(true);
    try {
      const portrait = await findArtistPortrait(name);
      if (portrait) setImageUrl(portrait);
      else alert('No se encontró una imagen verificada. Puedes subir una foto manualmente.');
    } finally {
      setFindingPortrait(false);
    }
  };

  const handleFetchMetadata = async () => {
    if (!name.trim()) return;

    setFetchingMetadata(true);

    try {
      const metadata = await fetchArtistMetadata(name);

      if (metadata) {
        if (metadata.biography) setBiography(metadata.biography);
        if (metadata.birthDate) setBirthDate(metadata.birthDate);
        if (metadata.deathDate) setDeathDate(metadata.deathDate);
        if (metadata.birthPlace) setBirthPlace(metadata.birthPlace);
        if (metadata.deathPlace) setDeathPlace(metadata.deathPlace);

        if (metadata.instruments && metadata.instruments.length > 0) {
          setInstruments((prev) => {
            const combined = [...prev];
            metadata.instruments.forEach((i) => {
              if (!combined.includes(i)) combined.push(i);
            });
            return combined;
          });
        }

        if (metadata.periods && metadata.periods.length > 0) {
          setPeriods((prev) => {
            const combined = [...prev];
            metadata.periods.forEach((p) => {
              if (!combined.includes(p)) combined.push(p);
            });
            return combined;
          });
        }

        if (metadata.imageUrl) setImageUrl(metadata.imageUrl);
      }
    } catch (error) {
      console.error("Artist metadata error:", error);
      alert("No se pudo autocompletar la información del artista.");
    } finally {
      setFetchingMetadata(false);
    }
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { 
        name, 
        biography, 
        imageUrl, 
        genre, 
        birthDate, 
        deathDate,
        birthPlace,
        deathPlace,
        instruments,
        periods
      };
      
      let artistId = artist?.id;
      if (artist) {
        await updateDoc(doc(db, 'artists', artist.id), data);
      } else {
        artistId = slugifyArtistId(name);
        await setDoc(doc(db, 'artists', artistId), data, { merge: true });
      }

      if (autoGenerateDiscography && artistId) {
        const albums = await fetchArtistDiscography(name, artistId, genre);
        for (const albumData of albums) {
          await addDoc(collection(db, 'albums'), {
            ...albumData,
            artistId,
            genre,
            sidemenIds: []
          });
        }
      }

      onClose();
    } catch (error) {
      handleFirestoreError(error, artist ? OperationType.UPDATE : OperationType.CREATE, 'artists');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!artist) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'artists', artist.id));
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `artists/${artist.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-6">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-ink/60 backdrop-blur-sm" 
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="mobile-dialog relative w-full max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[90vh] bg-paper rounded-none sm:rounded-3xl shadow-2xl overflow-y-auto"
      >
        <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-ink/10 flex items-center justify-between gap-3">
          <h2 className="font-serif text-3xl italic">{artist ? 'Editar Artista' : 'Nuevo Artista'}</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors"><X size={24} /></button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-4 sm:p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Nombre</label>
                <button 
                  type="button"
                  onClick={handleFetchMetadata}
                  disabled={fetchingMetadata || !name}
                  className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline disabled:opacity-50"
                >
                  {fetchingMetadata ? 'Buscando...' : 'Autocompletar Info'}
                </button>
              </div>
              <input 
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                placeholder="Ej. Miles Davis"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Nacimiento</label>
                <input 
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Fallecimiento</label>
                <input 
                  type="date"
                  value={deathDate}
                  onChange={(e) => setDeathDate(e.target.value)}
                  className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Lugar de Nacimiento</label>
              <input 
                value={birthPlace}
                onChange={(e) => setBirthPlace(e.target.value)}
                className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                placeholder="Ciudad, País"
                list="birth-place-list"
              />
              <datalist id="birth-place-list">
                {Array.from(new Set(allArtists.map(a => a.birthPlace).filter(Boolean))).map(v => <option key={v} value={v} />)}
              </datalist>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Lugar de Fallecimiento</label>
              <input 
                value={deathPlace}
                onChange={(e) => setDeathPlace(e.target.value)}
                className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                placeholder="Ciudad, País"
                list="death-place-list"
              />
              <datalist id="death-place-list">
                {Array.from(new Set(allArtists.map(a => a.deathPlace).filter(Boolean))).map(v => <option key={v} value={v} />)}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Instrumentos / Voz</label>
                <button 
                  type="button"
                  onClick={() => setInstruments([...instruments, ''])}
                  className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline flex items-center gap-1"
                >
                  <Plus size={12} />
                  <span>Añadir Instrumento</span>
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {instruments.map((inst, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex gap-2">
                      <select 
                        value={INSTRUMENTS.includes(inst) ? inst : (inst === '' ? '' : 'Otro')}
                        onChange={(e) => {
                          const val = e.target.value;
                          const newInsts = [...instruments];
                          newInsts[index] = val === 'Otro' ? '' : val;
                          setInstruments(newInsts);
                        }}
                        className="flex-1 bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all appearance-none"
                      >
                        <option value="">Seleccionar Instrumento</option>
                        {INSTRUMENTS.filter(i => i !== 'Otro').map(i => (
                          <option key={i} value={i}>{i}</option>
                        ))}
                        <option value="Otro">Otro...</option>
                      </select>
                      <button 
                        type="button"
                        onClick={() => setInstruments(instruments.filter((_, i) => i !== index))}
                        className="p-3 text-ink/20 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    {(!INSTRUMENTS.includes(inst) && inst !== '') || (inst === '' && instruments.length > 0 && !INSTRUMENTS.includes(instruments[index])) ? (
                      <input 
                        value={INSTRUMENTS.includes(inst) ? '' : inst}
                        onChange={(e) => {
                          const newInsts = [...instruments];
                          newInsts[index] = e.target.value;
                          setInstruments(newInsts);
                        }}
                        className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                        placeholder="Especificar instrumento"
                      />
                    ) : null}
                  </div>
                ))}
                {instruments.length === 0 && (
                  <p className="text-xs text-ink/40 italic">No se han añadido instrumentos.</p>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">
                  {genre === 'jazz' ? 'Sub-géneros Jazz' : 'Periodos Musicales'}
                </label>
                <button 
                  type="button"
                  onClick={() => setPeriods([...periods, ''])}
                  className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline flex items-center gap-1"
                >
                  <Plus size={12} />
                  <span>Añadir {genre === 'jazz' ? 'Sub-género' : 'Periodo'}</span>
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {periods.map((p, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex gap-2">
                      <select 
                        value={(genre === 'jazz' ? JAZZ_SUBGENRES : CLASSICAL_PERIODS).includes(p) ? p : (p === '' ? '' : 'Otro')}
                        onChange={(e) => {
                          const val = e.target.value;
                          const newPeriods = [...periods];
                          newPeriods[index] = val === 'Otro' ? '' : val;
                          setPeriods(newPeriods);
                        }}
                        className="flex-1 bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all appearance-none"
                      >
                        <option value="">Seleccionar {genre === 'jazz' ? 'Sub-género' : 'Periodo'}</option>
                        {(genre === 'jazz' ? JAZZ_SUBGENRES : CLASSICAL_PERIODS).filter(opt => opt !== 'Otro').map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                        <option value="Otro">Otro...</option>
                      </select>
                      <button 
                        type="button"
                        onClick={() => setPeriods(periods.filter((_, i) => i !== index))}
                        className="p-3 text-ink/20 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    {(!(genre === 'jazz' ? JAZZ_SUBGENRES : CLASSICAL_PERIODS).includes(p) && p !== '') || (p === '' && periods.length > 0 && !(genre === 'jazz' ? JAZZ_SUBGENRES : CLASSICAL_PERIODS).includes(periods[index])) ? (
                      <input 
                        value={(genre === 'jazz' ? JAZZ_SUBGENRES : CLASSICAL_PERIODS).includes(p) ? '' : p}
                        onChange={(e) => {
                          const newPeriods = [...periods];
                          newPeriods[index] = e.target.value;
                          setPeriods(newPeriods);
                        }}
                        className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                        placeholder={`Especificar ${genre === 'jazz' ? 'sub-género' : 'periodo'}`}
                      />
                    ) : null}
                  </div>
                ))}
                {periods.length === 0 && (
                  <p className="text-xs text-ink/40 italic">No se han añadido {genre === 'jazz' ? 'sub-géneros' : 'periodos'}.</p>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">URL de Imagen</label>
              <div className="flex gap-4">
                <label className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline cursor-pointer flex items-center gap-1">
                  <Upload size={12} />
                  <span>{uploading ? `Subiendo (${Math.round(uploadProgress)}%)` : 'Subir Archivo'}</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={handleFileUpload} 
                    className="hidden" 
                    disabled={uploading}
                  />
                </label>
                <button 
                  type="button"
                  onClick={() => setImageUrl(`https://picsum.photos/seed/${encodeURIComponent(name || 'artist')}/800/800`)}
                  className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline"
                >
                  Generar Aleatoria
                </button>
              </div>
            </div>
            <div className="flex gap-4 items-start">
              <div className="flex-grow space-y-2">
                <input 
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                  placeholder="https://..."
                />
                {imageUrl && !imageUrl.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i) && (
                  <button 
                    type="button"
                    onClick={resolveImage}
                    disabled={resolving}
                    className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline flex items-center gap-1"
                  >
                    {resolving ? 'Resolviendo...' : 'Obtener imagen de este sitio'}
                  </button>
                )}
              </div>
              {imageUrl && (
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-ink/5 flex-shrink-0 border border-ink/10">
                  <img 
                    src={imageUrl} 
                    alt="Preview" 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = 'https://via.placeholder.com/150?text=Error';
                    }}
                  />
                </div>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Fecha de Nacimiento</label>
              <input 
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Lugar de Nacimiento</label>
              <input 
                value={birthPlace}
                onChange={(e) => setBirthPlace(e.target.value)}
                className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                placeholder="Ciudad, País"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Fecha de Fallecimiento (Opcional)</label>
              <input 
                type="date"
                value={deathDate}
                onChange={(e) => setDeathDate(e.target.value)}
                className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Lugar de Fallecimiento</label>
              <input 
                value={deathPlace}
                onChange={(e) => setDeathPlace(e.target.value)}
                className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                placeholder="Ciudad, País"
              />
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Biografía</label>
            <textarea 
              rows={6}
              value={biography}
              onChange={(e) => setBiography(e.target.value)}
              className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all resize-none"
              placeholder="Escribe la historia del artista..."
            />
          </div>

          <div className="bg-gold/5 p-6 rounded-2xl border border-gold/10 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center text-gold">
                <DiscIcon size={16} />
              </div>
              <h4 className="font-serif text-lg italic">Inteligencia Artificial</h4>
            </div>
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative flex items-center">
                <input 
                  type="checkbox"
                  checked={autoGenerateDiscography}
                  onChange={(e) => setAutoGenerateDiscography(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="w-10 h-5 bg-ink/10 rounded-full peer peer-checked:bg-gold transition-colors" />
                <div className="absolute left-1 top-1 w-3 h-3 bg-paper rounded-full peer-checked:translate-x-5 transition-transform" />
              </div>
              <span className="text-sm font-medium text-ink/60 group-hover:text-ink transition-colors">
                Generar discografía automáticamente (Top 10 álbumes)
              </span>
            </label>
            <p className="text-[10px] text-ink/40 leading-relaxed">
              Al activar esta opción, utilizaremos IA para buscar los álbumes más importantes de este artista y añadirlos automáticamente a su perfil con sus respectivas portadas.
            </p>
          </div>

          <div className="sticky bottom-0 bg-paper px-8 py-6 border-t border-ink/10 flex items-center justify-between mt-auto">
            {artist && (
              <div className="flex items-center gap-4">
                {isConfirmingDelete ? (
                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                    <span className="text-xs font-bold text-red-500 uppercase tracking-widest">¿Confirmar?</span>
                    <button 
                      type="button"
                      onClick={handleDelete}
                      disabled={saving}
                      className="px-3 py-1 bg-red-500 text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-red-600 transition-colors"
                    >
                      Sí, Eliminar
                    </button>
                    <button 
                      type="button"
                      onClick={() => setIsConfirmingDelete(false)}
                      className="px-3 py-1 bg-ink/5 text-ink/40 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-ink/10 transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button 
                    type="button"
                    onClick={() => setIsConfirmingDelete(true)}
                    className="flex items-center gap-2 text-red-500 text-sm font-bold uppercase tracking-widest hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={18} />
                    <span>Eliminar</span>
                  </button>
                )}
              </div>
            )}
            <div className="flex gap-4 ml-auto">
              <button 
                type="button"
                onClick={onClose}
                className="px-6 py-3 text-sm font-bold uppercase tracking-widest text-ink/40 hover:text-ink transition-colors"
              >
                Cancelar
              </button>
              <button 
                disabled={saving}
                type="submit"
                className="flex items-center gap-2 px-8 py-3 bg-ink text-paper rounded-full text-sm font-medium hover:bg-gold transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Save size={18} />
                <span>{saving ? 'Guardando...' : (artist ? 'Guardar Cambios' : 'Añadir Artista')}</span>
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function AlbumDetailModal({ album, onClose, onEdit, highlightArtistId }: { album: Album, onClose: () => void, onEdit: () => void, highlightArtistId?: string }) {
  const isWork = getCatalogRecordType(album) === 'work';
  const [artistName, setArtistName] = useState<string>(album.artistName || '');
  const classicalWorkCount = (album.discs || []).reduce((total, disc) => total + (disc.works || []).length, 0) + (album.unassignedWorks?.length || 0);
  const classicalMovementCount = (album.discs || []).reduce((total, disc) =>
    total + (disc.works || []).reduce((count, work) => count + (work.movements || []).length, 0), 0) +
    (album.unassignedWorks || []).reduce((sum, work) => sum + work.movements.length, 0);

  useEffect(() => {
    if (!artistName) {
      const fetchArtist = async () => {
        const artistDoc = await getDoc(doc(db, 'artists', album.artistId));
        if (artistDoc.exists()) {
          setArtistName(artistDoc.data().name);
        }
      };
      fetchArtist();
    }
  }, [album.artistId, artistName]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-6">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-ink/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="mobile-dialog album-detail-dialog relative w-full max-w-5xl h-[100dvh] sm:h-auto sm:max-h-[90vh] bg-paper rounded-none sm:rounded-3xl shadow-2xl overflow-y-auto md:overflow-hidden flex flex-col md:flex-row min-w-0" role="dialog" aria-modal="true" aria-label={`Detalles del álbum: ${album.title}`}
      >
        <button type="button" onClick={onClose} aria-label="Cerrar detalles del álbum" className="md:hidden sticky top-3 self-end mr-3 -mb-12 z-30 w-11 h-11 flex items-center justify-center bg-paper/95 rounded-full shadow-md text-ink"><X size={22} /></button>
        {/* Left Side: Cover & Basic Info */}
        <div className="w-full md:w-2/5 min-w-0 bg-ink/5 p-4 sm:p-8 flex flex-col gap-4 md:gap-8 md:overflow-y-auto border-b md:border-b-0 md:border-r border-ink/10 shrink-0">
          <div className="w-40 sm:w-full max-w-full aspect-square rounded-2xl overflow-hidden shadow-lg sm:shadow-2xl bg-ink/10 mx-auto">
            {album.imageUrl ? (
              <img src={album.imageUrl} alt={album.title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-ink/10">
                <DiscIcon size={120} />
              </div>
            )}
          </div>
          
          <div className="space-y-4">
            <div className="space-y-1">
              {isWork && <p className="text-xs uppercase font-bold tracking-widest text-gold">Obra musical · No es una edición discográfica</p>}
              <h2 className="font-serif text-3xl sm:text-4xl leading-tight break-words">{album.title}</h2>
              <p className="text-gold font-bold uppercase tracking-widest text-sm">{artistName}</p>
            </div>
            
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-4 pt-4">
              {album.releaseYear && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">{isWork ? 'Año de composición' : 'Lanzamiento'}</span>
                  <p className="text-sm font-medium">{album.releaseYear}</p>
                </div>
              )}
              {album.releaseDate && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Publicación</span>
                  <p className="text-sm font-medium">{album.releaseDate}</p>
                </div>
              )}
              {album.availability && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Estado</span>
                  <p className={cn(
                    "text-sm font-bold",
                    (album.availability === 'En Stock' || album.availability === 'En discoteca') ? "text-emerald-600" : "text-red-500"
                  )}>{album.availability}</p>
                </div>
              )}
              {album.originalLabel && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Sello Original</span>
                  <p className="text-sm font-medium break-words">{normalizeRecordLabels(album.originalLabel)}</p>
                </div>
              )}
              {album.originalYear && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Año Original</span>
                  <p className="text-sm font-medium">{album.originalYear}</p>
                </div>
              )}
              {album.label && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Sello</span>
                  <p className="text-sm font-medium break-words">{normalizeRecordLabels(album.label)}</p>
                </div>
              )}
              {album.catalogNumber && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Nº Catálogo</span>
                  <p className="text-sm font-medium">{album.catalogNumber}</p>
                </div>
              )}
              {album.country && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">País</span>
                  <p className="text-sm font-medium">{album.country}</p>
                </div>
              )}
              {(album.formats?.length > 0 || (album as any).format) && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Formato</span>
                  <p className="text-sm font-medium">
                    {album.formats && album.formats.length > 0 
                      ? album.formats.join(', ') 
                      : (album as any).format}
                  </p>
                </div>
              )}
              {album.discCount && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Discos</span>
                  <p className="text-sm font-medium">{album.discCount}</p>
                </div>
              )}
            </div>

            {/* Classical Specific Info in Basic Area if present */}
            {(album.orchestra || album.conductor || album.compositionDate || album.compositionPlace) && (
              <div className="grid grid-cols-1 gap-4 p-4 bg-gold/5 rounded-2xl border border-gold/10">
                {album.orchestra && (
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-gold/60">Orquesta</span>
                    <p className="text-sm font-serif italic">{album.orchestra}</p>
                  </div>
                )}
                {album.conductor && (
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-gold/60">Director</span>
                    <p className="text-sm font-serif italic">{album.conductor}</p>
                  </div>
                )}
                {album.compositionDate && (
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-gold/60">Fecha de composición</span>
                    <p className="text-sm font-serif italic">{album.compositionDate}</p>
                  </div>
                )}
                {album.compositionPlace && (
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-gold/60">Lugar de composición</span>
                    <p className="text-sm font-serif italic">{album.compositionPlace}</p>
                  </div>
                )}
              </div>
            )}
            
            <div className="pt-6 flex gap-4">
              <button 
                onClick={onEdit}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-ink text-paper rounded-full text-sm font-medium hover:bg-gold transition-colors"
              >
                <Edit2 size={16} />
                <span>Editar</span>
              </button>
              <button 
                onClick={onClose}
                className="p-3 bg-ink/5 text-ink/40 rounded-full hover:bg-ink/10 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        </div>

        {/* Right Side: Details, Musicians, Tracks */}
        <div className="flex-1 min-w-0 md:overflow-y-auto p-4 sm:p-8 lg:p-10 space-y-8 md:space-y-12">
          {/* Technical Details */}
          <div className="space-y-6">
            <div className="flex items-center gap-2 text-gold">
              <Settings size={18} />
              <h3 className="text-xs font-bold uppercase tracking-[0.2em]">Detalles de Grabación</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
              {album.location && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Estudio / Ubicación</span>
                  <p className="text-sm">{album.location}</p>
                </div>
              )}
              {album.recordingDates && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Fechas de Grabación</span>
                  <p className="text-sm">{album.recordingDates}</p>
                </div>
              )}
              {album.engineer && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Ingeniero de Grabación</span>
                  <p className="text-sm">{album.engineer}</p>
                </div>
              )}
              {album.masteringEngineer && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Ingeniero de Masterización</span>
                  <p className="text-sm">{album.masteringEngineer}</p>
                </div>
              )}
              {album.producer && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Productor</span>
                  <p className="text-sm">{album.producer}</p>
                </div>
              )}
              {album.originalCatalogNumber && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Catálogo Original</span>
                  <p className="text-sm">{album.originalCatalogNumber}</p>
                </div>
              )}
              {album.editionCatalogNumber && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Catálogo de Edición</span>
                  <p className="text-sm">{album.editionCatalogNumber}</p>
                </div>
              )}
              {album.editionDate && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Fecha de Edición</span>
                  <p className="text-sm">{album.editionDate}</p>
                </div>
              )}
            </div>
          </div>

          {isWork && classicalWorkCount === 0 && !(album.tracks || []).length && (
            <div className="rounded-2xl border border-gold/20 bg-gold/5 p-4">
              <h3 className="font-serif text-xl">Ficha de la obra</h3>
              <p className="text-sm text-ink/65 mt-1">Esta ficha describe una composición, no una grabación específica. No se inventan intérpretes, discos ni movimientos sin una fuente verificable.</p>
            </div>
          )}
          {/* Musicians */}
          {album.musicians && album.musicians.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-gold">
                <Users size={18} />
                <h3 className="text-xs font-bold uppercase tracking-[0.2em]">Músicos</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {album.musicians.map((m, i) => (
                  <div key={i} className="flex items-start gap-4 p-4 bg-ink/5 rounded-2xl">
                    <div className="w-10 h-10 rounded-full bg-paper flex items-center justify-center text-gold shrink-0">
                      <UserIcon size={18} />
                    </div>
                    <div>
                      <p className="font-bold text-sm">{m.name}</p>
                      <p className="text-xs text-ink/60">{m.instrument}</p>
                      {m.notes && <p className="text-[10px] italic text-ink/40 mt-1">{m.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {album.genre === 'classical' && classicalWorkCount > 0 && (
            <div className="rounded-2xl border border-gold/20 bg-gold/5 p-4 space-y-2">
              <h3 className="font-serif text-lg">Índice de la grabación</h3>
              <div className="flex flex-wrap gap-2 text-xs font-semibold text-ink/60">
                <span className="rounded-full bg-white px-3 py-1">{(album.discs || []).length} discos</span>
                <span className="rounded-full bg-white px-3 py-1">{classicalWorkCount} obras</span>
                <span className="rounded-full bg-white px-3 py-1">{classicalMovementCount} movimientos</span>
              </div>
              <div className="space-y-1">
                {(album.discs || []).flatMap((disc, discIndex) =>
                  (disc.works || []).map((work, workIndex) => (
                    <button type="button" key={discIndex + '-' + workIndex}
                       onClick={() => document.getElementById('work-' + discIndex + '-' + workIndex)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                       className="block w-full text-left rounded-lg px-2 py-2 text-sm hover:bg-white focus-visible:outline focus-visible:outline-gold">
                      <span className="text-gold font-bold">Disco {disc.discNumber} · </span>{work.title}
                    </button>
                  )))}
              </div>
            </div>
          )}

          {album.genre === 'classical' && Boolean(album.unassignedWorks?.length) && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
              <h3 className="font-serif text-xl">Obras sin disco identificado</h3>
              <p className="text-xs text-ink/60">Estas obras aparecen en el Word, pero no se conoce su ubicación física en el set. No se han asignado al primer disco por suposición.</p>
              {(album.unassignedWorks || []).map((work,index) => (
                <div key={index} className="rounded-xl bg-white p-3 space-y-2">
                  <p className="text-sm font-semibold">{work.title}</p>
                  {work.compositionDate && <p className="text-xs text-ink/50">Composición: {work.compositionDate}</p>}
                  {(work.movements||[]).map((movement,i)=>(
                    <p key={i} className="text-xs text-ink/70">{movement.title}
                      {movement.notes ? ' · '+movement.notes : ''}</p>
                  ))}
                </div>
              ))}
            </section>
          )}

          {/* Tracks / Works Hierarchy */}
          {((album.tracks && album.tracks.length > 0) || (album.discs && album.discs.length > 0)) && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-gold">
                <Music2 size={18} />
                <h3 className="text-xs font-bold uppercase tracking-[0.2em]">
                  {album.genre === 'classical' ? 'Obras y Movimientos' : 'Lista de Temas'}
                </h3>
              </div>
              
              {album.genre === 'classical' && album.discs && album.discs.length > 0 ? (
                <div className="space-y-8">
                  {album.discs.map((disc, dIdx) => (
                    <div key={dIdx} className="space-y-4">
                      <div className="flex items-center gap-2 pb-2 border-b border-gold/20">
                        <DiscIcon size={16} className="text-gold" />
                        <span className="text-xs font-bold uppercase tracking-widest text-gold">
                          Disco {disc.discNumber}{disc.title ? `: ${disc.title}` : ''}
                        </span>
                      </div>
                      <div className="space-y-6 pl-1 sm:pl-4">
                        {disc.works.map((work, wIdx) => {
                        const isHighlighted = highlightArtistId && Array.isArray((work as any).trackArtists) && (work as any).trackArtists.includes(highlightArtistId);
                        return (
                          <div key={wIdx} id={'work-' + dIdx + '-' + wIdx} className={cn("space-y-3 rounded-xl p-3 -mx-3 transition-colors scroll-mt-20", isHighlighted ? "bg-gold/10 border border-gold/30" : "")}>
                            <div className="flex flex-col">
                              <span className={cn("text-sm font-bold", isHighlighted ? "text-gold" : "text-ink/90")}>{work.title}{isHighlighted && <span className="ml-2 text-[10px] uppercase tracking-widest font-bold text-gold/70">★ Grabación destacada</span>}</span>
                              {(work.orchestra || work.conductor || work.soloists?.length || work.foundationDate || work.foundationPlace || work.founderName || work.choirMaster) && (
                                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                                  {work.orchestra && (
                                    <span className="text-[10px] text-ink/40 italic">
                                      <span className="font-bold uppercase tracking-tighter not-italic mr-1">Orq:</span> {work.orchestra}
                                    </span>
                                  )}
                                  {work.conductor && (
                                    <span className="text-[10px] text-ink/40 italic">
                                      <span className="font-bold uppercase tracking-tighter not-italic mr-1">Dir:</span> {work.conductor}
                                    </span>
                                  )}
                                  {work.soloists && work.soloists.length > 0 && (
                                    <div className="w-full mt-1 space-y-1">
                                      {work.soloists.map((s, idx) => (
                                        <div key={idx} className="text-[10px] text-ink/40 italic flex flex-wrap gap-x-2">
                                          <span className="font-bold uppercase tracking-tighter not-italic">Sol:</span>
                                          <span>{s.name}{s.instrument ? ` (${s.instrument})` : ''}</span>
                                          {(s.birthDate || s.birthPlace) && (
                                            <span>
                                              [N: {s.birthDate || ''}{s.birthPlace ? ` en ${s.birthPlace}` : ''}]
                                            </span>
                                          )}
                                          {(s.deathDate || s.deathPlace) && (
                                            <span>
                                              [F: {s.deathDate || ''}{s.deathPlace ? ` en ${s.deathPlace}` : ''}]
                                            </span>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {work.founderName && (
                                    <span className="text-[10px] text-ink/40 italic">
                                      <span className="font-bold uppercase tracking-tighter not-italic mr-1">Fundador:</span> {work.founderName}
                                    </span>
                                  )}
                                  {work.choirMaster && (
                                    <span className="text-[10px] text-ink/40 italic">
                                      <span className="font-bold uppercase tracking-tighter not-italic mr-1">Maestro:</span> {work.choirMaster}
                                    </span>
                                  )}
                                  {work.foundationDate && (
                                    <span className="text-[10px] text-ink/40 italic">
                                      <span className="font-bold uppercase tracking-tighter not-italic mr-1">Fundación:</span> {work.foundationDate}
                                    </span>
                                  )}
                                  {work.foundationPlace && (
                                    <span className="text-[10px] text-ink/40 italic">
                                      <span className="font-bold uppercase tracking-tighter not-italic mr-1">Lugar:</span> {work.foundationPlace}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="space-y-1">
                              {work.movements.map((mov, mIdx) => (
                                <React.Fragment key={mIdx}>
                                  <div className="flex items-start sm:items-center gap-2 sm:gap-4 p-2 hover:bg-ink/5 rounded-lg transition-colors group min-w-0">
                                    <span className="w-6 text-center text-[10px] font-bold text-ink/20 group-hover:text-gold">{mov.trackNumber}</span>
                                    {mov.side && <span className="text-[10px] font-bold text-gold/60 w-4">{mov.side}</span>}
                                    <span className="flex-1 min-w-0 text-xs text-ink/70 break-words">{mov.title}</span>
                                    {mov.duration && <span className="text-[10px] text-ink/30 font-mono">{mov.duration}</span>}
                                  </div>
                                  {(mov.orchestra || mov.conductor || mov.soloists?.length || mov.foundationDate || mov.foundationPlace || mov.founderName || mov.choirMaster || mov.compositionDate || mov.compositionPlace) && (
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 ml-10 mb-2">
                                      {mov.orchestra && (
                                        <span className="text-[10px] text-ink/40 italic">
                                          <span className="font-bold uppercase tracking-tighter not-italic mr-1">Orq:</span> {mov.orchestra}
                                        </span>
                                      )}
                                      {mov.conductor && (
                                        <span className="text-[10px] text-ink/40 italic">
                                          <span className="font-bold uppercase tracking-tighter not-italic mr-1">Dir:</span> {mov.conductor}
                                        </span>
                                      )}
                                      {mov.soloists && mov.soloists.length > 0 && (
                                        <div className="w-full mt-1 space-y-1">
                                          {mov.soloists.map((s, idx) => (
                                            <div key={idx} className="text-[10px] text-ink/40 italic flex flex-wrap gap-x-2">
                                              <span className="font-bold uppercase tracking-tighter not-italic">Sol:</span>
                                              <span>{s.name}{s.instrument ? ` (${s.instrument})` : ''}</span>
                                              {(s.birthDate || s.birthPlace) && (
                                                <span>
                                                  [N: {s.birthDate || ''}{s.birthPlace ? ` en ${s.birthPlace}` : ''}]
                                                </span>
                                              )}
                                              {(s.deathDate || s.deathPlace) && (
                                                <span>
                                                  [F: {s.deathDate || ''}{s.deathPlace ? ` en ${s.deathPlace}` : ''}]
                                                </span>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      {mov.founderName && (
                                        <span className="text-[10px] text-ink/40 italic">
                                          <span className="font-bold uppercase tracking-tighter not-italic mr-1">Fundador:</span> {mov.founderName}
                                        </span>
                                      )}
                                      {mov.choirMaster && (
                                        <span className="text-[10px] text-ink/40 italic">
                                          <span className="font-bold uppercase tracking-tighter not-italic mr-1">Maestro:</span> {mov.choirMaster}
                                        </span>
                                      )}
                                      {mov.compositionDate && (
                                        <span className="text-[10px] text-ink/40 italic">
                                          <span className="font-bold uppercase tracking-tighter not-italic mr-1">Comp:</span> {mov.compositionDate}
                                        </span>
                                      )}
                                      {mov.compositionPlace && (
                                        <span className="text-[10px] text-ink/40 italic">
                                          <span className="font-bold uppercase tracking-tighter not-italic mr-1">Lugar:</span> {mov.compositionPlace}
                                        </span>
                                      )}
                                      {mov.foundationDate && (
                                        <span className="text-[10px] text-ink/40 italic">
                                          <span className="font-bold uppercase tracking-tighter not-italic mr-1">Fundación:</span> {mov.foundationDate}
                                        </span>
                                      )}
                                      {mov.foundationPlace && (
                                        <span className="text-[10px] text-ink/40 italic">
                                          <span className="font-bold uppercase tracking-tighter not-italic mr-1">Lugar:</span> {mov.foundationPlace}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                        );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {album.tracks?.map((t, i) => (
                    <div key={i} className="flex items-center gap-4 p-3 hover:bg-ink/5 rounded-xl transition-colors group">
                      <span className="w-6 text-center text-[10px] font-bold text-ink/20 group-hover:text-gold">{t.trackNumber || i + 1}</span>
                      {t.side && <span className="text-[10px] font-bold text-gold/60 w-12">{t.side === 'A' ? 'Lado A' : 'Lado B'}</span>}
                      <div className="flex-grow flex flex-col">
                        <span className="text-sm font-medium">{t.title}</span>
                        {album.genre === 'classical' && (t.orchestra || t.conductor || t.soloists || t.compositionDate || t.compositionPlace || t.foundationDate || t.foundationPlace || t.founderName || t.choirMaster) && (
                          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                            {t.orchestra && (
                              <span className="text-[10px] text-ink/40 italic">
                                <span className="font-bold uppercase tracking-tighter not-italic mr-1">Orq:</span> {t.orchestra}
                              </span>
                            )}
                            {t.conductor && (
                              <span className="text-[10px] text-ink/40 italic">
                                <span className="font-bold uppercase tracking-tighter not-italic mr-1">Dir:</span> {t.conductor}
                              </span>
                            )}
                            {t.soloists && Array.isArray(t.soloists) && t.soloists.length > 0 && (
                              <span className="text-[10px] text-ink/40 italic">
                                <span className="font-bold uppercase tracking-tighter not-italic mr-1">Sol:</span> 
                                {t.soloists.map((s, idx) => (
                                  <span key={idx}>
                                    {s.name}{s.instrument ? ` (${s.instrument})` : ''}{idx < t.soloists!.length - 1 ? ', ' : ''}
                                  </span>
                                ))}
                              </span>
                            )}
                            {t.founderName && (
                              <span className="text-[10px] text-ink/40 italic">
                                <span className="font-bold uppercase tracking-tighter not-italic mr-1">Fundador:</span> {t.founderName}
                              </span>
                            )}
                            {t.choirMaster && (
                              <span className="text-[10px] text-ink/40 italic">
                                <span className="font-bold uppercase tracking-tighter not-italic mr-1">Maestro:</span> {t.choirMaster}
                              </span>
                            )}
                            {t.compositionDate && (
                              <span className="text-[10px] text-ink/40 italic">
                                <span className="font-bold uppercase tracking-tighter not-italic mr-1">Comp:</span> {t.compositionDate}
                              </span>
                            )}
                            {t.compositionPlace && (
                              <span className="text-[10px] text-ink/40 italic">
                                <span className="font-bold uppercase tracking-tighter not-italic mr-1">Lugar:</span> {t.compositionPlace}
                              </span>
                            )}
                            {t.foundationDate && (
                              <span className="text-[10px] text-ink/40 italic">
                                <span className="font-bold uppercase tracking-tighter not-italic mr-1">Fundación:</span> {t.foundationDate}
                              </span>
                            )}
                            {t.foundationPlace && (
                              <span className="text-[10px] text-ink/40 italic">
                                <span className="font-bold uppercase tracking-tighter not-italic mr-1">Lugar:</span> {t.foundationPlace}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {t.duration && <span className="text-xs text-ink/40 font-mono">{t.duration}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Anecdotes */}
          {album.anecdotes && (
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-gold">
                <FileText size={18} />
                <h3 className="text-xs font-bold uppercase tracking-[0.2em]">Anécdotas</h3>
              </div>
              <div className="p-6 bg-gold/5 border border-gold/10 rounded-3xl italic text-ink/80 leading-relaxed text-sm">
                {album.anecdotes}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function AlbumModal({ album, artistId, genre, onClose }: { album?: Album, artistId: string, genre: Genre, onClose: () => void }) {
  const [title, setTitle] = useState(album?.title || '');
  const [releaseYear, setReleaseYear] = useState(album?.releaseYear || '');
  const [recordType, setRecordType] = useState<CatalogRecordType>(album ? getCatalogRecordType(album) : 'recording');
  const [imageUrl, setImageUrl] = useState(album?.imageUrl || '');
  const [resolving, setResolving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [sidemenIds, setSidemenIds] = useState<string[]>(album?.sidemenIds || []);
  const [isFetchingDiscogs, setIsFetchingDiscogs] = useState(false);
  const [discogsPreview, setDiscogsPreview] = useState<DiscogsEditPreview | null>(null);
  const [discogsChoices, setDiscogsChoices] = useState<Record<string,boolean>>({});
  const [discogsReviewError, setDiscogsReviewError] = useState('');
  const [discogsReleaseLoading, setDiscogsReleaseLoading] = useState(false);

  const [discogsSearchMode, setDiscogsSearchMode] = useState<'catno' | 'barcode'>('catno');
  const [barcodeNumber, setBarcodeNumber] = useState('');
  const [discogsUrl, setDiscogsUrl] = useState('');
  const [allArtistIds, setAllArtistIds] = useState<string[]>(album?.allArtistIds || []);
  const [artistLinkToAdd, setArtistLinkToAdd] = useState('');
  const [artistName, setArtistName] = useState(album?.artistName || '');
  const [recordingDates, setRecordingDates] = useState(album?.recordingDates || '');
  const [releaseDate, setReleaseDate] = useState(album?.releaseDate || '');
  const [location, setLocation] = useState(album?.location || '');
  const [label, setLabel] = useState(album?.label || '');
  const [discogsLabelOptions, setDiscogsLabelOptions] = useState<string[]>([]);
  const [catalogNumber, setCatalogNumber] = useState(album?.catalogNumber || '');
  const [originalCatalogNumber, setOriginalCatalogNumber] = useState(album?.originalCatalogNumber || '');
  const [editionCatalogNumber, setEditionCatalogNumber] = useState(album?.editionCatalogNumber || '');
  const [editionDate, setEditionDate] = useState(album?.editionDate || '');
  const [country, setCountry] = useState(album?.country || '');
  const [originalLabel, setOriginalLabel] = useState(album?.originalLabel || '');
  const [originalYear, setOriginalYear] = useState(album?.originalYear || '');
  const [foundationDate, setFoundationDate] = useState(album?.foundationDate || '');
  const [foundationPlace, setFoundationPlace] = useState(album?.foundationPlace || '');
  const [founderName, setFounderName] = useState(album?.founderName || '');
  const [choirMaster, setChoirMaster] = useState(album?.choirMaster || '');
  const [engineer, setEngineer] = useState(album?.engineer || '');
  const [masteringEngineer, setMasteringEngineer] = useState(album?.masteringEngineer || '');
  const [producer, setProducer] = useState(album?.producer || '');
  const [discCount, setDiscCount] = useState<number>(album?.discCount ?? (album && getCatalogRecordType(album) === 'work' ? 0 : 1));
  const [formats, setFormats] = useState<('CD' | 'Vinilo' | 'DVD' | 'Bluray')[]>(
    album?.formats || ((album as any)?.format ? [(album as any).format] : (album && getCatalogRecordType(album) === 'work' ? [] : ['CD']))
  );
  const [orchestra, setOrchestra] = useState(album?.orchestra || '');
  const [conductor, setConductor] = useState(album?.conductor || '');
  const [compositionDate, setCompositionDate] = useState(album?.compositionDate || '');
  const [compositionPlace, setCompositionPlace] = useState(album?.compositionPlace || '');
  const [musicians, setMusicians] = useState<Musician[]>(album?.musicians || []);
  const [tracks, setTracks] = useState<Track[]>(album?.tracks || []);
  const [discs, setDiscs] = useState<Disc[]>(album?.discs || (genre === 'classical' && !(album && getCatalogRecordType(album) === 'work') ? [{ discNumber: 1, works: [] }] : []));
  const [anecdotes, setAnecdotes] = useState(album?.anecdotes || '');
  const [pendingComposers, setPendingComposers] = useState<string[]>([]);
  const [currentComposerIndex, setCurrentComposerIndex] = useState(0);
  const [composerData, setComposerData] = useState<any>(null);
  const [loadingComposer, setLoadingComposer] = useState(false);

  const [allArtists, setAllArtists] = useState<Artist[]>([]);
  const [allAlbums, setAllAlbums] = useState<Album[]>([]);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [albumSaveError, setAlbumSaveError] = useState('');

  useEffect(() => {
    if (!artistName && artistId) {
      const fetchArtist = async () => {
        const artistDoc = await getDoc(doc(db, 'artists', artistId));
        if (artistDoc.exists()) {
          setArtistName(artistDoc.data().name);
        }
      };
      fetchArtist();
    }
  }, [artistId, artistName]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log("--- Starting Album Image Upload (Resumable) ---");
    console.log("File name:", file.name);
    console.log("File size:", file.size, "bytes");
    
    setUploading(true);
    setUploadProgress(10);
    
    try {
      let fileToUpload: File | Blob = file;
      
      if (file.size > 200 * 1024) {
        console.log("Compressing album image...");
        try {
          const options = {
            maxSizeMB: 0.5,
            maxWidthOrHeight: 1200,
            useWebWorker: true
          };

          fileToUpload = await imageCompression(file, options);
          console.log("Compressed album size:", fileToUpload.size, "bytes");
        } catch (compressionError) {
          console.error("Album compression failed, using original:", compressionError);
          fileToUpload = file;
        }
      }

      setUploadProgress(20);
      const fileName = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
      const storageRef = ref(storage, `images/${fileName}`);
      console.log("Album storage reference path:", storageRef.fullPath);

      console.log("Uploading to Firebase Storage...");
      try {
        await uploadBytes(storageRef, fileToUpload);

        const downloadURL = await getDownloadURL(storageRef);
        console.log("Upload complete. Download URL:", downloadURL);

        setImageUrl(downloadURL);
        setUploadProgress(100);
        setUploading(false);
      } catch (error) {
        console.error("Upload failed:", error);
        alert("Error al subir la imagen.");
        setUploading(false);
      }
        
    } catch (error: any) {
      console.error("CRITICAL ERROR in album handleFileUpload:", error);
      alert("Error inesperado. Por favor, inténtalo de nuevo.");
      setUploading(false);
    }
  };

  const handleFetchFromDiscogs = async () => {
    const searchValue = discogsSearchMode === 'barcode' ? barcodeNumber.trim() : catalogNumber.trim();
    if (!searchValue) {
      alert(discogsSearchMode === 'barcode' ? 'Introduce un código de barras primero.' : 'Introduce un número de catálogo primero.');
      return;
    }

    setIsFetchingDiscogs(true);

    try {
      const param = discogsSearchMode === 'barcode'
        ? `barcode=${encodeURIComponent(searchValue)}`
        : `catno=${encodeURIComponent(searchValue)}`;

      const response = await privateApiFetch(`/api/discogs-search-by-catalog?${param}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo buscar en Discogs.');
      }

      // Show the information as a proposal. Never overwrite an existing field on search.
      const review=makeDiscogsEditPreview(data,Array.isArray(data.candidates)?data.candidates:[]);
      setDiscogsPreview(review);
      setDiscogsChoices({});
      setDiscogsReviewError('');
    } catch (error: any) {
      console.error('Discogs fetch error:', error);
      alert(error.message || 'No se pudo obtener información desde Discogs.');
    } finally {
      setIsFetchingDiscogs(false);
    }
  };

  const selectDiscogsRelease = async (releaseId:string) => {
    if (!releaseId || !/^\\d+$/.test(releaseId)) return;
    setDiscogsReleaseLoading(true);
    setDiscogsReviewError('');
    try {
      const response=await privateApiFetch('/api/discogs-search-by-catalog?releaseId='+encodeURIComponent(releaseId));
      const data=await response.json();
      if(!response.ok)throw new Error(data?.error||'No se pudo obtener la edición.');
      const candidates=discogsPreview?.candidates||[];
      const proposal=makeDiscogsEditPreview(data,candidates);
      setDiscogsPreview(proposal);
      setDiscogsChoices({});
    } catch(error) {
      setDiscogsReviewError(error instanceof Error?error.message:String(error));
    } finally {setDiscogsReleaseLoading(false);}
  };

  const applySelectedDiscogsFields = () => {
    if(!discogsPreview)return;
    const proposed=pickDiscogsChanges(discogsPreview,discogsChoices);
    const fields=proposed.fields;
    if(fields.title!==undefined)setTitle(fields.title);
    if(fields.releaseYear!==undefined)setReleaseYear(fields.releaseYear);
    if(fields.country!==undefined)setCountry(fields.country);
    if(fields.label!==undefined)setLabel(fields.label);
    if(fields.catalogNumber!==undefined)setCatalogNumber(fields.catalogNumber);
    if(fields.editionDate!==undefined)setEditionDate(fields.editionDate);
    if(fields.editionCatalogNumber!==undefined)setEditionCatalogNumber(fields.editionCatalogNumber);
    if(fields.releaseDate!==undefined)setReleaseDate(fields.releaseDate);
    if(fields.imageUrl!==undefined)setImageUrl(fields.imageUrl);
    if(fields.orchestra!==undefined)setOrchestra(fields.orchestra);
    if(fields.conductor!==undefined)setConductor(fields.conductor);
    if(fields.producer!==undefined)setProducer(fields.producer);
    if(fields.engineer!==undefined)setEngineer(fields.engineer);
    if(fields.masteringEngineer!==undefined)setMasteringEngineer(fields.masteringEngineer);
    if(proposed.formats!==undefined)setFormats(proposed.formats);
    if(proposed.discCount!==undefined)setDiscCount(proposed.discCount);
    if(proposed.tracks!==undefined && proposed.discs!==undefined) {
      if(genre==='classical')setDiscs(proposed.discs);
      else setTracks(proposed.tracks);
    }
    if(proposed.artistNames?.length) {
      (window as any).__discogsAllArtistNames=proposed.artistNames;
    }
    if(discogsPreview.discogsUrl)setDiscogsUrl(discogsPreview.discogsUrl);
    setDiscogsPreview(null);
    setDiscogsChoices({});
    setDiscogsReviewError('');
    // A release label has no bearing on the original historical label.
  };

  const resolveImage = async () => {
    if (!imageUrl || imageUrl.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) return;
    setResolving(true);
    try {
      const response = await privateApiFetch(`/api/resolve-image?url=${encodeURIComponent(imageUrl)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.imageUrl) {
          setImageUrl(data.imageUrl);
        }
      }
    } catch (error) {
      console.error("Error resolving image:", error);
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'artists'), where('genre', '==', genre));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAllArtists(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Artist)));
    });
    return unsubscribe;
  }, [genre]);

  useEffect(() => {
    const q = query(collection(db, 'albums'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAllAlbums(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Album)));
    });
    return unsubscribe;
  }, []);

  const buildAlbumDataForArtist = (targetArtistId: string, targetArtistName: string) => ({
    recordType,
    title,
    releaseYear,
    imageUrl,
    artistId: targetArtistId,
    genre,
    sidemenIds,
    artistName: targetArtistName,
    recordingDates,
    releaseDate,
    location,
    label: normalizeRecordLabels(label),
    catalogNumber,
    originalCatalogNumber,
    editionCatalogNumber,
    editionDate,
    country,
    originalLabel: normalizeRecordLabels(originalLabel),
    originalYear,
    foundationDate,
    foundationPlace,
    founderName,
    choirMaster,
    engineer,
    masteringEngineer,
    producer,
    discCount,
    formats,
    orchestra,
    conductor,
    compositionDate,
    compositionPlace,
    musicians,
    tracks,
    discs,
    anecdotes,
  });

  const approveCurrentComposer = async () => {
    if (!composerData?.name) return;

    setSaving(true);

    try {
      const existingArtist = await getArtistByName(composerData.name);
      const targetArtistId = existingArtist?.id || slugifyArtistId(composerData.name);

      if (!existingArtist) {
        await saveArtistData(targetArtistId, {
          id: targetArtistId,
          name: composerData.name,
          genre: 'classical',
          biography: composerData.biography || '',
          biographySections: composerData.biographySections || [],
          imageUrl: composerData.imageUrl || '',
          birthDate: composerData.birthDate || '',
          birthPlace: composerData.birthPlace || '',
          deathDate: composerData.deathDate || '',
          deathPlace: composerData.deathPlace || '',
          instruments: composerData.instruments || [],
          periods: composerData.periods || [],
        });
      }

      await addDoc(collection(db, 'albums'), buildAlbumDataForArtist(targetArtistId, composerData.name));

      if (currentComposerIndex < pendingComposers.length - 1) {
        setCurrentComposerIndex(currentComposerIndex + 1);
        setComposerData(null);
      } else {
        setPendingComposers([]);
        setComposerData(null);
        setCurrentComposerIndex(0);
        alert('Álbum guardado para todos los compositores aprobados.');
      }
    } catch (error) {
      const errInfo = handleFirestoreError(error, OperationType.CREATE, 'artists/albums');
      console.error('Composer album approval failed:', errInfo);
      alert('No se pudo guardar este compositor/álbum. Revisa la consola.');
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setAlbumSaveError('');
    const validationError = validateAlbumSave(title, artistName, Boolean(album));
    if (validationError) {
      setAlbumSaveError(validationError);
      return;
    }
    if (discogsLabelOptions.length > 1 && !discogsLabelOptions.includes(label)) {
      setAlbumSaveError('Selecciona el sello discográfico de tu edición antes de guardar.');
      return;
    }
    setSaving(true);
    try {
      const data = { 
        recordType,
        title, 
        releaseYear, 
        imageUrl, 
        artistId, 
        genre, 
        sidemenIds,
        ...artistNameUpdate(artistName, Boolean(album)),
        recordingDates,
        releaseDate,
        location,
        label: normalizeRecordLabels(label),
        catalogNumber,
        originalCatalogNumber,
        editionCatalogNumber,
        editionDate,
        country,
        originalLabel: normalizeRecordLabels(originalLabel),
        originalYear,
        foundationDate,
        foundationPlace,
        founderName,
        choirMaster,
        engineer,
        masteringEngineer,
        producer,
        discCount,
        formats,
        orchestra,
        conductor,
        compositionDate,
        compositionPlace,
        musicians,
        tracks,
        discs,
        anecdotes,
        allArtistIds: linkedArtistIds(artistId, allArtistIds),
      };
      if (album) {
        await updateDoc(doc(db, 'albums', album.id), data);
      } else {
        const savedRef = await addDoc(collection(db, 'albums'), data);
        // Resolve and link all artists from Discogs result (multi-artist albums)
        const pendingNames: string[] = (window as any).__discogsAllArtistNames || [];
        if (pendingNames.length > 1) {
          const resolvedIds: string[] = [];
          for (const name of pendingNames) {
            const aId = slugifyArtistId(name);
            const aSnap = await getDoc(doc(db, 'artists', aId));
            if (aSnap.exists()) resolvedIds.push(aId);
          }
          if (resolvedIds.length > 0) {
            await updateDoc(savedRef, { allArtistIds: resolvedIds });
          }
          delete (window as any).__discogsAllArtistNames;
        }
      }
      onClose();
    } catch (error) {
      const errInfo = handleFirestoreError(error, album ? OperationType.UPDATE : OperationType.CREATE, 'albums');
      console.error('Album save failed:', errInfo);
      setAlbumSaveError('No se pudo guardar el álbum. ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!album) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'albums', album.id));
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `albums/${album.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-0 sm:p-6">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-ink/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="mobile-dialog relative w-full max-w-3xl h-[100dvh] sm:h-auto sm:max-h-[90vh] bg-paper rounded-none sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col"
      >
        <form onSubmit={handleSubmit} noValidate className="classical-editor flex flex-col h-full min-h-0 overflow-hidden">
          <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-ink/10 flex items-center justify-between gap-3 bg-paper shrink-0">
            <h2 className="font-serif text-3xl italic">{album ? 'Editar Álbum' : 'Nuevo Álbum'}</h2>
            <button type="button" onClick={onClose} className="text-ink/40 hover:text-ink transition-colors"><X size={24} /></button>
          </div>

          <div className="flex-grow min-h-0 overflow-y-auto p-4 sm:p-8 space-y-8 sm:space-y-10">
            {pendingComposers.length > 0 && (
              <div className="rounded-3xl border border-gold/30 bg-white p-6 space-y-4 shadow-sm">
                <h3 className="font-serif text-2xl italic">
                  Confirmar compositor {currentComposerIndex + 1} de {pendingComposers.length}
                </h3>

                {loadingComposer && (
                  <p className="text-sm text-ink/50">Cargando datos del compositor...</p>
                )}

                {composerData && (
                  <div className="space-y-4">
                    <div className="flex gap-4 items-start">
                      {composerData.imageUrl && (
                        <img
                          src={composerData.imageUrl}
                          alt={composerData.name}
                          className="w-32 h-32 rounded-full object-cover bg-ink/5"
                          referrerPolicy="no-referrer"
                        />
                      )}

                      <div className="space-y-2">
                        <div className="font-bold text-lg">{composerData.name}</div>
                        <div className="text-sm text-ink/50">
                          {[composerData.birthDate, composerData.birthPlace].filter(Boolean).join(" • ")}
                        </div>
                        <div className="text-sm text-ink/50">
                          {[composerData.deathDate, composerData.deathPlace].filter(Boolean).join(" • ")}
                        </div>
                      </div>
                    </div>

                    <p className="text-sm leading-relaxed text-ink/70 whitespace-pre-line max-h-56 overflow-y-auto">
                      {composerData.biography || 'No se encontró biografía.'}
                    </p>

                    <button
                      type="button"
                      onClick={approveCurrentComposer}
                      disabled={saving || loadingComposer}
                      className="px-5 py-3 rounded-full bg-ink text-paper text-sm font-medium hover:bg-gold transition-colors disabled:opacity-50"
                    >
                      {saving ? 'Guardando...' : 'Aprobar, guardar y continuar'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Section: Basic Info */}
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-gold">
                <DiscIcon size={18} />
                <h3 className="text-xs font-bold uppercase tracking-[0.2em]">Información Básica</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {genre === 'classical' && (
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40" htmlFor="catalog-record-type">Tipo de registro</label>
                    <select id="catalog-record-type" value={recordType} onChange={e => setRecordType(e.target.value as CatalogRecordType)} className="w-full bg-ink/5 rounded-xl px-4 py-3 text-base">
                      <option value="recording">Grabación / edición discográfica</option>
                      <option value="work">Obra musical (sin grabación específica)</option>
                    </select>
                    <p className="text-xs text-ink/50">Las obras se muestran separadas de los discos. Cambiar este campo no elimina ninguna pista, intérprete ni edición.</p>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">{recordType === 'work' ? 'Título de la obra' : 'Título del Álbum'}</label>
                  <input 
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                    placeholder="Ej. Kind of Blue"
                    list="album-title-list"
                  />
                  <datalist id="album-title-list">
                    {Array.from(new Set(allAlbums.map(a => a.title).filter(Boolean))).map(v => <option key={v} value={v} />)}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Nombre del Artista</label>
                  <input 
                    required
                    value={artistName}
                    onChange={(e) => setArtistName(e.target.value)}
                    className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                    placeholder="Ej. Miles Davis"
                    list="artist-name-list"
                  />
                  <datalist id="artist-name-list">
                    {Array.from(new Set(allArtists.map(a => a.name).filter(Boolean))).map(v => <option key={v} value={v} />)}
                  </datalist>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-ink/10 bg-ink/[0.025] p-4 sm:p-5">
                <div>
                  <h3 className="text-xs uppercase tracking-widest font-bold text-gold">Artistas vinculados a este álbum</h3>
                  <p className="mt-1 text-xs text-ink/50">
                    Un solo álbum en la colección, visible también en las páginas de los artistas seleccionados.
                    No se crean copias del disco.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {linkedArtistIds(artistId, allArtistIds).map(id => {
                    const associated = allArtists.find(a => a.id === id);
                    return (
                      <span key={id} className="inline-flex max-w-full items-center gap-2 rounded-full border border-ink/10 bg-white px-3 py-2 text-xs">
                        <span className="truncate">{associated?.name || (id === artistId ? artistName : id)}{id === artistId ? ' · Principal' : ''}</span>
                        {id !== artistId && (
                          <button type="button" aria-label={`Desvincular ${associated?.name || id}`}
                            onClick={() => setAllArtistIds(current => current.filter(item => item !== id))}>
                            <X size={14}/>
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
                <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                  <select aria-label="Vincular otro artista" value={artistLinkToAdd}
                    onChange={event => setArtistLinkToAdd(event.target.value)}
                    className="min-w-0 flex-1 rounded-xl bg-white border border-ink/10 px-3 py-3 text-sm">
                    <option value="">Seleccionar otro artista...</option>
                    {allArtists.filter(a => !linkedArtistIds(artistId, allArtistIds).includes(a.id))
                      .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                  <button type="button" disabled={!artistLinkToAdd}
                    onClick={() => {
                      setAllArtistIds(current => linkedArtistIds(artistId, [...current, artistLinkToAdd]));
                      setArtistLinkToAdd('');
                    }}
                    className="rounded-xl bg-ink px-4 py-3 text-xs font-semibold text-white disabled:opacity-40">
                    Vincular artista
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">{recordType === 'work' ? 'Año de composición' : 'Año de Lanzamiento'}</label>
                  <input 
                    value={releaseYear}
                    onChange={(e) => setReleaseYear(e.target.value)}
                    className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                    placeholder="Ej. 1959"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Fecha de Publicación</label>
                  <input 
                    type="date"
                    value={releaseDate}
                    onChange={(e) => setReleaseDate(e.target.value)}
                    className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Section: Credits (Jazz) */}
            {genre === 'jazz' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gold">
                    <Users size={18} />
                    <h3 className="text-xs font-bold uppercase tracking-[0.2em]">Créditos / Músicos</h3>
                  </div>
                  <button 
                    type="button"
                    onClick={() => setMusicians([...musicians, { name: '', instrument: '' }])}
                    className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline flex items-center gap-1"
                  >
                    <PlusCircle size={14} />
                    Añadir Músico
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {musicians.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-3 p-3 bg-ink/5 rounded-xl group">
                      <div className="flex-grow grid grid-cols-2 gap-2">
                        <input 
                          value={m.name}
                          onChange={(e) => {
                            const newMusicians = [...musicians];
                            newMusicians[idx].name = e.target.value;
                            setMusicians(newMusicians);
                          }}
                          className="bg-paper border-none rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-gold"
                          placeholder="Nombre"
                          list="musician-name-list"
                        />
                        <input 
                          value={m.instrument}
                          onChange={(e) => {
                            const newMusicians = [...musicians];
                            newMusicians[idx].instrument = e.target.value;
                            setMusicians(newMusicians);
                          }}
                          className="bg-paper border-none rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-gold"
                          placeholder="Instrumento"
                          list="instrument-list"
                        />
                      </div>
                      <button 
                        type="button"
                        onClick={() => setMusicians(musicians.filter((_, i) => i !== idx))}
                        className="text-ink/20 hover:text-red-500 transition-colors"
                      >
                        <MinusCircle size={16} />
                      </button>
                    </div>
                  ))}
                  <datalist id="musician-name-list">
                    {Array.from(new Set(allAlbums.flatMap(a => a.musicians || []).map(m => m.name).filter(Boolean))).map(v => <option key={v} value={v} />)}
                  </datalist>
                  <datalist id="instrument-list">
                    {Array.from(new Set(allAlbums.flatMap(a => a.musicians || []).map(m => m.instrument).filter(Boolean))).map(v => <option key={v} value={v} />)}
                  </datalist>
                </div>
              </div>
            )}

            {/* Section: Cover Image */}
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-gold">
                <Upload size={18} />
                <h3 className="text-xs font-bold uppercase tracking-[0.2em]">Portada del Álbum</h3>
              </div>
              
              <div className="flex gap-6 items-start">
                <div className="flex-grow space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">URL de la Imagen</label>
                    <div className="flex gap-4">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline cursor-pointer flex items-center gap-1">
                        <Upload size={12} />
                        <span>{uploading ? `Subiendo (${Math.round(uploadProgress)}%)` : 'Subir Archivo'}</span>
                        <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" disabled={uploading} />
                      </label>
                      <button 
                        type="button"
                        onClick={() => setImageUrl(`https://picsum.photos/seed/${encodeURIComponent(title || 'album')}/800/800`)}
                        className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline"
                      >
                        Generar Aleatoria
                      </button>
                    </div>
                  </div>
                  <input 
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                    placeholder="https://..."
                  />
                  {imageUrl && !imageUrl.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i) && (
                    <button 
                      type="button"
                      onClick={resolveImage}
                      disabled={resolving}
                      className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline flex items-center gap-1"
                    >
                      {resolving ? 'Resolviendo...' : 'Obtener imagen de este sitio'}
                    </button>
                  )}
                </div>
                {imageUrl && (
                  <div className="w-32 h-32 rounded-2xl overflow-hidden bg-ink/5 flex-shrink-0 border border-ink/10 shadow-lg">
                    <img src={imageUrl} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  </div>
                )}
              </div>
            </div>

            {/* Section: Tracks / Works */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gold">
                  <Music2 size={18} />
                  <h3 className="text-xs font-bold uppercase tracking-[0.2em]">
                    {genre === 'classical' ? 'Jerarquía: Disco → Obra → Movimiento' : 'Lista de Temas'}
                  </h3>
                </div>
                {genre === 'classical' ? (
                  <button 
                    type="button"
                    onClick={() => setDiscs([...discs, { discNumber: discs.length + 1, works: [] }])}
                    className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline flex items-center gap-1"
                  >
                    <PlusCircle size={14} />
                    Añadir Disco
                  </button>
                ) : (
                  <button 
                    type="button"
                    onClick={() => setTracks([...tracks, { trackNumber: tracks.length + 1, title: '', duration: '', side: 'A' }])}
                    className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline flex items-center gap-1"
                  >
                    <PlusCircle size={14} />
                    Añadir Tema
                  </button>
                )}
              </div>
              
              {genre === 'classical' ? (
                <div className="space-y-8">
                  {discs.map((disc, dIdx) => (
                    <div key={dIdx} className="p-3 sm:p-6 bg-ink/5 rounded-2xl sm:rounded-3xl border border-ink/10 space-y-6 relative">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex flex-col min-[430px]:flex-row min-w-0 gap-3 sm:gap-4">
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Disco</label>
                            <input 
                              type="number"
                              value={disc.discNumber}
                              onChange={(e) => {
                                const newDiscs = structuredClone(discs);
                                newDiscs[dIdx].discNumber = parseInt(e.target.value);
                                setDiscs(newDiscs);
                              }}
                              className="w-16 bg-paper border-none rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-gold"
                            />
                          </div>
                          <input 
                            value={disc.title || ''}
                            onChange={(e) => {
                              const newDiscs = structuredClone(discs);
                              newDiscs[dIdx].title = e.target.value;
                              setDiscs(newDiscs);
                            }}
                            className="min-w-0 w-full sm:w-auto bg-paper border-none rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-gold"
                            placeholder="Título del Disco (opcional)"
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <button 
                            type="button"
                            onClick={() => {
                              const newDiscs = structuredClone(discs);
                              newDiscs[dIdx].works.push({ title: '', movements: [] });
                              setDiscs(newDiscs);
                            }}
                            className="text-[10px] uppercase tracking-widest font-bold text-gold hover:underline flex items-center gap-1"
                          >
                            <PlusCircle size={14} />
                            Añadir Obra
                          </button>
                          <button 
                            type="button"
                            onClick={() => setDiscs(discs.filter((_, i) => i !== dIdx))}
                            className="text-ink/20 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-6 pl-4 border-l-2 border-gold/20">
                        {disc.works.map((work, wIdx) => (
                          <div key={wIdx} className="p-4 bg-paper rounded-2xl shadow-sm space-y-4 relative group/work">
                            <button 
                              type="button"
                              onClick={() => {
                                const newDiscs = structuredClone(discs);
                                newDiscs[dIdx].works = newDiscs[dIdx].works.filter((_, i) => i !== wIdx);
                                setDiscs(newDiscs);
                              }}
                              className="absolute top-2 right-2 text-ink/10 hover:text-red-500 opacity-0 group-hover/work:opacity-100 transition-all"
                            >
                              <X size={16} />
                            </button>
                            
                            <div className="grid grid-cols-1 gap-4">
                              <div className="space-y-2">
                                <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Título de la Obra (Sonata, Sinfonía, etc.)</label>
                                <input 
                                  value={work.title}
                                  onChange={(e) => {
                                    const newDiscs = structuredClone(discs);
                                    newDiscs[dIdx].works[wIdx].title = e.target.value;
                                    setDiscs(newDiscs);
                                  }}
                                  className="w-full bg-ink/5 border-none rounded-xl px-4 py-2 text-sm font-medium focus:ring-2 focus:ring-gold"
                                  placeholder="Ej. Sonata para piano No. 14 'Claro de Luna'"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Orquesta</label>
                                <input 
                                  value={work.orchestra || ''}
                                  onChange={(e) => {
                                    const newDiscs = structuredClone(discs);
                                    newDiscs[dIdx].works[wIdx].orchestra = e.target.value;
                                    setDiscs(newDiscs);
                                  }}
                                  className="w-full bg-ink/5 border-none rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-gold"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Director</label>
                                <input 
                                  value={work.conductor || ''}
                                  onChange={(e) => {
                                    const newDiscs = structuredClone(discs);
                                    newDiscs[dIdx].works[wIdx].conductor = e.target.value;
                                    setDiscs(newDiscs);
                                  }}
                                  className="w-full bg-ink/5 border-none rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-gold"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Lugar de Composición</label>
                                <input 
                                  value={work.compositionPlace || ''}
                                  onChange={(e) => {
                                    const newDiscs = structuredClone(discs);
                                    newDiscs[dIdx].works[wIdx].compositionPlace = e.target.value;
                                    setDiscs(newDiscs);
                                  }}
                                  className="w-full bg-ink/5 border-none rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-gold"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Fecha de Composición</label>
                                <input 
                                  value={work.compositionDate || ''}
                                  onChange={(e) => {
                                    const newDiscs = structuredClone(discs);
                                    newDiscs[dIdx].works[wIdx].compositionDate = e.target.value;
                                    setDiscs(newDiscs);
                                  }}
                                  className="w-full bg-ink/5 border-none rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-gold"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Fundador</label>
                                <input 
                                  value={work.founderName || ''}
                                  onChange={(e) => {
                                    const newDiscs = structuredClone(discs);
                                    newDiscs[dIdx].works[wIdx].founderName = e.target.value;
                                    setDiscs(newDiscs);
                                  }}
                                  className="w-full bg-ink/5 border-none rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-gold"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Maestro de Coro</label>
                                <input 
                                  value={work.choirMaster || ''}
                                  onChange={(e) => {
                                    const newDiscs = structuredClone(discs);
                                    newDiscs[dIdx].works[wIdx].choirMaster = e.target.value;
                                    setDiscs(newDiscs);
                                  }}
                                  className="w-full bg-ink/5 border-none rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-gold"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="space-y-2">
                                <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Lugar de Fundación</label>
                                <input 
                                  value={work.foundationPlace || ''}
                                  onChange={(e) => {
                                    const newDiscs = structuredClone(discs);
                                    newDiscs[dIdx].works[wIdx].foundationPlace = e.target.value;
                                    setDiscs(newDiscs);
                                  }}
                                  className="w-full bg-ink/5 border-none rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-gold"
                                />
                              </div>
                              <div className="space-y-2">
                                <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Fecha de Fundación</label>
                                <input 
                                  value={work.foundationDate || ''}
                                  onChange={(e) => {
                                    const newDiscs = structuredClone(discs);
                                    newDiscs[dIdx].works[wIdx].foundationDate = e.target.value;
                                    setDiscs(newDiscs);
                                  }}
                                  className="w-full bg-ink/5 border-none rounded-xl px-3 py-2 text-xs focus:ring-2 focus:ring-gold"
                                />
                              </div>
                            </div>

                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Solistas</label>
                                <button 
                                  type="button"
                                  onClick={() => {
                                    const newDiscs = structuredClone(discs);
                                    if (!newDiscs[dIdx].works[wIdx].soloists) newDiscs[dIdx].works[wIdx].soloists = [];
                                    newDiscs[dIdx].works[wIdx].soloists!.push({ name: '', instrument: '', birthDate: '', birthPlace: '', deathDate: '', deathPlace: '' });
                                    setDiscs(newDiscs);
                                  }}
                                  className="text-[8px] uppercase tracking-widest font-bold text-gold hover:underline flex items-center gap-1"
                                >
                                  <PlusCircle size={12} />
                                  Añadir Solista
                                </button>
                              </div>
                              <div className="space-y-4">
                                {(work.soloists || []).map((s, sIdx) => (
                                  <div key={sIdx} className="p-3 bg-ink/5 rounded-xl space-y-3 relative group/soloist">
                                    <button 
                                      type="button"
                                      onClick={() => {
                                        const newDiscs = structuredClone(discs);
                                        newDiscs[dIdx].works[wIdx].soloists = newDiscs[dIdx].works[wIdx].soloists!.filter((_, i) => i !== sIdx);
                                        setDiscs(newDiscs);
                                      }}
                                      className="absolute top-2 right-2 text-ink/10 hover:text-red-500 opacity-0 group-hover/soloist:opacity-100 transition-all"
                                    >
                                      <X size={14} />
                                    </button>
                                    <div className="grid grid-cols-2 gap-2">
                                      <input 
                                        value={s.name}
                                        onChange={(e) => {
                                          const newDiscs = structuredClone(discs);
                                          newDiscs[dIdx].works[wIdx].soloists![sIdx].name = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="bg-paper border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                        placeholder="Nombre"
                                      />
                                      <input 
                                        value={s.instrument}
                                        onChange={(e) => {
                                          const newDiscs = structuredClone(discs);
                                          newDiscs[dIdx].works[wIdx].soloists![sIdx].instrument = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="bg-paper border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                        placeholder="Instrumento"
                                      />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <input 
                                        value={s.birthDate || ''}
                                        onChange={(e) => {
                                          const newDiscs = structuredClone(discs);
                                          newDiscs[dIdx].works[wIdx].soloists![sIdx].birthDate = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="bg-paper border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                        placeholder="Fecha Nacimiento"
                                      />
                                      <input 
                                        value={s.birthPlace || ''}
                                        onChange={(e) => {
                                          const newDiscs = structuredClone(discs);
                                          newDiscs[dIdx].works[wIdx].soloists![sIdx].birthPlace = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="bg-paper border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                        placeholder="Lugar Nacimiento"
                                      />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <input 
                                        value={s.deathDate || ''}
                                        onChange={(e) => {
                                          const newDiscs = structuredClone(discs);
                                          newDiscs[dIdx].works[wIdx].soloists![sIdx].deathDate = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="bg-paper border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                        placeholder="Fecha Defunción"
                                      />
                                      <input 
                                        value={s.deathPlace || ''}
                                        onChange={(e) => {
                                          const newDiscs = structuredClone(discs);
                                          newDiscs[dIdx].works[wIdx].soloists![sIdx].deathPlace = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="bg-paper border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                        placeholder="Lugar Defunción"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Movimientos / Partes</label>
                                <button 
                                  type="button"
                                  onClick={() => {
                                    const newDiscs = structuredClone(discs);
                                    const trackNum = newDiscs[dIdx].works[wIdx].movements.length + 1;
                                    newDiscs[dIdx].works[wIdx].movements.push({ trackNumber: trackNum, title: '', duration: '' });
                                    setDiscs(newDiscs);
                                  }}
                                  className="text-[8px] uppercase tracking-widest font-bold text-gold hover:underline flex items-center gap-1"
                                >
                                  <PlusCircle size={10} />
                                  Añadir Movimiento
                                </button>
                              </div>
                              <div className="space-y-2">
                                {work.movements.map((mov, mIdx) => (
                                  <div key={mIdx} className="space-y-2">
                                    <div className="flex items-center gap-3 p-2 bg-ink/5 rounded-xl group/mov">
                                      <div className="w-6 text-center text-[10px] font-bold text-ink/20">{mov.trackNumber}</div>
                                      {formats.includes('Vinilo') && (
                                        <select 
                                          value={mov.side || 'A'}
                                          onChange={(e) => {
                                            const newDiscs = structuredClone(discs);
                                            newDiscs[dIdx].works[wIdx].movements[mIdx].side = e.target.value as 'A' | 'B';
                                            setDiscs(newDiscs);
                                          }}
                                          className="bg-paper border-none rounded-lg px-1 py-1 text-[9px] font-bold focus:ring-1 focus:ring-gold"
                                        >
                                          <option value="A">A</option>
                                          <option value="B">B</option>
                                        </select>
                                      )}
                                      <input 
                                        value={mov.title}
                                        onChange={(e) => {
                                          const newDiscs = structuredClone(discs);
                                          newDiscs[dIdx].works[wIdx].movements[mIdx].title = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="flex-grow bg-paper border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                        placeholder="Ej. I. Adagio sostenuto"
                                      />
                                      <input 
                                        value={mov.duration}
                                        onChange={(e) => {
                                          const newDiscs = structuredClone(discs);
                                          newDiscs[dIdx].works[wIdx].movements[mIdx].duration = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="w-16 bg-paper border-none rounded-lg px-2 py-1.5 text-xs text-center focus:ring-1 focus:ring-gold"
                                        placeholder="0:00"
                                      />
                                      <button 
                                        type="button"
                                        onClick={() => {
                                          const newDiscs = structuredClone(discs);
                                          newDiscs[dIdx].works[wIdx].movements = newDiscs[dIdx].works[wIdx].movements.filter((_, i) => i !== mIdx);
                                          setDiscs(newDiscs);
                                        }}
                                        className="text-ink/10 hover:text-red-500 opacity-0 group-hover/mov:opacity-100 transition-all"
                                      >
                                        <MinusCircle size={14} />
                                      </button>
                                    </div>

                                    {/* Classical Movement Details */}
                                    <div className="pl-10 space-y-4 pb-4 border-b border-ink/5">
                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                          <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Orquesta</label>
                                          <input 
                                            value={mov.orchestra || ''}
                                            onChange={(e) => {
                                              const newDiscs = structuredClone(discs);
                                              newDiscs[dIdx].works[wIdx].movements[mIdx].orchestra = e.target.value;
                                              setDiscs(newDiscs);
                                            }}
                                            className="w-full bg-ink/5 border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Director</label>
                                          <input 
                                            value={mov.conductor || ''}
                                            onChange={(e) => {
                                              const newDiscs = structuredClone(discs);
                                              newDiscs[dIdx].works[wIdx].movements[mIdx].conductor = e.target.value;
                                              setDiscs(newDiscs);
                                            }}
                                            className="w-full bg-ink/5 border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                          />
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                          <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Lugar de Composición</label>
                                          <input 
                                            value={mov.compositionPlace || ''}
                                            onChange={(e) => {
                                              const newDiscs = structuredClone(discs);
                                              newDiscs[dIdx].works[wIdx].movements[mIdx].compositionPlace = e.target.value;
                                              setDiscs(newDiscs);
                                            }}
                                            className="w-full bg-ink/5 border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Fecha de Composición</label>
                                          <input 
                                            value={mov.compositionDate || ''}
                                            onChange={(e) => {
                                              const newDiscs = structuredClone(discs);
                                              newDiscs[dIdx].works[wIdx].movements[mIdx].compositionDate = e.target.value;
                                              setDiscs(newDiscs);
                                            }}
                                            className="w-full bg-ink/5 border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                          />
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                          <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Fundador</label>
                                          <input 
                                            value={mov.founderName || ''}
                                            onChange={(e) => {
                                              const newDiscs = structuredClone(discs);
                                              newDiscs[dIdx].works[wIdx].movements[mIdx].founderName = e.target.value;
                                              setDiscs(newDiscs);
                                            }}
                                            className="w-full bg-ink/5 border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Maestro de Coro</label>
                                          <input 
                                            value={mov.choirMaster || ''}
                                            onChange={(e) => {
                                              const newDiscs = structuredClone(discs);
                                              newDiscs[dIdx].works[wIdx].movements[mIdx].choirMaster = e.target.value;
                                              setDiscs(newDiscs);
                                            }}
                                            className="w-full bg-ink/5 border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                          />
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                          <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Lugar de Fundación</label>
                                          <input 
                                            value={mov.foundationPlace || ''}
                                            onChange={(e) => {
                                              const newDiscs = structuredClone(discs);
                                              newDiscs[dIdx].works[wIdx].movements[mIdx].foundationPlace = e.target.value;
                                              setDiscs(newDiscs);
                                            }}
                                            className="w-full bg-ink/5 border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                          />
                                        </div>
                                        <div className="space-y-2">
                                          <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Fecha de Fundación</label>
                                          <input 
                                            value={mov.foundationDate || ''}
                                            onChange={(e) => {
                                              const newDiscs = structuredClone(discs);
                                              newDiscs[dIdx].works[wIdx].movements[mIdx].foundationDate = e.target.value;
                                              setDiscs(newDiscs);
                                            }}
                                            className="w-full bg-ink/5 border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                          />
                                        </div>
                                      </div>

                                      <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                          <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Solistas</label>
                                          <button 
                                            type="button"
                                            onClick={() => {
                                              const newDiscs = structuredClone(discs);
                                              if (!newDiscs[dIdx].works[wIdx].movements[mIdx].soloists) newDiscs[dIdx].works[wIdx].movements[mIdx].soloists = [];
                                              newDiscs[dIdx].works[wIdx].movements[mIdx].soloists!.push({ name: '', instrument: '', birthDate: '', birthPlace: '', deathDate: '', deathPlace: '' });
                                              setDiscs(newDiscs);
                                            }}
                                            className="text-[8px] uppercase tracking-widest font-bold text-gold hover:underline flex items-center gap-1"
                                          >
                                            <PlusCircle size={12} />
                                            Añadir Solista
                                          </button>
                                        </div>
                                        <div className="space-y-4">
                                          {(mov.soloists || []).map((s, sIdx) => (
                                            <div key={sIdx} className="p-3 bg-paper rounded-xl space-y-3 relative group/soloist">
                                              <button 
                                                type="button"
                                                onClick={() => {
                                                  const newDiscs = structuredClone(discs);
                                                  newDiscs[dIdx].works[wIdx].movements[mIdx].soloists = newDiscs[dIdx].works[wIdx].movements[mIdx].soloists!.filter((_, i) => i !== sIdx);
                                                  setDiscs(newDiscs);
                                                }}
                                                className="absolute top-2 right-2 text-ink/10 hover:text-red-500 opacity-0 group-hover/soloist:opacity-100 transition-all"
                                              >
                                                <X size={14} />
                                              </button>
                                              <div className="grid grid-cols-2 gap-2">
                                                <input 
                                                  value={s.name}
                                                  onChange={(e) => {
                                                    const newDiscs = structuredClone(discs);
                                                    newDiscs[dIdx].works[wIdx].movements[mIdx].soloists![sIdx].name = e.target.value;
                                                    setDiscs(newDiscs);
                                                  }}
                                                  className="bg-ink/5 border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                                  placeholder="Nombre"
                                                />
                                                <input 
                                                  value={s.instrument}
                                                  onChange={(e) => {
                                                    const newDiscs = structuredClone(discs);
                                                    newDiscs[dIdx].works[wIdx].movements[mIdx].soloists![sIdx].instrument = e.target.value;
                                                    setDiscs(newDiscs);
                                                  }}
                                                  className="bg-ink/5 border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                                  placeholder="Instrumento"
                                                />
                                              </div>
                                              <div className="grid grid-cols-2 gap-2">
                                                <input 
                                                  value={s.birthDate || ''}
                                                  onChange={(e) => {
                                                    const newDiscs = structuredClone(discs);
                                                    newDiscs[dIdx].works[wIdx].movements[mIdx].soloists![sIdx].birthDate = e.target.value;
                                                    setDiscs(newDiscs);
                                                  }}
                                                  className="bg-ink/5 border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                                  placeholder="Fecha Nacimiento"
                                                />
                                                <input 
                                                  value={s.birthPlace || ''}
                                                  onChange={(e) => {
                                                    const newDiscs = structuredClone(discs);
                                                    newDiscs[dIdx].works[wIdx].movements[mIdx].soloists![sIdx].birthPlace = e.target.value;
                                                    setDiscs(newDiscs);
                                                  }}
                                                  className="bg-ink/5 border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                                  placeholder="Lugar Nacimiento"
                                                />
                                              </div>
                                              <div className="grid grid-cols-2 gap-2">
                                                <input 
                                                  value={s.deathDate || ''}
                                                  onChange={(e) => {
                                                    const newDiscs = structuredClone(discs);
                                                    newDiscs[dIdx].works[wIdx].movements[mIdx].soloists![sIdx].deathDate = e.target.value;
                                                    setDiscs(newDiscs);
                                                  }}
                                                  className="bg-ink/5 border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                                  placeholder="Fecha Defunción"
                                                />
                                                <input 
                                                  value={s.deathPlace || ''}
                                                  onChange={(e) => {
                                                    const newDiscs = structuredClone(discs);
                                                    newDiscs[dIdx].works[wIdx].movements[mIdx].soloists![sIdx].deathPlace = e.target.value;
                                                    setDiscs(newDiscs);
                                                  }}
                                                  className="bg-ink/5 border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                                  placeholder="Lugar Defunción"
                                                />
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {discs.length === 0 && (
                    <p className="text-center py-8 text-ink/20 text-xs italic">No hay discos añadidos</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {tracks.map((t, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-4 bg-ink/5 rounded-2xl group">
                      <div className="w-8 text-center text-[10px] font-bold text-ink/30 mt-2">{t.trackNumber}</div>
                      <div className="flex-grow space-y-4">
                        <div className="flex gap-4 items-center">
                          <div className="flex items-center gap-2">
                            <label className="text-[9px] uppercase tracking-widest font-bold text-ink/30">Disco</label>
                            <input 
                              type="number"
                              min="1"
                              value={t.discNumber || 1}
                              onChange={(e) => {
                                const newTracks = [...tracks];
                                newTracks[idx].discNumber = parseInt(e.target.value);
                                setTracks(newTracks);
                              }}
                              className="w-12 bg-paper border-none rounded-lg px-2 py-1 text-[10px] font-bold focus:ring-1 focus:ring-gold h-10"
                            />
                          </div>
                          {formats.includes('Vinilo') && (
                            <select 
                              value={t.side || 'A'}
                              onChange={(e) => {
                                const newTracks = [...tracks];
                                newTracks[idx].side = e.target.value as 'A' | 'B';
                                setTracks(newTracks);
                              }}
                              className="bg-paper border-none rounded-lg px-2 py-1 text-[10px] font-bold focus:ring-1 focus:ring-gold h-10"
                            >
                              <option value="A">Lado A</option>
                              <option value="B">Lado B</option>
                            </select>
                          )}
                          <input 
                            value={t.title}
                            onChange={(e) => {
                              const newTracks = [...tracks];
                              newTracks[idx].title = e.target.value;
                              setTracks(newTracks);
                            }}
                            className="flex-grow bg-paper border-none rounded-xl px-4 py-2 text-sm focus:ring-1 focus:ring-gold transition-all"
                            placeholder="Título del tema"
                          />
                          <input 
                            value={t.duration}
                            onChange={(e) => {
                              const newTracks = [...tracks];
                              newTracks[idx].duration = e.target.value;
                              setTracks(newTracks);
                            }}
                            className="w-24 bg-paper border-none rounded-xl px-4 py-2 text-sm text-center focus:ring-1 focus:ring-gold transition-all"
                            placeholder="0:00"
                          />
                        </div>
                      </div>
                      <button 
                        type="button"
                        onClick={() => setTracks(tracks.filter((_, i) => i !== idx))}
                        className="text-ink/20 hover:text-red-500 transition-colors mt-2"
                      >
                        <MinusCircle size={18} />
                      </button>
                    </div>
                  ))}
                  {tracks.length === 0 && (
                    <p className="text-center py-8 text-ink/20 text-xs italic">No hay temas añadidos</p>
                  )}
                </div>
              )}
            </div>

            {/* Section: Composition, Recording & Edition Details (Classical Order) */}
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-gold">
                <Settings size={18} />
                <h3 className="text-xs font-bold uppercase tracking-[0.2em]">Detalles de Composición, Grabación y Edición</h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {genre === 'classical' && (
                  <>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Lugar de Composición</label>
                      <input 
                        value={compositionPlace}
                        onChange={(e) => setCompositionPlace(e.target.value)}
                        className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                        placeholder="Lugar de composición"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Fecha de Composición</label>
                      <input 
                        value={compositionDate}
                        onChange={(e) => setCompositionDate(e.target.value)}
                        className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                        placeholder="Fecha de composición"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Orquesta/s (Álbum)</label>
                      <input 
                        value={orchestra}
                        onChange={(e) => setOrchestra(e.target.value)}
                        className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                        placeholder="Orquesta(s)"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Director (Álbum)</label>
                      <input 
                        value={conductor}
                        onChange={(e) => setConductor(e.target.value)}
                        className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                        placeholder="Director"
                      />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Fecha y Lugar de Grabación</label>
                  <div className="flex gap-2">
                    <input 
                      value={recordingDates}
                      onChange={(e) => setRecordingDates(e.target.value)}
                      className="w-1/2 bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                      placeholder="Fecha"
                    />
                    <input 
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="w-1/2 bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                      placeholder="Lugar / Estudio"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Sello Original</label>
                  <input 
                    value={originalLabel}
                    onChange={(e) => setOriginalLabel(e.target.value)}
                    className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                    placeholder="Sello Original"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Número Original de Catálogo</label>
                  <input 
                    value={originalCatalogNumber}
                    onChange={(e) => setOriginalCatalogNumber(e.target.value)}
                    className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                    placeholder="Nº Catálogo Original"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Año Original</label>
                  <input 
                    value={originalYear}
                    onChange={(e) => setOriginalYear(e.target.value)}
                    className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                    placeholder="Ej. 1959"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Sello Editor</label>
                  {discogsLabelOptions.length > 1 && (
                    <select aria-label="Selecciona el sello de tu edición" value={discogsLabelOptions.includes(label) ? label : ''}
                      onChange={event => setLabel(event.target.value)}
                      className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold">
                      <option value="">Selecciona el sello correcto...</option>
                      {discogsLabelOptions.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  )}
                  <input 
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                    placeholder="Ej. Deutsche Grammophon"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">
                    Nº de Catálogo del Sello Editor
                  </label>

                  {/* Toggle: catalog number vs barcode */}
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setDiscogsSearchMode('catno')}
                      className={cn("px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-colors", discogsSearchMode === 'catno' ? "bg-ink text-paper" : "border border-ink/15 text-ink/50 hover:border-ink/30")}
                    >
                      Nº Catálogo
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscogsSearchMode('barcode')}
                      className={cn("px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest transition-colors", discogsSearchMode === 'barcode' ? "bg-ink text-paper" : "border border-ink/15 text-ink/50 hover:border-ink/30")}
                    >
                      Código de barras
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    {discogsSearchMode === 'catno' ? (
                      <input
                        value={catalogNumber}
                        onChange={(e) => setCatalogNumber(e.target.value)}
                        className="flex-1 bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                        placeholder="Ej. 415 123-2"
                      />
                    ) : (
                      <input
                        value={barcodeNumber}
                        onChange={(e) => setBarcodeNumber(e.target.value)}
                        className="flex-1 bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                        placeholder="Ej. 028941512321"
                      />
                    )}

                    <button
                      type="button"
                      onClick={handleFetchFromDiscogs}
                      disabled={(discogsSearchMode === 'catno' ? !catalogNumber.trim() : !barcodeNumber.trim()) || isFetchingDiscogs}
                      className="px-4 py-3 rounded-xl text-sm font-medium border border-ink/15 hover:bg-ink hover:text-paper transition disabled:opacity-50"
                    >
                      {isFetchingDiscogs ? "Buscando..." : "Buscar en Discogs"}
                    </button>
                  </div>

                  {discogsPreview && (
                    <section className="mt-4 rounded-2xl border border-gold/30 bg-gold/[0.06] p-4 space-y-4">
                      <div className="flex flex-wrap justify-between items-start gap-3">
                        <div>
                          <h4 className="font-serif text-xl">Revisar datos de Discogs</h4>
                          <p className="text-xs text-ink/60 mt-1">
                            No se ha cambiado nada en el álbum. Marca solamente los datos que quieras copiar
                            y edítalos aquí antes de aplicarlos.
                          </p>
                        </div>
                        <button type="button" onClick={()=>{setDiscogsPreview(null);setDiscogsChoices({});}}
                          className="text-xs underline text-ink/60">Descartar propuesta</button>
                      </div>
                      {discogsPreview.candidates.length>0 && (
                        <label className="block space-y-1">
                          <span className="text-xs font-semibold text-ink/60">Edición exacta de Discogs</span>
                          <select value={discogsPreview.releaseId||''} disabled={discogsReleaseLoading}
                            onChange={event=>selectDiscogsRelease(event.target.value)}
                            className="w-full min-w-0 rounded-xl border border-ink/10 bg-white px-3 py-3 text-sm">
                            <option value="">Selecciona la edición...</option>
                            {discogsPreview.candidates.map(item=>(
                              <option key={item.id} value={item.id}>
                                {item.title} · {item.year||'s/f'} · {item.labels.join(', ')} · {item.catno} · {item.formats.join('/')}
                              </option>
                            ))}
                          </select>
                          {discogsReleaseLoading && <span className="text-xs text-ink/50">Cargando edición...</span>}
                        </label>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {DISCOGS_EDIT_FIELDS.map(field=>(
                          <div key={field.key} className="rounded-xl border border-ink/10 bg-white p-3 space-y-2 min-w-0">
                            <label className="flex items-center gap-2 text-xs font-semibold">
                              <input type="checkbox" checked={Boolean(discogsChoices[field.key])}
                                onChange={event=>setDiscogsChoices(current=>({...current,[field.key]:event.target.checked}))}/>
                              {field.label}
                            </label>
                            <input value={discogsPreview.fields[field.key]}
                              aria-label={'Valor de Discogs: '+field.label}
                              onChange={event=>setDiscogsPreview(current=>current?{
                                ...current,fields:{...current.fields,[field.key]:event.target.value}}:current)}
                              className="w-full min-w-0 rounded-lg bg-ink/[0.035] px-3 py-2 text-sm"/>
                          </div>
                        ))}
                        <div className="rounded-xl border border-ink/10 bg-white p-3 space-y-2">
                          <label className="flex gap-2 items-center text-xs font-semibold">
                            <input type="checkbox" checked={Boolean(discogsChoices.formats)}
                              onChange={event=>setDiscogsChoices(current=>({...current,formats:event.target.checked}))}/>
                            Formato de esta edición
                          </label>
                          <select value={discogsPreview.formats[0]||''}
                            onChange={event=>setDiscogsPreview(current=>current?{
                              ...current,formats:event.target.value?[event.target.value as 'CD'|'Vinilo'|'DVD'|'Bluray']:[]}:current)}
                            className="w-full rounded-lg bg-ink/[0.035] p-2 text-sm">
                            <option value="">Sin identificar</option>
                            <option value="CD">CD</option>
                            <option value="Vinilo">Vinilo</option>
                            <option value="DVD">DVD</option>
                            <option value="Bluray">Bluray</option>
                          </select>
                        </div>
                        <div className="rounded-xl border border-ink/10 bg-white p-3 space-y-2">
                          <label className="flex gap-2 items-center text-xs font-semibold">
                            <input type="checkbox" checked={Boolean(discogsChoices.discCount)}
                              onChange={event=>setDiscogsChoices(current=>({...current,discCount:event.target.checked}))}/>
                            Cantidad de discos
                          </label>
                          <input type="number" min="1" value={discogsPreview.discCount}
                            onChange={event=>setDiscogsPreview(current=>current?{
                              ...current,discCount:Math.max(1,Number(event.target.value)||1)}:current)}
                            className="w-full rounded-lg bg-ink/[0.035] p-2 text-sm"/>
                        </div>
                      </div>
                      <div className="flex flex-col gap-3 rounded-xl bg-white p-3">
                        <label className="flex gap-2 items-center text-sm">
                          <input type="checkbox" checked={Boolean(discogsChoices.tracklist)}
                            onChange={event=>setDiscogsChoices(current=>({...current,tracklist:event.target.checked}))}/>
                          Copiar lista de pistas / obras ({genre==='classical'?discogsPreview.discs.length:discogsPreview.tracks.length})
                        </label>
                        <label className="flex gap-2 items-center text-sm">
                          <input type="checkbox" checked={Boolean(discogsChoices.artists)}
                            onChange={event=>setDiscogsChoices(current=>({...current,artists:event.target.checked}))}/>
                          Vincular artistas detectados ({discogsPreview.artistNames.length})
                        </label>
                      </div>
                      <p className="text-xs text-ink/60">
                        <strong>Sello Editor</strong> = sello de esta copia. <strong>Sello Original</strong> = primera edición histórica:
                        Discogs no lo cambiará ni lo deducirá automáticamente.
                      </p>
                      {discogsReviewError&&<p role="alert" className="text-sm text-red-600">{discogsReviewError}</p>}
                      <button type="button" onClick={applySelectedDiscogsFields} disabled={discogsReleaseLoading||
                        !Object.values(discogsChoices).some(Boolean)}
                        className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">
                        Aplicar sólo los campos marcados
                      </button>
                    </section>
                  )}
                  {discogsUrl && (
                    <p className="text-xs text-ink/50">
                      Datos de Discogs.{" "}
                      <a
                        href={discogsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        Ver release
                      </a>
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Año de Edición</label>
                  <input 
                    value={editionDate}
                    onChange={(e) => setEditionDate(e.target.value)}
                    className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                    placeholder="Ej. 1985"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">País de Edición</label>
                  <input 
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full bg-ink/5 border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-gold transition-all"
                    placeholder="Ej. Alemania"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Formatos y Cantidad</label>
                  <div className="flex flex-wrap gap-2 p-2 bg-ink/5 rounded-xl">
                    {['CD', 'Vinilo', 'DVD', 'Bluray'].map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => {
                          if (formats.includes(f as any)) {
                            setFormats(formats.filter(item => item !== f));
                          } else {
                            setFormats([...formats, f as any]);
                          }
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                          formats.includes(f as any) 
                            ? "bg-gold text-paper shadow-sm" 
                            : "bg-paper text-ink/40 hover:bg-gold/10"
                        )}
                      >
                        {f}
                      </button>
                    ))}
                    <div className="flex items-center gap-2 ml-auto">
                      <span className="text-[9px] font-bold text-ink/30">Cant:</span>
                      <input 
                        type="number"
                        min="1"
                        value={discCount}
                        onChange={(e) => setDiscCount(parseInt(e.target.value))}
                        className="w-12 bg-paper border-none rounded-lg px-2 py-1 text-[10px] font-bold focus:ring-1 focus:ring-gold"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Anecdotes */}
            <div className="space-y-6 pb-10">
              <div className="flex items-center gap-2 text-gold">
                <FileText size={18} />
                <h3 className="text-xs font-bold uppercase tracking-[0.2em]">Anécdotas y Comentarios</h3>
              </div>
              <textarea 
                value={anecdotes}
                onChange={(e) => setAnecdotes(e.target.value)}
                className="w-full bg-ink/5 border-none rounded-2xl px-4 py-4 h-32 focus:ring-2 focus:ring-gold transition-all resize-none text-sm"
                placeholder="Escribe aquí historias, anécdotas o detalles curiosos sobre la grabación..."
              />
            </div>
          </div>

          <div className="mobile-dialog-footer sticky bottom-0 bg-paper px-4 sm:px-8 py-3 sm:py-6 border-t border-ink/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
            {albumSaveError && (
              <p role="alert" className="w-full text-sm font-medium text-red-600 break-words">{albumSaveError}</p>
            )}
            {album && (
              <div className="flex items-center gap-4">
                {isConfirmingDelete ? (
                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                    <span className="text-xs font-bold text-red-500 uppercase tracking-widest">¿Confirmar?</span>
                    <button 
                      type="button"
                      onClick={handleDelete}
                      disabled={saving}
                      className="px-3 py-1 bg-red-500 text-white rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-red-600 transition-colors"
                    >
                      Sí, Eliminar
                    </button>
                    <button 
                      type="button"
                      onClick={() => setIsConfirmingDelete(false)}
                      className="px-3 py-1 bg-ink/5 text-ink/40 rounded-full text-[10px] font-bold uppercase tracking-widest hover:bg-ink/10 transition-colors"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button 
                    type="button"
                    onClick={() => setIsConfirmingDelete(true)}
                    className="flex items-center gap-2 text-red-500 text-sm font-bold uppercase tracking-widest hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={18} />
                    <span>Eliminar</span>
                  </button>
                )}
              </div>
            )}
            <div className="flex gap-4 ml-auto">
              <button 
                type="button"
                onClick={onClose}
                className="px-6 py-3 text-sm font-bold uppercase tracking-widest text-ink/40 hover:text-ink transition-colors"
              >
                Cancelar
              </button>
              <button 
                disabled={saving}
                type="submit"
                className="flex items-center gap-2 px-8 py-3 bg-ink text-paper rounded-full text-sm font-medium hover:bg-gold transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Save size={18} />
                <span>{saving ? 'Guardando...' : (album ? 'Guardar Cambios' : 'Añadir Álbum')}</span>
              </button>
            </div>
          </div>
        </form>
        </motion.div>
        
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<any, any> {
  state: any = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-paper">
          <div className="max-w-md w-full bg-white p-8 rounded-3xl shadow-xl space-y-6 text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <Info size={32} />
            </div>
            <h2 className="font-serif text-3xl italic">Algo salió mal</h2>
            <p className="text-sm text-ink/60">
              {this.state.error?.message?.startsWith('{') 
                ? "Hubo un problema con la base de datos. Por favor, verifica tu conexión o permisos."
                : "Ha ocurrido un error inesperado en la aplicación."}
            </p>
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-ink text-paper rounded-full text-sm font-medium hover:bg-gold transition-colors"
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

// --- Main App ---

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

// --- Auth Context ---
// This client-side gate is for UX; Firestore and Storage security rules must
// also be deployed to prevent direct access to private catalog data.
const ALLOWED_EMAILS = new Set([
  'debbiebli262@gmail.com',
  'javierblinder@yahoo.com.ar',
]);

interface AuthContextType {
  user: User | null;
  loading: boolean;
  canAccess: boolean;
  login: () => Promise<void>;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => onAuthStateChanged(auth, (currentUser) => {
    setUser(currentUser);
    setLoading(false);
  }), []);

  const canAccess = Boolean(user?.emailVerified &&
    ALLOWED_EMAILS.has(user.email?.trim().toLowerCase() || ''));

  const login = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  };

  const loginWithPassword = async (email: string, password: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!ALLOWED_EMAILS.has(normalizedEmail)) {
      throw new Error('Esta cuenta no tiene acceso a la biblioteca.');
    }
    // Existing Firebase users only; there is intentionally no registration UI.
    await signInWithEmailAndPassword(auth, normalizedEmail, password);
  };

  const logout = async () => { await signOut(auth); };

  return (
    <AuthContext.Provider value={{ user, loading, canAccess, login, loginWithPassword, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

function PrivateAccessGate({ children }: { children: ReactNode }) {
  const { user, loading, canAccess, login, loginWithPassword, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  if (loading) return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-paper text-ink/60">
      Cargando biblioteca...
    </div>
  );

  if (canAccess) return <>{children}</>;

  const performLogin = async (action: () => Promise<void>) => {
    setLoginError('');
    setSigningIn(true);
    try { await action(); }
    catch (error) {
      console.error('Sign-in error:', error);
      const code = (error && typeof error === 'object' && 'code' in error)
        ? String(error.code) : '';
      const messages: Record<string, string> = {
        'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes e inténtalo otra vez.',
        'auth/popup-closed-by-user': 'La ventana de Google se cerró antes de terminar.',
        'auth/cancelled-popup-request': 'El intento de acceso fue cancelado. Inténtalo de nuevo.',
        'auth/unauthorized-domain': 'El dominio del sitio no está autorizado en Firebase. Añádelo a Authentication → Settings → Authorized domains.',
        'auth/operation-not-allowed': 'Google no está habilitado en Firebase. Actívalo en Authentication → Sign-in method.',
        'auth/account-exists-with-different-credential': 'Ya existe una cuenta con ese correo y otro método de acceso.',
        'auth/network-request-failed': 'No se pudo conectar a Firebase. Comprueba Internet.',
        'auth/invalid-credential': 'Las credenciales no son válidas.',
        'auth/invalid-email': 'El correo no es válido.',
        'auth/invalid-login-credentials': 'El correo o la contraseña son incorrectos.',
        'auth/wrong-password': 'La contraseña es incorrecta.',
        'auth/user-not-found': 'Esa cuenta no existe en Firebase Authentication.',
        'auth/too-many-requests': 'Demasiados intentos. Prueba más tarde.'
      };
      setLoginError(messages[code] || `No se pudo iniciar sesión${code ? ` (${code})` : ''}. Inténtalo de nuevo.`);
    } finally { setSigningIn(false); }
  };

  return (
    <div className="min-h-[100dvh] bg-paper flex flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-xl border border-ink/10 p-6 sm:p-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-full bg-ink text-paper flex items-center justify-center">
            <Music size={27} />
          </div>
          <h1 className="font-serif text-3xl">Música Elegante</h1>
          <p className="text-sm text-ink/60">Biblioteca privada. Acceso exclusivo para las dos cuentas autorizadas.</p>
        </div>
        {user && !canAccess && (
          <div className="rounded-xl bg-ink/5 p-4 text-sm space-y-3">
            <p>La cuenta {user.email || 'actual'} no está autorizada o su correo aún no está verificado.</p>
            <button type="button" className="underline text-gold" onClick={() => void logout()}>
              Salir y cambiar de cuenta
            </button>
          </div>
        )}
        {!user && (
          <>
            <button type="button" disabled={signingIn}
              onClick={() => void performLogin(login)}
              className="w-full rounded-xl bg-ink py-3 px-4 text-paper font-medium disabled:opacity-50">
              Entrar con Google
            </button>
            <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-ink/40">
              <div className="h-px bg-ink/10 flex-1" />o con correo y contraseña<div className="h-px bg-ink/10 flex-1" />
            </div>
            <form className="space-y-3" onSubmit={event => {
              event.preventDefault();
              void performLogin(() => loginWithPassword(email, password));
            }}>
              <input type="email" autoComplete="username" required placeholder="Correo electrónico"
                value={email} onChange={e => setEmail(e.target.value)}
                className="w-full rounded-xl bg-ink/5 px-4 py-3 text-base" />
              <input type="password" autoComplete="current-password" required placeholder="Contraseña"
                value={password} onChange={e => setPassword(e.target.value)}
                className="w-full rounded-xl bg-ink/5 px-4 py-3 text-base" />
              <button type="submit" disabled={signingIn}
                className="w-full border border-ink/20 rounded-xl py-3 font-medium disabled:opacity-50">
                Entrar con correo
              </button>
            </form>
          </>
        )}
        {loginError && <p role="alert" className="text-red-700 text-sm">{loginError}</p>}
        <p className="text-xs text-ink/50 text-center">No hay registro público. Para usar correo y contraseña, la cuenta debe existir en Firebase Authentication.</p>
      </div>
    </div>
  );
}

function MainLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-grow">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/jazz" element={<GenrePage genre="jazz" />} />
          <Route path="/classical" element={<GenrePage genre="classical" />} />
          <Route path="/artist/:id" element={<ArtistDetail />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/imports" element={<ImportWordPage />} />
          <Route path="/discogs" element={<DiscogsImportPage />} />
          <Route path="/collection" element={<CollectionPage />} />
        </Routes>
      </main>
      <Footer />
      {/* Seed data is never injected into a live collection automatically. */}
      {/* Destructive duplicate cleanup is intentionally disabled. Editions may share titles. */}
    </div>
  );
}


export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <ScrollToTop />
          <PrivateAccessGate><MainLayout /></PrivateAccessGate>
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}
