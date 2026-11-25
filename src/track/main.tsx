// Página pública do cliente: entrada Vite separada (track.html). Sem router, sem TanStack Query,
// sem nenhum módulo da área /app → bundle mínimo para 3G. O mapa (MapLibre) é carregado a seguir.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles.css';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { TrackApp } from './TrackApp';

createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><TrackApp /></ErrorBoundary></StrictMode>);
