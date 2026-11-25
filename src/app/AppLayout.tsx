import { autoOpenOnce, isPhone } from '@/features/trips/ownDriver';
import { Suspense, useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BarChart3, Cpu, Home, LogOut, Map, MapPin, Menu, Route as RouteIcon, Settings, Truck, Users, Wrench, X, Shield, Ruler } from 'lucide-react';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { cn } from '@/lib/cn';
import { Spinner, Select } from '@/components/ui';
import { useMe } from './session';

const NAV = [
  { to: '/app/dashboard', label: t.nav.dashboard, icon: Home },
  { to: '/app/live-map', label: t.nav.liveMap, icon: Map },
  { to: '/app/trips', label: t.nav.trips, icon: MapPin },
  { to: '/app/vehicles', label: t.nav.vehicles, icon: Truck },
  { to: '/app/drivers', label: t.nav.drivers, icon: Users },
  { to: '/app/alerts', label: t.nav.alerts, icon: Bell },
  { to: '/app/costs', label: t.nav.costs, icon: Wrench, costs: true },
  { to: '/app/reports', label: t.nav.reports, icon: BarChart3, costs: true },
  { to: '/app/distances', label: t.nav.distances, icon: Ruler },
  { to: '/app/devices', label: t.nav.devices, icon: Cpu },
  { to: '/app/settings', label: t.nav.settings, icon: Settings },
];
const MOBILE = ['/app/dashboard', '/app/live-map', '/app/trips', '/app/vehicles'];

export function AppLayout({ platform }: { platform?: boolean }) {
  const me = useMe();
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Entrar na app no telemóvel com uma viagem em curso em que o motorista é o próprio → o GPS liga-se sozinho (ecrã do motorista).
  // "Voltar ao painel" (?painel=1) deixa ficar no painel até fechar a app.
  useEffect(() => {
    if (new URLSearchParams(loc.search).get('painel') === '1') { try { sessionStorage.setItem('if_painel', '1'); } catch { /* */ } return; }
    let stay = false; try { stay = sessionStorage.getItem('if_painel') === '1'; } catch { /* */ }
    if (stay || !me.data?.activeOrgId || !isPhone()) return;
    api<{ id: string } | null>('/api/own-active-trip').then((t) => { if (t?.id) autoOpenOnce(t.id); }).catch(() => {});
  }, [me.data?.activeOrgId]);
  const notif = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number }>('/api/notifications'), refetchInterval: 30_000, enabled: !!me.data?.activeOrgId });

  if (me.isLoading) return <Spinner />;
  if (!me.data?.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (platform && !me.data.user.isPlatformAdmin) return <Navigate to="/app/dashboard" replace />;
  if (!platform && !me.data.activeOrgId) return <Navigate to="/register" replace />;
  const canCosts = me.data.role !== 'viewer';
  const items = NAV.filter((n) => !n.costs || canCosts);

  const logout = async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); qc.clear(); nav('/login'); };
  const switchOrg = async (orgId: string) => { await api('/api/auth/switch-org', { body: { orgId } }); qc.invalidateQueries(); nav('/app/dashboard'); };

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-4" aria-label={t.nav.mainLabel}>
      <div className="mb-6 flex items-center gap-2 px-2 text-xl font-bold text-white"><span className="rounded-lg bg-primary p-1.5"><Truck className="h-5 w-5" /></span><span>insight<span className="text-[#6EA8FF]">Frota</span></span></div>
      {items.map((n) => (
        <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)} className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] text-slate-200 hover:bg-white/10', isActive && 'bg-primary text-white hover:bg-primary')}>
          <n.icon className="h-5 w-5" aria-hidden />{n.label}
          {n.to === '/app/alerts' && (notif.data?.unread ?? 0) > 0 && <span className="ml-auto rounded-full bg-danger px-2 text-xs text-white">{notif.data!.unread}</span>}
        </NavLink>
      ))}
      {me.data.user.isPlatformAdmin && <NavLink to="/platform" className="mt-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-slate-200 hover:bg-white/10"><Shield className="h-5 w-5" />{t.nav.platform}</NavLink>}
      <div className="mt-auto space-y-2 border-t border-white/10 pt-4">
        {me.data.orgs.length > 1 && (
          <Select aria-label={t.nav.switchOrg} value={me.data.activeOrgId ?? ''} onChange={(e) => switchOrg(e.target.value)} className="border-white/20 bg-white/10 text-white">
            {me.data.orgs.map((o) => <option key={o.id} value={o.id} className="text-navy">{o.name}</option>)}
          </Select>
        )}
        <div className="px-3 text-sm text-slate-300">{me.data.user.fullName}<br /><span className="text-xs text-slate-400">{me.data.role ? t.roles[me.data.role] : ''}</span></div>
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-slate-200 hover:bg-white/10"><LogOut className="h-5 w-5" />{t.nav.logout}</button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-navy lg:block">{sidebar}</aside>
      {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="absolute inset-0 bg-navy/50" onClick={() => setOpen(false)} />
        <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-navy">{sidebar}<button className="absolute right-3 top-4 text-white" onClick={() => setOpen(false)} aria-label={t.common.close}><X /></button></aside></div>}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-white px-4 py-3 lg:hidden">
        <button onClick={() => setOpen(true)} aria-label={t.nav.more}><Menu className="h-6 w-6" /></button>
        <span className="font-bold">insight<span className="text-primary">Frota</span></span>
        <NavLink to="/app/alerts" aria-label={t.nav.alerts} className="relative"><Bell className="h-6 w-6" />{(notif.data?.unread ?? 0) > 0 && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-danger" />}</NavLink>
      </header>
      <main className="mx-auto min-w-0 max-w-7xl overflow-x-clip px-4 pb-24 pt-5 sm:px-6 lg:pb-10 lg:pt-8"><Suspense fallback={<Spinner />}><Outlet /></Suspense></main>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-border bg-white lg:hidden" aria-label={t.nav.bottomLabel}>
        {NAV.filter((n) => MOBILE.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => cn('flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted', isActive && 'text-primary')}><n.icon className="h-5 w-5" />{n.label}</NavLink>
        ))}
        <button onClick={() => setOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted"><RouteIcon className="h-5 w-5" />{t.nav.more}</button>
      </nav>
    </div>
  );
}
