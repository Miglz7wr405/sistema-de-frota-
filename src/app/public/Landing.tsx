import { Link } from 'react-router-dom';
import { MapPin, Route, WifiOff, Truck, Share2 } from 'lucide-react';
import { t } from '@/i18n/pt-MZ';

export function Landing() {
  const f = [
    { icon: Share2, title: t.landing.f1t, text: t.landing.f1d },
    { icon: Route, title: t.landing.f2t, text: t.landing.f2d },
    { icon: WifiOff, title: t.landing.f3t, text: t.landing.f3d },
  ];
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <span className="flex items-center gap-2 text-xl font-bold"><span className="rounded-lg bg-primary p-1.5 text-white"><Truck className="h-5 w-5" /></span>insight<span className="text-primary">Frota</span></span>
        <nav className="flex gap-2"><a href="/track" className="rounded-lg px-3 py-2 text-sm font-medium text-primary hover:bg-primary-soft">{t.landing.ctaTrack}</a>
          <Link to="/login" className="rounded-lg border border-border px-3 py-2 text-sm font-medium">{t.landing.ctaLogin}</Link></nav>
      </header>
      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:pt-16">
          <p className="mb-3 font-semibold text-primary">{t.app.tagline}</p>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">{t.landing.title}</h1>
          <p className="mt-5 max-w-2xl text-lg text-muted">{t.landing.subtitle}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/register" className="rounded-lg bg-primary px-5 py-3 font-medium text-white hover:bg-[#125BCB]">{t.landing.ctaStart}</Link>
            <a href="/track" className="flex items-center gap-2 rounded-lg border border-border px-5 py-3 font-medium"><MapPin className="h-4 w-4" />{t.landing.ctaTrack}</a>
          </div>
        </section>
        <section className="bg-background py-14">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 sm:grid-cols-3">
            {f.map((x) => (
              <article key={x.title} className="card p-6"><x.icon className="h-7 w-7 text-primary" aria-hidden /><h2 className="mt-3 text-lg font-semibold">{x.title}</h2><p className="mt-2 text-muted">{x.text}</p></article>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-6xl px-4 text-sm text-muted">{t.landing.honesty}</p>
        </section>
      </main>
      <footer className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted">© insightFrota · {t.landing.footer}</footer>
    </div>
  );
}
