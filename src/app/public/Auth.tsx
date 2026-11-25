import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck } from 'lucide-react';
import { api, errorMessage } from '@/lib/api/client';
import { Button, Field, Input, Select } from '@/components/ui';
import { t } from '@/i18n/pt-MZ';
import { toE164 } from '@/lib/format';
import { useMe } from '../session';

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2 text-xl font-bold"><span className="rounded-lg bg-primary p-1.5 text-white"><Truck className="h-5 w-5" /></span><span>insight<span className="text-primary">Frota</span></span></Link>
      <div className="card w-full max-w-md p-6"><h1 className="mb-5 text-2xl font-bold">{title}</h1>{children}</div>
    </div>
  );
}
const Err = ({ msg }: { msg: string | null }) => (msg ? <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{msg}</p> : null);

export function Login() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const f = useForm({ resolver: zodResolver(z.object({ email: z.string().email(t.validation.email), password: z.string().min(1, t.common.required) })) });
  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    try { await api('/api/auth/login', { body: v }); await qc.invalidateQueries(); nav(sp.get('next') ?? '/app/dashboard'); }
    catch (e) { setErr(errorMessage(e)); }
  });
  return (
    <Shell title={t.auth.loginTitle}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Err msg={err} />
        <Field label={t.auth.email} error={f.formState.errors.email?.message as string}><Input type="email" autoComplete="email" {...f.register('email')} /></Field>
        <Field label={t.auth.password} error={f.formState.errors.password?.message as string}><Input type="password" autoComplete="current-password" {...f.register('password')} /></Field>
        <Button type="submit" className="w-full" loading={f.formState.isSubmitting}>{t.auth.login}</Button>
      </form>
      <div className="mt-4 flex justify-between text-sm"><Link className="text-primary" to="/forgot-password">{t.auth.forgot}</Link><Link className="text-primary" to="/register">{t.auth.register}</Link></div>
    </Shell>
  );
}

const RegSchema = z.object({
  fullName: z.string().min(2, t.validation.name), email: z.string().email(t.validation.email), password: z.string().min(8, t.validation.password),
  orgName: z.string().min(2, t.validation.name), phone: z.string().optional().refine((v) => !v || toE164(v), t.validation.phone), province: z.string().optional(),
});
export function Register() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const provinces = useQuery({ queryKey: ['provinces'], queryFn: () => api<{ id: string; name: string }[]>('/api/geo/provinces') });
  const f = useForm<z.infer<typeof RegSchema>>({ resolver: zodResolver(RegSchema) });
  const submit = f.handleSubmit(async (v) => {
    setErr(null);
    try { await api('/api/auth/register', { body: { ...v, phone: v.phone ? toE164(v.phone) : '' } }); await qc.invalidateQueries(); nav('/app/dashboard'); }
    catch (e) { setErr(errorMessage(e)); }
  });
  const e = f.formState.errors;
  return (
    <Shell title={t.auth.registerTitle}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Err msg={err} />
        <Field label={t.auth.fullName} error={e.fullName?.message}><Input autoComplete="name" {...f.register('fullName')} /></Field>
        <Field label={t.auth.email} error={e.email?.message}><Input type="email" autoComplete="email" {...f.register('email')} /></Field>
        <Field label={t.auth.password} error={e.password?.message}><Input type="password" autoComplete="new-password" {...f.register('password')} /></Field>
        <Field label={t.auth.orgName} error={e.orgName?.message}><Input {...f.register('orgName')} /></Field>
        <Field label={`${t.auth.phone} (${t.common.optional})`} error={e.phone?.message}><Input type="tel" placeholder="+258 84 123 4567" {...f.register('phone')} /></Field>
        {!!provinces.data?.length && (
          <Field label={`${t.auth.province} (${t.common.optional})`}><Select {...f.register('province')}><option value="">—</option>{provinces.data.map((p) => <option key={p.id}>{p.name}</option>)}</Select></Field>
        )}
        <p className="text-xs text-muted">{t.legal.acceptRegister} <Link className="text-primary" to="/termos">{t.landing.terms}</Link>.</p>
        <Button type="submit" className="w-full" loading={f.formState.isSubmitting}>{t.auth.register}</Button>
      </form>
      <p className="mt-4 text-sm">{t.auth.haveAccount} <Link className="text-primary" to="/login">{t.auth.login}</Link></p>
    </Shell>
  );
}

export function Forgot() {
  const me = useMe();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const f = useForm({ resolver: zodResolver(z.object({ email: z.string().email(t.validation.email) })) });
  const submit = f.handleSubmit(async (v) => {
    try { await api('/api/auth/forgot', { body: v }); setDone(true); }
    catch (e) { setErr((e as { status?: number }).status === 501 ? t.auth.forgotUnavailable : errorMessage(e)); }
  });
  return (
    <Shell title={t.auth.forgotTitle}>
      {me.data && !me.data.emailRecovery ? <p className="text-muted">{t.auth.forgotUnavailable}</p>
        : done ? <p className="text-success-text">{t.auth.forgotSent}</p>
        : <form onSubmit={submit} className="space-y-4"><Err msg={err} /><Field label={t.auth.email}><Input type="email" {...f.register('email')} /></Field><Button type="submit" className="w-full" loading={f.formState.isSubmitting}>{t.auth.forgotSend}</Button></form>}
      <p className="mt-4 text-sm"><Link to="/login" className="text-primary">{t.common.back}</Link></p>
    </Shell>
  );
}

export function Reset() {
  const token = location.hash.slice(1);
  const [state, setState] = useState<'form' | 'done' | 'error'>('form');
  const f = useForm({ resolver: zodResolver(z.object({ password: z.string().min(8, t.validation.password) })) });
  const submit = f.handleSubmit(async (v) => {
    try { await api('/api/auth/reset', { body: { token, password: v.password } }); setState('done'); } catch { setState('error'); }
  });
  return (
    <Shell title={t.auth.resetTitle}>
      {state === 'done' ? <p className="text-success-text">{t.auth.resetDone} <Link to="/login" className="text-primary">{t.auth.login}</Link></p>
        : state === 'error' ? <p className="text-danger">{t.auth.resetInvalid}</p>
        : <form onSubmit={submit} className="space-y-4"><Field label={t.auth.password} error={f.formState.errors.password?.message as string}><Input type="password" autoComplete="new-password" {...f.register('password')} /></Field><Button type="submit" className="w-full" loading={f.formState.isSubmitting}>{t.common.save}</Button></form>}
    </Shell>
  );
}

export function Invite() {
  const me = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  const token = location.hash.slice(1);
  const [err, setErr] = useState<string | null>(null);
  const accept = async () => {
    try { await api('/api/invites/accept', { body: { token } }); await qc.invalidateQueries(); nav('/app/dashboard'); } catch { setErr(t.auth.inviteInvalid); }
  };
  return (
    <Shell title={t.auth.inviteTitle}>
      <Err msg={err} />
      {me.data?.user ? <Button className="w-full" onClick={accept}>{t.auth.inviteAccept}</Button>
        : <><p className="mb-4 text-muted">{t.auth.inviteNeedLogin}</p><div className="flex gap-2">
            <Link to={`/login?next=${encodeURIComponent('/invite' + location.hash)}`} className="flex-1"><Button className="w-full">{t.auth.login}</Button></Link>
            <Link to="/register" className="flex-1"><Button variant="secondary" className="w-full">{t.auth.register}</Button></Link></div></>}
    </Shell>
  );
}
