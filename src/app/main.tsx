import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/styles.css';
import { Spinner } from '@/components/ui';
import { Landing } from './public/Landing';
import { Login, Register, Forgot, Reset, Invite } from './public/Auth';
import { AppLayout } from './AppLayout';
import { Terms, Privacy, NotFound } from './public/Legal';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

// Páginas da área privada carregadas sob pedido (a landing fica leve).
const Dashboard = lazy(() => import('@/features/dashboard/Dashboard'));
const LiveMap = lazy(() => import('@/features/tracking/LiveMap'));
const Trips = lazy(() => import('@/features/trips/TripsList'));
const TripForm = lazy(() => import('@/features/trips/TripForm'));
const TripDetail = lazy(() => import('@/features/trips/TripDetail'));
const Vehicles = lazy(() => import('@/features/vehicles/Vehicles'));
const VehicleDetail = lazy(() => import('@/features/vehicles/VehicleDetail'));
const Drivers = lazy(() => import('@/features/drivers/Drivers'));
const DriverDetail = lazy(() => import('@/features/drivers/DriverDetail'));
const Devices = lazy(() => import('@/features/devices/Devices'));
const Alerts = lazy(() => import('@/features/alerts/Alerts'));
const Costs = lazy(() => import('@/features/costs/Costs'));
const Reports = lazy(() => import('@/features/costs/Reports'));
const Distances = lazy(() => import('@/features/trips/Distances'));
const Settings = lazy(() => import('@/features/settings/Settings'));
const SelfTest = lazy(() => import('@/features/selftest/SelfTest'));
const Platform = lazy(() => import('@/features/platform/Platform'));

const qc = new QueryClient({
  defaultOptions: { queries: { retry: (n, e) => n < 2 && (e as { status?: number }).status !== 401 && (e as { status?: number }).status !== 403 && (e as { status?: number }).status !== 404, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ErrorBoundary>
        <Suspense fallback={<Spinner />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<Forgot />} />
            <Route path="/reset-password" element={<Reset />} />
            <Route path="/invite" element={<Invite />} />
            <Route path="/termos" element={<Terms />} />
            <Route path="/privacidade" element={<Privacy />} />
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="live-map" element={<LiveMap />} />
              <Route path="trips" element={<Trips />} />
              <Route path="trips/new" element={<TripForm />} />
              <Route path="trips/:id/edit" element={<TripForm />} />
              <Route path="trips/:id" element={<TripDetail />} />
              <Route path="vehicles" element={<Vehicles />} />
              <Route path="vehicles/:id" element={<VehicleDetail />} />
              <Route path="drivers" element={<Drivers />} />
              <Route path="drivers/:id" element={<DriverDetail />} />
              <Route path="devices" element={<Devices />} />
              <Route path="alerts" element={<Alerts />} />
              <Route path="costs" element={<Costs />} />
              <Route path="reports" element={<Reports />} />
              <Route path="distances" element={<Distances />} />
              <Route path="settings" element={<Settings />} />
              <Route path="self-test" element={<SelfTest />} />
              <Route path="*" element={<NotFound panel />} />
            </Route>
            <Route path="/platform" element={<AppLayout platform />}>
              <Route index element={<Platform />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
