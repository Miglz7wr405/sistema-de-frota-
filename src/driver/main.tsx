import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@/styles.css';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { DriverApp } from './DriverApp';

registerSW({ immediate: true }); // service worker: app funciona sem rede depois da 1.ª abertura
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><DriverApp /></ErrorBoundary></StrictMode>);
