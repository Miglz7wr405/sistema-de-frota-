// Páginas públicas: Termos de uso e "Página não encontrada". Textos em pt-MZ.ts.
import { Link } from 'react-router-dom';
import { MessageCircle, Truck } from 'lucide-react';
import { t } from '@/i18n/pt-MZ';
import { SUPPORT_PHONE, SUPPORT_WHATSAPP } from '@/lib/contact';

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold text-navy">
            <span className="rounded-lg bg-primary p-1.5 text-white"><Truck className="h-4 w-4" aria-hidden /></span><span>insight<span className="text-primary">Frota</span></span>
          </Link>
          <Link to="/" className="text-sm font-medium text-primary">{t.legal.back}</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}

export function ContactLink({ className = '' }: { className?: string }) {
  return (
    <a href={SUPPORT_WHATSAPP} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1.5 font-medium text-primary ${className}`}>
      <MessageCircle className="h-4 w-4" aria-hidden />{SUPPORT_PHONE}
    </a>
  );
}

function LegalPage({ title, sections }: { title: string; sections: [string, string][] }) {
  return (
    <PublicShell>
      <article className="card p-6 sm:p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted">{t.legal.updated}</p>
        {sections.map(([h, p]) => (
          <section key={h} className="mt-6">
            <h2 className="text-base font-semibold">{h}</h2>
            <p className="mt-1.5 leading-relaxed text-slate-700">{p}</p>
          </section>
        ))}
        <p className="mt-8 border-t border-border pt-4 text-sm text-muted">{t.landing.contact}: <ContactLink /></p>
      </article>
    </PublicShell>
  );
}

export const Terms = () => <LegalPage title={t.legal.termsTitle} sections={t.legal.terms} />;

export function NotFound({ panel = false }: { panel?: boolean }) {
  const body = (
    <div className="grid min-h-[50vh] place-items-center text-center" data-testid="nao-encontrado">
      <div>
        <p className="text-5xl font-bold text-primary">404</p>
        <h1 className="mt-3 text-xl font-bold">{t.notFound.title}</h1>
        <p className="mt-2 text-muted">{t.notFound.text}</p>
        <Link to={panel ? '/app/dashboard' : '/'} className="mt-5 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-[#125BCB]">
          {panel ? t.notFound.panel : t.notFound.home}
        </Link>
      </div>
    </div>
  );
  return panel ? body : <PublicShell>{body}</PublicShell>;
}
