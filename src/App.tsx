import React, { useState, useEffect, createContext, useContext, ReactNode, useCallback, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Link, useLocation, useParams, useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, where, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, getDocFromServer, getDocs } from 'firebase/firestore';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { ref, uploadString, getDownloadURL, uploadBytes } from 'firebase/storage';
import imageCompression from 'browser-image-compression';
import { db, storage, auth } from './firebase';
import { Artist, Album, CollectionItem, Genre, Musician, Track, Disc, Work, Movement } from './types';
import { OperationType, handleFirestoreError, getArtistByName, saveArtistData } from './firestoreUtils';
import { fetchArtistDiscography } from './services/discographyService';
import { fetchArtistMetadata } from './services/artistService';
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
  format?: string;
  editionYear?: string;
  country?: string;
  notes?: string;
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
  albums?: Partial<Album>[];
  notes?: string[];
  // Actual server response fields
  composer?: ServerComposer;
  recordings?: ServerRecording[];
  warnings?: string[];
  sourceFileName?: string;
}

interface ImportJobRecord {
  id: string;
  fileName: string;
  createdAt?: string;
  status: ImportStatus;
  extractedData?: ParsedWordImport;
  approvedAt?: string;
  source?: string;
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, login: handleLogin, logout: handleLogout } = useAuth();

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const navItems = [
    { name: 'Inicio', path: '/' },
    { name: 'Jazz', path: '/jazz' },
    { name: 'Clásica', path: '/classical' },
    { name: 'Mi Colección', path: '/collection' },
  ];

  return (
    <nav className="sticky top-0 z-50 bg-paper/90 backdrop-blur-md border-b border-ink/10 px-4 md:px-6 py-4">
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

        <button
          type="button"
          onClick={user ? handleLogout : handleLogin}
          className="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-full bg-ink text-paper text-sm hover:bg-gold transition-colors"
        >
          {user ? 'Salir' : 'Login'}
        </button>
        
        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-full border border-ink/10 bg-paper text-ink hover:text-gold transition-colors"
          aria-label="Abrir menú"
          aria-expanded={mobileMenuOpen}
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
            className="md:hidden max-w-7xl mx-auto mt-4 rounded-3xl border border-ink/10 bg-paper shadow-xl overflow-hidden"
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

<ArtistAnniversaries artists={artists} />
    </div>
  );
}

function ArtistAnniversaries({ artists }: { artists: Artist[] }) {
  const today = new Date();
  const monthDay = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  const anniversaries = artists.filter(artist => {
    const isBirth = artist.birthDate?.endsWith(monthDay);
    const isDeath = artist.deathDate?.endsWith(monthDay);
    return isBirth || isDeath;
  });

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
    <div className="max-w-7xl mx-auto px-6 py-20 space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-4">
          <span className="text-xs uppercase tracking-widest font-bold text-gold">Explorar Género</span>
          <h1 className="font-serif text-6xl md:text-8xl capitalize">{genre === 'classical' ? 'Música Clásica' : genre}</h1>
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
            onClick={() => setSortBy(sortBy === 'name' ? 'none' : 'name')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all border",
              sortBy === 'name' ? "bg-gold/10 border-gold text-gold" : "border-ink/10 text-ink/40 hover:border-ink/20"
            )}
          >
            <ArrowDownAZ size={16} />
            <span>A-Z</span>
          </button>
          <button 
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-6 py-3 bg-ink text-paper rounded-full text-sm font-medium hover:bg-gold transition-colors"
          >
            <Plus size={18} />
            <span>Añadir Artista</span>
          </button>
        </div>
      </div>

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
  if (viewMode === 'list') {
    return (
      <Link to={`/artist/${artist.id}`} className="group flex items-center gap-6 p-4 rounded-2xl hover:bg-ink/5 transition-colors">
        <div className="w-16 h-16 rounded-xl overflow-hidden bg-ink/5 flex-shrink-0">
          {artist.imageUrl ? (
            <img 
              src={artist.imageUrl} 
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
        {artist.imageUrl ? (
          <img 
            src={artist.imageUrl} 
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

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  return (
    <div className="space-y-20 pb-20">
      <section className="relative h-[60vh] flex items-end px-6 pb-12 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            src={artist.imageUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=1920'}
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
            <h1 className="font-serif text-6xl md:text-8xl tracking-tight">
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

      <section className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-3 gap-20">
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

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-8">
              {albums.map((album) => (
                <div key={album.id}>
                  <AlbumCard album={album} />
                </div>
              ))}

              {albums.length === 0 && (
                <p className="col-span-full text-ink/40 font-serif italic">
                  No hay álbumes principales registrados.
                </p>
              )}
            </div>
          </div>

          {sidemanAlbums.length > 0 && (
            <div className="space-y-8">
              <h2 className="text-xs uppercase tracking-widest font-bold text-gold">
                Colaboraciones (Sideman)
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-8">
                {sidemanAlbums.map((album) => (
                  <div key={album.id}>
                    <AlbumCard album={album} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {sharedAlbums.length > 0 && (
            <div className="space-y-8">
              <h2 className="text-xs uppercase tracking-widest font-bold text-gold">
                Álbumes Compartidos
              </h2>
              <p className="text-sm text-ink/50 -mt-4">
                Estos discos incluyen grabaciones de varios artistas. Las grabaciones de {artist?.name} están destacadas en dorado.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-8">
                {sharedAlbums.map((album) => (
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
              src={artist.imageUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=1000'}
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
        className="group flex items-center gap-6 p-4 rounded-2xl hover:bg-ink/5 transition-colors cursor-pointer"
      >
        <div className="w-16 h-16 rounded-xl overflow-hidden bg-ink/5 flex-shrink-0 shadow-sm">
          {album.imageUrl ? (
            <img 
              src={album.imageUrl} 
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
          <h3 className="font-serif text-xl group-hover:text-gold transition-colors truncate">{album.title}</h3>
          <p className="text-[10px] uppercase tracking-widest text-ink/40 font-bold truncate">
            {artistName}{album.releaseYear && ` • ${album.releaseYear}`}{album.label && ` • ${album.label}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
    <div className="group space-y-3">
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
        
        <div className="absolute top-2 right-2 flex flex-col gap-2 translate-x-12 group-hover:translate-x-0 transition-transform duration-300">
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
      <div className="space-y-1 cursor-pointer" onClick={() => setIsViewing(true)}>
        <h4 className="font-serif text-lg leading-tight group-hover:text-gold transition-colors">{album.title}</h4>
        <div className="flex justify-between items-center">
          <p className="text-[10px] uppercase tracking-widest text-ink/60 font-bold truncate flex-1 mr-2">{artistName}</p>
          <p className="text-[10px] uppercase tracking-widest text-ink/40 font-bold whitespace-nowrap">
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
  const isActive = currentStatus === status;

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
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

function SeedButton() {
  const [loading, setLoading] = useState(false);
  const { isAdmin } = useAuth();

  if (!isAdmin) return null;

  const seed = async () => {
    setLoading(true);
    try {
      for (const data of SEED_DATA) {
        const artistId = slugifyArtistId(data.artist.name || 'artist');
        await setDoc(doc(db, 'artists', artistId), data.artist, { merge: true });
        for (const albumData of data.albums) {
          await addDoc(collection(db, 'albums'), { ...albumData, artistId, artistName: data.artist.name });
        }
      }
      alert('Datos iniciales cargados con éxito.');
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button 
      onClick={seed}
      disabled={loading}
      className="fixed bottom-4 right-4 p-2 bg-gold text-white rounded-full shadow-lg z-[200] hover:scale-110 transition-transform"
      title="Cargar datos iniciales (Solo Admin)"
    >
      <Plus size={20} />
    </button>
  );
}

function CleanupButton() {
  const [loading, setLoading] = useState(false);
  const { isAdmin } = useAuth();

  if (!isAdmin) return null;

  const cleanup = async () => {
    setLoading(true);
    try {
      // Cleanup Artists
      const artistsSnapshot = await getDocs(collection(db, 'artists'));
      const artists = artistsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Artist));
      const artistGroups: { [key: string]: string[] } = {};

      artists.forEach(artist => {
        const key = `${artist.name.toLowerCase().trim()}_${artist.genre}`;
        if (!artistGroups[key]) {
          artistGroups[key] = [];
        }
        artistGroups[key].push(artist.id);
      });

      for (const key in artistGroups) {
        const ids = artistGroups[key];
        if (ids.length > 1) {
          // Keep the first one, delete the rest
          for (let i = 1; i < ids.length; i++) {
            await deleteDoc(doc(db, 'artists', ids[i]));
          }
        }
      }

      // Cleanup Albums
      const albumsSnapshot = await getDocs(collection(db, 'albums'));
      const albums = albumsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Album));
      const albumGroups: { [key: string]: string[] } = {};

      albums.forEach(album => {
        const key = `${album.title.toLowerCase().trim()}_${album.artistId}`;
        if (!albumGroups[key]) {
          albumGroups[key] = [];
        }
        albumGroups[key].push(album.id);
      });

      for (const key in albumGroups) {
        const ids = albumGroups[key];
        if (ids.length > 1) {
          // Keep the first one, delete the rest
          for (let i = 1; i < ids.length; i++) {
            await deleteDoc(doc(db, 'albums', ids[i]));
          }
        }
      }

      alert('Duplicados eliminados correctamente.');
    } catch (error) {
      console.error('Error al limpiar duplicados:', error);
      alert('Error al limpiar duplicados.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button 
      onClick={cleanup}
      disabled={loading}
      className="fixed bottom-4 right-16 p-2 bg-red-500 text-white rounded-full shadow-lg z-[200] hover:scale-110 transition-transform disabled:opacity-50"
      title="Limpiar Duplicados"
    >
      <Trash2 size={20} />
    </button>
  );
}


function SearchPage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<'year' | 'artist' | 'title' | 'label'>('year');
  const [genreFilter, setGenreFilter] = useState<'all' | Genre>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    const q = query(collection(db, 'albums'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAlbums(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Album)));
    });
    return unsubscribe;
  }, []);

  const normalizedQuery = searchText.trim().toLowerCase();

  const filteredAlbums = [...albums]
    .filter((album) => {
      if (genreFilter !== 'all' && album.genre !== genreFilter) return false;
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
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return searchableValues.includes(normalizedQuery);
    })
    .sort((a, b) => {
      if (sortBy === 'year') return Number(a.releaseYear || 0) - Number(b.releaseYear || 0);
      if (sortBy === 'artist') return String(a.artistName || '').localeCompare(String(b.artistName || ''));
      if (sortBy === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
      return String(a.label || '').localeCompare(String(b.label || ''));
    });

  return (
    <div className="max-w-7xl mx-auto px-6 py-16 md:py-20 space-y-10">
      <div className="space-y-4">
        <span className="text-xs uppercase tracking-widest font-bold text-gold">Búsqueda avanzada</span>
        <h1 className="font-serif text-5xl md:text-7xl leading-tight">Buscar grabaciones</h1>
        <p className="text-ink/65 max-w-3xl leading-relaxed">
          Localiza registros por artista, título, sello, número de catálogo, año, personal artístico y otros metadatos presentes en tu catálogo.
        </p>
      </div>

      <div className="rounded-3xl border border-ink/10 bg-white p-5 md:p-6 shadow-sm space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-[1.5fr,0.75fr,0.75fr] gap-4">
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

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-ink/50">
            {filteredAlbums.length} resultado{filteredAlbums.length === 1 ? '' : 's'}
          </p>
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
            <AlbumCard key={album.id} album={album} viewMode="grid" />
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

async function uploadWordDocument(file: File): Promise<ParsedWordImport> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/import-word', {
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
  const [parsedData, setParsedData] = useState<ParsedWordImport | null>(null);
  const [recentImports, setRecentImports] = useState<ImportJobRecord[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [message, setMessage] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [importGenreSelection, setImportGenreSelection] = useState<Genre>('classical');

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
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setParsedData(null);
    setMessage('');
  };

  const handleProcessFile = async () => {
    if (!selectedFile) {
      setMessage('Selecciona un archivo .docx antes de continuar.');
      return;
    }

    setIsUploading(true);
    setMessage('');

    try {
      const result = await uploadWordDocument(selectedFile);
      setParsedData(result);
      setMessage('Archivo procesado. Revisa los datos antes de guardarlos.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo procesar el archivo.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedFile || !parsedData) return;

    setIsSavingDraft(true);
    setMessage('');

    try {
      const uploadedFile = await uploadWordFileToStorage(selectedFile);

      await addDoc(collection(db, 'import_jobs'), {
        fileName: selectedFile.name,
        createdAt: new Date().toISOString(),
        status: 'draft',
        source: 'word_upload',
        fileUrl: uploadedFile.downloadURL,
        storagePath: uploadedFile.storagePath,
        extractedData: parsedData,
      });

      setMessage('Importación guardada como borrador en Firebase.');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'import_jobs');
      setMessage('No se pudo guardar la importación como borrador en Firebase.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleApproveAndSave = async () => {
    if (!selectedFile || !parsedData) return;

    setIsApproving(true);
    setMessage('');

    try {
      // The server returns { composer, recordings, albums }
      // We use composer for artist data, and recordings as the source of album entries
      const composerData = parsedData.composer;
      const recordingsData = parsedData.recordings || [];
      let artistId = '';

      if (composerData?.name) {
        artistId = slugifyArtistId(composerData.name);
        await setDoc(
          doc(db, 'artists', artistId),
          {
            id: artistId,
            name: composerData.name,
            biography: composerData.biography || '',
            genre: importGenre,
            birthDate: composerData.birthDate || '',
            birthPlace: composerData.birthPlace || '',
            deathDate: composerData.deathDate || '',
            deathPlace: composerData.deathPlace || '',
            imageUrl: '',
            instruments: [],
            periods: [],
          },
          { merge: true }
        );
      }

      // Convert each recording entry into an album document
      const importGenre: Genre = importGenreSelection;
      const skippedAlbums: string[] = [];
      const savedAlbums: string[] = [];

      for (const rec of recordingsData) {
        const finalArtistName = composerData?.name || 'unknown_artist';
        const finalTitle = rec.albumTitle || rec.workTitle || 'Untitled import';

        const albumId = slugifyAlbumId(
          finalArtistName,
          finalTitle,
          rec.editionYear,
          rec.catalogNumber
        );

        // Check if this album already exists in Firebase
        const existingDoc = await getDoc(doc(db, 'albums', albumId));
        if (existingDoc.exists()) {
          skippedAlbums.push(finalTitle);
          continue;
        }

        // Also check by title+artistId to catch albums created with addDoc (auto-ID)
        const duplicateQuery = query(
          collection(db, 'albums'),
          where('artistId', '==', artistId),
          where('title', '==', finalTitle)
        );
        const duplicateSnapshot = await getDocs(duplicateQuery);
        if (!duplicateSnapshot.empty) {
          skippedAlbums.push(finalTitle);
          continue;
        }

        savedAlbums.push(finalTitle);

        await setDoc(
          doc(db, 'albums', albumId),
          {
            id: albumId,
            artistId: artistId,
            artistName: finalArtistName,
            title: finalTitle,
            genre: importGenre,
            releaseYear: rec.editionYear || '',
            recordingDates: rec.recordingDate || '',
            location: rec.recordingLocation || '',
            label: rec.label || '',
            catalogNumber: rec.catalogNumber || '',
            formats: rec.format ? [rec.format] : [],
            orchestra: rec.orchestra || '',
            conductor: rec.conductor || '',
            soloists: (rec.soloists || []).map((s: string) => ({ name: s, instrument: '' })),
            compositionDate: rec.compositionDate || '',
            country: rec.country || '',
            musicians: (rec.performers || []).map((p: string) => ({ name: p, instrument: '' })),
            tracks: [],
            discs: [],
            anecdotes: rec.notes || '',
            imageUrl: '',
            availability: '',
          },
          { merge: true }
        );
      }

      const uploadedFile = await uploadWordFileToStorage(selectedFile);

      await addDoc(collection(db, 'import_jobs'), {
        fileName: selectedFile.name,
        createdAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
        status: 'approved',
        source: 'word_upload',
        fileUrl: uploadedFile.downloadURL,
        storagePath: uploadedFile.storagePath,
        extractedData: parsedData,
      });

      let resultMessage = '';
      if (savedAlbums.length > 0) {
        resultMessage += `✓ ${savedAlbums.length} grabación(es) guardada(s) en Firebase.`;
      }
      if (skippedAlbums.length > 0) {
        resultMessage += `\n⚠ ${skippedAlbums.length} grabación(es) omitida(s) porque ya existían: ${skippedAlbums.join(', ')}.`;
      }
      if (savedAlbums.length === 0 && skippedAlbums.length === 0) {
        resultMessage = 'No se encontraron grabaciones para guardar.';
      }
      setMessage(resultMessage);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'artists/albums/import_jobs');
      setMessage('No se pudieron guardar los datos aprobados en Firebase.');
    } finally {
      setIsApproving(false);
    }
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
        <div className="rounded-3xl border border-ink/10 bg-white p-6 md:p-8 shadow-sm space-y-6">
          <div className="space-y-2">
            <h2 className="font-serif text-3xl">1. Seleccionar archivo</h2>
            <p className="text-sm text-ink/60 leading-relaxed">
              Usa archivos .docx bien estructurados. Cuanto más claro esté el documento, mejor será la extracción.
            </p>
          </div>

          <label className="block rounded-2xl border border-dashed border-ink/20 bg-ink/[0.03] p-6 hover:border-gold/50 transition-colors">
            <input type="file" accept=".doc,.docx" className="hidden" onChange={handleFileChange} />
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-ink text-paper flex items-center justify-center">
                <Upload size={20} />
              </div>
              <div>
                <p className="font-medium text-ink">{selectedFile ? selectedFile.name : 'Haz clic para elegir un archivo Word'}</p>
                <p className="text-sm text-ink/50">Formato admitido: .doc y .docx</p>
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
              disabled={!selectedFile || isUploading}
              className="px-6 py-3 rounded-full bg-ink text-paper text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gold transition-colors"
            >
              {isUploading ? 'Procesando…' : 'Procesar con AI'}
            </button>

            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={!parsedData || isSavingDraft}
              className="px-6 py-3 rounded-full border border-ink/15 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ink hover:text-paper transition-colors"
            >
              {isSavingDraft ? 'Guardando…' : 'Guardar borrador'}
            </button>

            <button
              type="button"
              onClick={handleApproveAndSave}
              disabled={!parsedData || isApproving}
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
                  <div className="rounded-2xl bg-ink/[0.03] p-4 text-sm">
                    <span className="text-ink/45">Biografía</span>
                    <p className="mt-2 leading-relaxed text-ink/75">{extractedArtist?.biography || '—'}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="text-xs uppercase tracking-widest font-bold text-gold">Álbumes / grabaciones</h3>
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
                    <div className={cn(
                      'inline-flex items-center rounded-full px-3 py-1 text-xs uppercase tracking-widest font-bold',
                      job.status === 'approved' ? 'bg-gold/15 text-gold' : job.status === 'failed' ? 'bg-red-100 text-red-600' : 'bg-ink/5 text-ink/60'
                    )}>
                      {job.status}
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
    { label: 'Sello discográfico', getValue: (a: Album) => a.label || '—' },
    { label: 'Número de catálogo', getValue: (a: Album) => a.catalogNumber || '—' },
    { label: 'Sello original', getValue: (a: Album) => a.originalLabel || '—' },
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

      setItems(enrichedItems);
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
        <div className={cn(
          "grid gap-8",
          viewMode === 'grid' ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : "grid-cols-1"
        )}>
          {owned.map(item => (
            <div key={item.id}>
              <AlbumCard album={item.album} viewMode={viewMode} />
            </div>
          ))}
          {owned.length === 0 && (
            <div className="col-span-full py-20 text-center border-2 border-dashed border-ink/10 rounded-3xl">
              <p className="text-ink/40 font-serif italic text-xl">Tu colección está vacía. ¡Empieza a añadir tus tesoros!</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-12">
        <div className="flex items-center justify-between border-b border-ink/10 pb-6">
          <h2 className="font-serif text-4xl italic">Lista de Deseos <span className="text-xl font-sans not-italic text-ink/40 ml-2">({wishlist.length})</span></h2>
        </div>
        <div className={cn(
          "grid gap-8",
          viewMode === 'grid' ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" : "grid-cols-1"
        )}>
          {wishlist.map(item => (
            <div key={item.id}>
              <AlbumCard album={item.album} viewMode={viewMode} />
            </div>
          ))}
          {wishlist.length === 0 && (
            <div className="col-span-full py-20 text-center border-2 border-dashed border-ink/10 rounded-3xl">
              <p className="text-ink/40 font-serif italic text-xl">No tienes deseos pendientes. ¿Qué será lo próximo?</p>
            </div>
          )}
        </div>
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

const handleFetchFromDiscogs = async () => {
  if (!catalogNumber.trim()) {
    alert("Introduce un número de catálogo primero.");
    return;
  }

  setIsFetchingDiscogs(true);

  try {
    const response = await fetch(
      `/api/discogs-search-by-catalog?catno=${encodeURIComponent(catalogNumber)}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error || "No se pudo buscar en Discogs.");
    }

    if (data.title) setTitle(data.title);
    if (data.artist) setArtistName(data.artist);
    if (data.year) {
      const yearText = String(data.year);
      setReleaseYear(yearText);
      setEditionDate((current) => current || yearText);
    }
    if (data.country) setCountry(data.country);
    if (data.label) {
      setLabel(data.label);
      setOriginalLabel((current) => current || data.label);
    }
    if (data.catno) {
      setCatalogNumber(data.catno);
      setEditionCatalogNumber((current) => current || data.catno);
    }

    if (data.originalLabel) setOriginalLabel(data.originalLabel);
    if (data.originalCatalogNumber) setOriginalCatalogNumber(data.originalCatalogNumber);
    if (data.originalYear) setOriginalYear(String(data.originalYear));
    if (data.recordingDate) setRecordingDates(data.recordingDate);
    if (data.recordingLocation) setLocation(data.recordingLocation);
    if (data.orchestra) setOrchestra(data.orchestra);
    if (data.conductor) setConductor(data.conductor);
    if (data.producer) setProducer(data.producer);
    if (data.engineer) setEngineer(data.engineer);
    if (data.masteringEngineer) setMasteringEngineer(data.masteringEngineer);
    if (data.compositionDate) setCompositionDate(data.compositionDate);
    if (data.compositionPlace) setCompositionPlace(data.compositionPlace);

    if (typeof data.discCount === "number" && data.discCount > 0) {
      setDiscCount(data.discCount);
    }

    if (data.format) {
      const normalizedFormats = String(data.format)
        .split(",")
        .map((item: string) => item.trim())
        .filter(Boolean)
        .map((item: string) => {
          const lower = item.toLowerCase();
          if (lower.includes("cd")) return "CD";
          if (lower.includes("vinyl") || lower.includes("lp")) return "Vinilo";
          if (lower.includes("dvd")) return "DVD";
          if (lower.includes("blu-ray") || lower.includes("bluray")) return "Bluray";
          return null;
        })
        .filter(Boolean) as ("CD" | "Vinilo" | "DVD" | "Bluray")[];

      if (normalizedFormats.length) {
        setFormats([...new Set(normalizedFormats)]);
      }
    }

    if (data.coverImage || data.thumb) {
      setImageUrl(data.coverImage || data.thumb);
    }

    if (data.discogsUrl) {
      setDiscogsUrl(data.discogsUrl);
    }

    if (genre === "classical") {
      if (Array.isArray(data.discs) && data.discs.length > 0) {
        setDiscs(data.discs);
      } else if (Array.isArray(data.rawTracklist) && data.rawTracklist.length > 0) {
        setDiscs([
          {
            discNumber: 1,
            works: [
              {
                title: "Tracklist",
                movements: data.rawTracklist
                  .filter((item: any) => item?.title && item?.type_ !== "heading")
                  .map((item: any, index: number) => ({
                    trackNumber: index + 1,
                    title: item.title,
                    duration: item.duration || "",
                  })),
              },
            ],
          },
        ]);
      }
    } else {
      if (Array.isArray(data.tracks) && data.tracks.length > 0) {
        setTracks(data.tracks);
      } else if (Array.isArray(data.rawTracklist) && data.rawTracklist.length > 0) {
        setTracks(
          data.rawTracklist
            .filter((item: any) => item?.title && item?.type_ !== "heading")
            .map((item: any, index: number) => ({
              trackNumber: index + 1,
              title: item.title,
              duration: item.duration || "",
            }))
        );
      }
    }

    alert("Datos cargados desde Discogs.");
  } catch (error: any) {
    console.error("Discogs fetch error:", error);
    alert(error.message || "No se pudo obtener información desde Discogs.");
  } finally {
    setIsFetchingDiscogs(false);
  }
};

  const resolveImage = async () => {
    if (!imageUrl || imageUrl.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) return;
    setResolving(true);
    try {
      const response = await fetch(`/api/resolve-image?url=${encodeURIComponent(imageUrl)}`);
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
  const buildAlbumDataForArtist = (targetArtistId: string, targetArtistName: string) => ({
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
    label,
    catalogNumber,
    originalCatalogNumber,
    editionCatalogNumber,
    editionDate,
    country,
    originalLabel,
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
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
        className="relative w-full max-w-2xl max-h-[90vh] bg-paper rounded-3xl shadow-2xl overflow-y-auto"
      >
        <div className="px-8 py-6 border-b border-ink/10 flex items-center justify-between">
          <h2 className="font-serif text-3xl italic">{artist ? 'Editar Artista' : 'Nuevo Artista'}</h2>
          <button onClick={onClose} className="text-ink/40 hover:text-ink transition-colors"><X size={24} /></button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-8 space-y-6">
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
  const [artistName, setArtistName] = useState<string>(album.artistName || '');

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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
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
        className="relative w-full max-w-5xl max-h-[90vh] bg-paper rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row"
      >
        {/* Left Side: Cover & Basic Info */}
        <div className="w-full md:w-2/5 bg-ink/5 p-8 flex flex-col gap-8 overflow-y-auto border-r border-ink/10 shrink-0">
          <div className="aspect-square rounded-2xl overflow-hidden shadow-2xl bg-ink/10">
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
              <h2 className="font-serif text-4xl leading-tight">{album.title}</h2>
              <p className="text-gold font-bold uppercase tracking-widest text-sm">{artistName}</p>
            </div>
            
            <div className="grid grid-cols-2 gap-4 pt-4">
              {album.releaseYear && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Lanzamiento</span>
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
                  <p className="text-sm font-medium">{album.originalLabel}</p>
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
                  <p className="text-sm font-medium">{album.label}</p>
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
        <div className="flex-1 overflow-y-auto p-10 space-y-12">
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
              {album.originalLabel && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Sello Original</span>
                  <p className="text-sm">{album.originalLabel}</p>
                </div>
              )}
              {album.originalYear && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Año Original</span>
                  <p className="text-sm">{album.originalYear}</p>
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
                      <div className="space-y-6 pl-4">
                        {disc.works.map((work, wIdx) => {
                        const isHighlighted = highlightArtistId && Array.isArray((work as any).trackArtists) && (work as any).trackArtists.includes(highlightArtistId);
                        return (
                          <div key={wIdx} className={cn("space-y-3 rounded-xl p-3 -mx-3 transition-colors", isHighlighted ? "bg-gold/10 border border-gold/30" : "")}>
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
                                  <div className="flex items-center gap-4 p-2 hover:bg-ink/5 rounded-lg transition-colors group">
                                    <span className="w-6 text-center text-[10px] font-bold text-ink/20 group-hover:text-gold">{mov.trackNumber}</span>
                                    {mov.side && <span className="text-[10px] font-bold text-gold/60 w-4">{mov.side}</span>}
                                    <span className="flex-grow text-xs text-ink/70">{mov.title}</span>
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
  const [imageUrl, setImageUrl] = useState(album?.imageUrl || '');
  const [resolving, setResolving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [sidemenIds, setSidemenIds] = useState<string[]>(album?.sidemenIds || []);
  const [isFetchingDiscogs, setIsFetchingDiscogs] = useState(false);
  const [discogsSearchMode, setDiscogsSearchMode] = useState<'catno' | 'barcode'>('catno');
  const [barcodeNumber, setBarcodeNumber] = useState('');
  const [discogsUrl, setDiscogsUrl] = useState('');
  const [allArtistIds, setAllArtistIds] = useState<string[]>(album?.allArtistIds || []);
  const [artistName, setArtistName] = useState(album?.artistName || '');
  const [recordingDates, setRecordingDates] = useState(album?.recordingDates || '');
  const [releaseDate, setReleaseDate] = useState(album?.releaseDate || '');
  const [location, setLocation] = useState(album?.location || '');
  const [label, setLabel] = useState(album?.label || '');
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
  const [discCount, setDiscCount] = useState<number>(album?.discCount || 1);
  const [formats, setFormats] = useState<('CD' | 'Vinilo' | 'DVD' | 'Bluray')[]>(
    album?.formats || ((album as any)?.format ? [(album as any).format] : ['CD'])
  );
  const [orchestra, setOrchestra] = useState(album?.orchestra || '');
  const [conductor, setConductor] = useState(album?.conductor || '');
  const [compositionDate, setCompositionDate] = useState(album?.compositionDate || '');
  const [compositionPlace, setCompositionPlace] = useState(album?.compositionPlace || '');
  const [musicians, setMusicians] = useState<Musician[]>(album?.musicians || []);
  const [tracks, setTracks] = useState<Track[]>(album?.tracks || []);
  const [discs, setDiscs] = useState<Disc[]>(album?.discs || (genre === 'classical' ? [{ discNumber: 1, works: [] }] : []));
  const [anecdotes, setAnecdotes] = useState(album?.anecdotes || '');
  const [pendingComposers, setPendingComposers] = useState<string[]>([]);
  const [currentComposerIndex, setCurrentComposerIndex] = useState(0);
  const [composerData, setComposerData] = useState<any>(null);
  const [loadingComposer, setLoadingComposer] = useState(false);

  const [allArtists, setAllArtists] = useState<Artist[]>([]);
  const [allAlbums, setAllAlbums] = useState<Album[]>([]);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);

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

      const response = await fetch(`/api/discogs-search-by-catalog?${param}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo buscar en Discogs.');
      }

      if (data.title) setTitle(data.title);
      if (data.year) {
        const yearText = String(data.year);
        setReleaseYear(yearText);
        setEditionDate((current) => current || yearText);
      }
      if (data.country) setCountry(data.country);
      if (data.label) {
        setLabel(data.label);
        setOriginalLabel((current) => current || data.label);
      }
      if (data.catno) {
        setCatalogNumber(data.catno);
        setEditionCatalogNumber((current) => current || data.catno);
      }
      if (data.originalLabel) setOriginalLabel(data.originalLabel);
      if (data.originalCatalogNumber) setOriginalCatalogNumber(data.originalCatalogNumber);
      if (data.originalYear) setOriginalYear(String(data.originalYear));
      if (data.orchestra) setOrchestra(data.orchestra);
      if (data.conductor) setConductor(data.conductor);
      if (data.producer) setProducer(data.producer);
      if (data.engineer) setEngineer(data.engineer);
      if (data.masteringEngineer) setMasteringEngineer(data.masteringEngineer);

      if (typeof data.discCount === 'number' && data.discCount > 0) {
        setDiscCount(data.discCount);
      }

      if (data.format) {
        const normalizedFormats = String(data.format)
          .split(',')
          .map((item: string) => item.trim())
          .filter(Boolean)
          .map((item: string) => {
            const lower = item.toLowerCase();
            if (lower.includes('cd')) return 'CD';
            if (lower.includes('vinyl') || lower.includes('lp')) return 'Vinilo';
            if (lower.includes('dvd')) return 'DVD';
            if (lower.includes('blu-ray') || lower.includes('bluray')) return 'Bluray';
            return null;
          })
          .filter(Boolean) as ('CD' | 'Vinilo' | 'DVD' | 'Bluray')[];
        if (normalizedFormats.length) setFormats([...new Set(normalizedFormats)]);
      }

      if (data.coverImage || data.thumb) setImageUrl(data.coverImage || data.thumb);
      if (data.discogsUrl) setDiscogsUrl(data.discogsUrl);

      // Store all artist names from this release for multi-artist linking
      if (Array.isArray(data.allArtistNames) && data.allArtistNames.length > 0) {
        // We store names here; IDs will be resolved on save by looking up each name in Firestore
        (window as any).__discogsAllArtistNames = data.allArtistNames;
      }

      if (genre === 'classical') {
        if (Array.isArray(data.discs) && data.discs.length > 0) {
          setDiscs(data.discs);
        } else if (Array.isArray(data.rawTracklist) && data.rawTracklist.length > 0) {
          setDiscs([{
            discNumber: 1,
            works: [{
              title: 'Tracklist',
              movements: data.rawTracklist
                .filter((item: any) => item?.title && item?.type_ !== 'heading')
                .map((item: any, index: number) => ({
                  trackNumber: index + 1,
                  title: item.title,
                  duration: item.duration || '',
                })),
            }],
          }]);
        }
      } else {
        if (Array.isArray(data.tracks) && data.tracks.length > 0) {
          setTracks(data.tracks);
        } else if (Array.isArray(data.rawTracklist) && data.rawTracklist.length > 0) {
          setTracks(
            data.rawTracklist
              .filter((item: any) => item?.title && item?.type_ !== 'heading')
              .map((item: any, index: number) => ({
                trackNumber: index + 1,
                title: item.title,
                duration: item.duration || '',
              }))
          );
        }
      }

      const artistCount = Array.isArray(data.allArtistNames) ? data.allArtistNames.length : 0;
      const msg = artistCount > 1
        ? `Datos cargados. Este disco incluye ${artistCount} artistas: ${data.allArtistNames.join(', ')}. Al guardar, el álbum aparecerá en todos ellos.`
        : 'Datos cargados desde Discogs.';
      alert(msg);
    } catch (error: any) {
      console.error('Discogs fetch error:', error);
      alert(error.message || 'No se pudo obtener información desde Discogs.');
    } finally {
      setIsFetchingDiscogs(false);
    }
  };

  const resolveImage = async () => {
    if (!imageUrl || imageUrl.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) return;
    setResolving(true);
    try {
      const response = await fetch(`/api/resolve-image?url=${encodeURIComponent(imageUrl)}`);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { 
        title, 
        releaseYear, 
        imageUrl, 
        artistId, 
        genre, 
        sidemenIds,
        artistName,
        recordingDates,
        releaseDate,
        location,
        label,
        catalogNumber,
        originalCatalogNumber,
        editionCatalogNumber,
        editionDate,
        country,
        originalLabel,
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
        allArtistIds,
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
      alert('No se pudo guardar el álbum. Revisa la consola para ver el error exacto.');
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
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
        className="relative w-full max-w-3xl max-h-[90vh] bg-paper rounded-3xl shadow-2xl overflow-hidden flex flex-col"
      >
        <form onSubmit={handleSubmit} className="flex flex-col h-full overflow-hidden">
          <div className="px-8 py-6 border-b border-ink/10 flex items-center justify-between bg-paper shrink-0">
            <h2 className="font-serif text-3xl italic">{album ? 'Editar Álbum' : 'Nuevo Álbum'}</h2>
            <button type="button" onClick={onClose} className="text-ink/40 hover:text-ink transition-colors"><X size={24} /></button>
          </div>

          <div className="flex-grow overflow-y-auto p-8 space-y-10">
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
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Título del Álbum</label>
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

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Año de Lanzamiento</label>
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
                    <div key={dIdx} className="p-6 bg-ink/5 rounded-3xl border border-ink/10 space-y-6 relative">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] uppercase tracking-widest font-bold text-ink/40">Disco</label>
                            <input 
                              type="number"
                              value={disc.discNumber}
                              onChange={(e) => {
                                const newDiscs = [...discs];
                                newDiscs[dIdx].discNumber = parseInt(e.target.value);
                                setDiscs(newDiscs);
                              }}
                              className="w-16 bg-paper border-none rounded-xl px-3 py-2 text-sm font-bold focus:ring-2 focus:ring-gold"
                            />
                          </div>
                          <input 
                            value={disc.title || ''}
                            onChange={(e) => {
                              const newDiscs = [...discs];
                              newDiscs[dIdx].title = e.target.value;
                              setDiscs(newDiscs);
                            }}
                            className="bg-paper border-none rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-gold"
                            placeholder="Título del Disco (opcional)"
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <button 
                            type="button"
                            onClick={() => {
                              const newDiscs = [...discs];
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
                                const newDiscs = [...discs];
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
                                    const newDiscs = [...discs];
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
                                    const newDiscs = [...discs];
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
                                    const newDiscs = [...discs];
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
                                    const newDiscs = [...discs];
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
                                    const newDiscs = [...discs];
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
                                    const newDiscs = [...discs];
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
                                    const newDiscs = [...discs];
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
                                    const newDiscs = [...discs];
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
                                    const newDiscs = [...discs];
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
                                    const newDiscs = [...discs];
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
                                        const newDiscs = [...discs];
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
                                          const newDiscs = [...discs];
                                          newDiscs[dIdx].works[wIdx].soloists![sIdx].name = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="bg-paper border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                        placeholder="Nombre"
                                      />
                                      <input 
                                        value={s.instrument}
                                        onChange={(e) => {
                                          const newDiscs = [...discs];
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
                                          const newDiscs = [...discs];
                                          newDiscs[dIdx].works[wIdx].soloists![sIdx].birthDate = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="bg-paper border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                        placeholder="Fecha Nacimiento"
                                      />
                                      <input 
                                        value={s.birthPlace || ''}
                                        onChange={(e) => {
                                          const newDiscs = [...discs];
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
                                          const newDiscs = [...discs];
                                          newDiscs[dIdx].works[wIdx].soloists![sIdx].deathDate = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="bg-paper border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                        placeholder="Fecha Defunción"
                                      />
                                      <input 
                                        value={s.deathPlace || ''}
                                        onChange={(e) => {
                                          const newDiscs = [...discs];
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
                                    const newDiscs = [...discs];
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
                                            const newDiscs = [...discs];
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
                                          const newDiscs = [...discs];
                                          newDiscs[dIdx].works[wIdx].movements[mIdx].title = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="flex-grow bg-paper border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                        placeholder="Ej. I. Adagio sostenuto"
                                      />
                                      <input 
                                        value={mov.duration}
                                        onChange={(e) => {
                                          const newDiscs = [...discs];
                                          newDiscs[dIdx].works[wIdx].movements[mIdx].duration = e.target.value;
                                          setDiscs(newDiscs);
                                        }}
                                        className="w-16 bg-paper border-none rounded-lg px-2 py-1.5 text-xs text-center focus:ring-1 focus:ring-gold"
                                        placeholder="0:00"
                                      />
                                      <button 
                                        type="button"
                                        onClick={() => {
                                          const newDiscs = [...discs];
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
                                              const newDiscs = [...discs];
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
                                              const newDiscs = [...discs];
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
                                              const newDiscs = [...discs];
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
                                              const newDiscs = [...discs];
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
                                              const newDiscs = [...discs];
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
                                              const newDiscs = [...discs];
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
                                              const newDiscs = [...discs];
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
                                              const newDiscs = [...discs];
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
                                              const newDiscs = [...discs];
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
                                                  const newDiscs = [...discs];
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
                                                    const newDiscs = [...discs];
                                                    newDiscs[dIdx].works[wIdx].movements[mIdx].soloists![sIdx].name = e.target.value;
                                                    setDiscs(newDiscs);
                                                  }}
                                                  className="bg-ink/5 border-none rounded-lg px-3 py-1.5 text-xs focus:ring-1 focus:ring-gold"
                                                  placeholder="Nombre"
                                                />
                                                <input 
                                                  value={s.instrument}
                                                  onChange={(e) => {
                                                    const newDiscs = [...discs];
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
                                                    const newDiscs = [...discs];
                                                    newDiscs[dIdx].works[wIdx].movements[mIdx].soloists![sIdx].birthDate = e.target.value;
                                                    setDiscs(newDiscs);
                                                  }}
                                                  className="bg-ink/5 border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                                  placeholder="Fecha Nacimiento"
                                                />
                                                <input 
                                                  value={s.birthPlace || ''}
                                                  onChange={(e) => {
                                                    const newDiscs = [...discs];
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
                                                    const newDiscs = [...discs];
                                                    newDiscs[dIdx].works[wIdx].movements[mIdx].soloists![sIdx].deathDate = e.target.value;
                                                    setDiscs(newDiscs);
                                                  }}
                                                  className="bg-ink/5 border-none rounded-lg px-3 py-1.5 text-[10px] focus:ring-1 focus:ring-gold"
                                                  placeholder="Fecha Defunción"
                                                />
                                                <input 
                                                  value={s.deathPlace || ''}
                                                  onChange={(e) => {
                                                    const newDiscs = [...discs];
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

          <div className="sticky bottom-0 bg-paper px-8 py-6 border-t border-ink/10 flex items-center justify-between shrink-0">
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
interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const isAdmin = user?.email === "debbiebli262@gmail.com";

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login error:", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
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
          <Route path="/collection" element={<CollectionPage />} />
        </Routes>
      </main>
      <Footer />
      <SeedButton />
      <CleanupButton />
    </div>
  );
}


export default function App() {
  useEffect(() => {
    const migrateArtistDocumentIds = async () => {
      try {
        const artistsSnapshot = await getDocs(collection(db, 'artists'));
        const artists = artistsSnapshot.docs.map((artistDoc) => ({ id: artistDoc.id, ...artistDoc.data() } as Artist));

        for (const artist of artists) {
          const desiredId = slugifyArtistId(artist.name || '');
          if (!desiredId || artist.id === desiredId) continue;

          const targetRef = doc(db, 'artists', desiredId);
          const targetSnap = await getDoc(targetRef);

          if (!targetSnap.exists()) {
            const { id, ...artistData } = artist;
            await setDoc(targetRef, artistData, { merge: true });

            const albumsSnapshot = await getDocs(query(collection(db, 'albums'), where('artistId', '==', artist.id)));
            for (const albumDoc of albumsSnapshot.docs) {
              await updateDoc(doc(db, 'albums', albumDoc.id), {
                artistId: desiredId,
                artistName: artist.name || albumDoc.data().artistName || ''
              });
            }

            await deleteDoc(doc(db, 'artists', artist.id));
          }
        }
      } catch (error) {
        console.error('Artist ID migration failed:', error);
      }
    };

    migrateArtistDocumentIds();

    const autoCleanup = async () => {
      try {
        // Cleanup Artists
        const artistsSnapshot = await getDocs(collection(db, 'artists'));
        const artists = artistsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Artist));
        const artistGroups: { [key: string]: string[] } = {};
        artists.forEach(artist => {
          const key = `${artist.name.toLowerCase().trim()}_${artist.genre}`;
          if (!artistGroups[key]) artistGroups[key] = [];
          artistGroups[key].push(artist.id);
        });
        for (const key in artistGroups) {
          const ids = artistGroups[key];
          if (ids.length > 1) {
            for (let i = 1; i < ids.length; i++) await deleteDoc(doc(db, 'artists', ids[i]));
          }
        }

        // Cleanup Albums
        const albumsSnapshot = await getDocs(collection(db, 'albums'));
        const albums = albumsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Album));
        const albumGroups: { [key: string]: string[] } = {};
        albums.forEach(album => {
          const key = `${album.title.toLowerCase().trim()}_${album.artistId}`;
          if (!albumGroups[key]) albumGroups[key] = [];
          albumGroups[key].push(album.id);
        });
        for (const key in albumGroups) {
          const ids = albumGroups[key];
          if (ids.length > 1) {
            for (let i = 1; i < ids.length; i++) await deleteDoc(doc(db, 'albums', ids[i]));
          }
        }
      } catch (e) {
        console.error('Auto-cleanup failed:', e);
      }
    };
    autoCleanup();
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <ScrollToTop />
          <MainLayout />
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}
