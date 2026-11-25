// Página inicial: fotografia de um camião em destaque, faixa para acompanhar uma viagem por código (funciona),
// três cartões com imagens REAIS da aplicação, "Como funciona" em fundo escuro, vantagens e rodapé.
// Nenhum número inventado (sem "X clientes"); textos em pt-MZ.ts.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Truck, WifiOff, Map as MapIcon, ShieldCheck, Banknote, Search, ArrowRight } from 'lucide-react';
import { t } from '@/i18n/pt-MZ';
import { ContactLink } from './Legal';

export function Landing() {
  const L = t.landing;
  const [code, setCode] = useState('');
  const track = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    location.href = c ? `/track?code=${encodeURIComponent(c)}` : '/track';
  };
  const cards = [
    { img: '/img/landing-cliente.webp', title: L.f1t, text: L.f1d },
    { img: '/img/landing-percurso.webp', title: L.f2t, text: L.f2d },
    { img: '/img/landing-motorista.webp', title: L.f4t, text: L.f4d },
  ];
  const steps = [L.s1, L.s2, L.s3];
  const perks = [
    { icon: WifiOff, title: L.f3t, text: L.f3d },
    { icon: MapIcon, title: L.p1t, text: L.p1d },
    { icon: ShieldCheck, title: L.p2t, text: L.p2d },
    { icon: Banknote, title: L.p3t, text: L.p3d },
  ];
  return (
    <div className="min-h-screen overflow-x-hidden bg-white">
      {/* 1. topo com fotografia */}
      <section className="relative isolate min-h-[85dvh] overflow-hidden bg-navy text-white sm:min-h-[640px]">
        <div className="hero-trip-photo absolute inset-0 -z-10 bg-cover" style={{ backgroundImage: 'url(/img/camiao-fundo.webp)' }} aria-hidden="true" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-navy/80 via-navy/70 to-navy/95 sm:bg-gradient-to-r sm:from-navy/95 sm:via-navy/75 sm:to-navy/20" aria-hidden="true" />
        <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5">
          <span className="flex items-center gap-2 text-xl font-bold"><span className="rounded-lg bg-primary p-1.5"><Truck className="h-5 w-5" /></span><span>insight<span className="text-[#7FB2FF]">Frota</span></span></span>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a href="/track" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-white/90 hover:bg-white/10 sm:inline">{L.ctaTrack}</a>
            <Link to="/login" className="rounded-lg border border-white/40 px-4 py-2 text-sm font-semibold hover:bg-white/10">{L.ctaLogin}</Link>
          </nav>
        </header>
        <div className="mx-auto max-w-6xl px-4 pb-28 pt-10 sm:pb-36 sm:pt-20">
          <p className="mb-3 inline-block rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">{t.app.tagline}</p>
          <h1 className="max-w-2xl text-4xl font-bold leading-tight text-white sm:text-5xl">{L.title}</h1>
          <p className="mt-5 max-w-xl text-lg text-white/85">{L.subtitle}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3.5 font-semibold text-white shadow-lg hover:bg-[#125BCB]">{L.ctaStart}<ArrowRight className="h-4 w-4" /></Link>
            <a href="/track" className="inline-flex items-center gap-2 rounded-xl border-2 border-white/80 px-6 py-3 font-semibold hover:bg-white/10"><MapPin className="h-4 w-4" />{L.ctaTrack}</a>
          </div>
        </div>
      </section>

      {/* 2. faixa: acompanhar uma viagem pelo código */}
      <section className="relative z-10 mx-auto -mt-16 max-w-6xl px-4">
        <form onSubmit={track} className="grid grid-cols-1 gap-4 rounded-2xl bg-white p-5 shadow-xl ring-1 ring-border sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
          <div className="min-w-0">
            <p className="text-lg font-bold text-navy">{L.trackTitle}</p>
            <p className="text-sm text-muted">{L.trackText}</p>
          </div>
          <div className="flex min-w-0 gap-2">
            <label className="sr-only" htmlFor="codigo">{t.driverApp.tripCode}</label>
            <input id="codigo" value={code} onChange={(e) => setCode(e.target.value)} placeholder="FT-XXXX-XXXX" autoCapitalize="characters"
              className="min-w-0 flex-1 rounded-xl border border-border px-4 py-3 font-mono uppercase tracking-wider outline-none focus:border-primary sm:w-56" />
            <button type="submit" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-navy px-4 py-3 font-semibold text-white hover:bg-[#1B3557] sm:px-5"><Search className="h-4 w-4" /><span className="hidden min-[380px]:inline">{L.trackGo}</span><span className="sr-only min-[380px]:hidden">{L.trackGo}</span></button>
          </div>
        </form>
      </section>

      {/* 3. cartões com imagens reais da aplicação */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold text-navy sm:text-3xl">{L.cardsTitle}</h2>
        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          {cards.map((c) => (
            <article key={c.title} className="overflow-hidden rounded-2xl border border-border bg-white shadow-sm">
              <img src={c.img} alt="" loading="lazy" width={400} height={300} className="aspect-[4/3] w-full border-b border-border bg-background object-cover" />
              <div className="p-5"><h3 className="text-lg font-semibold text-navy">{c.title}</h3><p className="mt-2 text-muted">{c.text}</p></div>
            </article>
          ))}
        </div>
      </section>

      {/* 4. como funciona (fundo escuro) */}
      <section className="bg-navy py-16 text-white">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">{L.howTitle}</h2>
          <ol className="mt-8 grid gap-5 sm:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s} className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-lg font-bold">{i + 1}</span>
                <p className="mt-4 text-lg font-medium leading-snug text-white">{s}</p>
              </li>
            ))}
          </ol>
          <Link to="/register" className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 font-semibold text-navy hover:bg-white/90">{L.ctaStart}<ArrowRight className="h-4 w-4" /></Link>
        </div>
      </section>

      {/* 5. vantagens */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {perks.map((p) => (
            <div key={p.title} className="flex gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><p.icon className="h-5 w-5" aria-hidden /></span>
              <div><h3 className="font-semibold text-navy">{p.title}</h3><p className="mt-1 text-sm text-muted">{p.text}</p></div>
            </div>
          ))}
        </div>
        <p className="mt-10 rounded-xl bg-background p-4 text-sm text-muted">{L.honesty}</p>
      </section>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-muted sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <span>{L.copyright(new Date().getFullYear())}</span>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link to="/termos" className="hover:text-navy">{L.terms}</Link>
            <span className="inline-flex items-center gap-1">{L.contact}: <ContactLink /></span>
          </nav>
          <span className="w-full text-xs">{L.footer}</span>
        </div>
      </footer>
    </div>
  );
}
