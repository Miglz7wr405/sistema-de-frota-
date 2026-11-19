import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, MessageCircle, QrCode, Share2, Download } from 'lucide-react';
import QRCode from 'qrcode';
import { api, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Badge, Button, Card, Modal } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

export type Share = { id: string; short_code: string; expires_at: string; revoked_at: string | null; is_active: boolean; views_count: number; options: Record<string, boolean>; created_at: string };

export function ShareCard({ tripId, shares, origin, destination, company, canWrite }: { tripId: string; shares: Share[]; origin: string; destination: string; company: string | null; canWrite: boolean }) {
  const qc = useQueryClient();
  const [fresh, setFresh] = useState<{ id: string; link: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [opts, setOpts] = useState({ show_company: true, show_logo: true, show_plate_masked: false, show_driver_first_name: false });
  const [err, setErr] = useState<string | null>(null);
  const active = shares.find((s) => s.is_active && !s.revoked_at && new Date(s.expires_at) > new Date());
  const create = useMutation({
    mutationFn: () => api<{ id: string; link: string }>(`/api/trips/${tripId}/shares`, { body: { options: opts } }),
    onSuccess: (r) => { setFresh(r); qc.invalidateQueries({ queryKey: ['trip', tripId] }); },
    onError: (e) => setErr(errorMessage(e)),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/api/shares/${id}/revoke`, { method: 'POST' }), onSuccess: () => { setFresh(null); qc.invalidateQueries({ queryKey: ['trip', tripId] }); } });
  // Depois de recarregar a página, o token completo já não existe (só o hash): usa-se o link por código.
  const link = active ? (fresh?.id === active.id ? fresh.link : `${location.origin}/track?code=${active.short_code}`) : null;
  const message = active && link ? t.share.message(company, origin, destination, link, active.short_code) : '';
  const copy = async () => { await navigator.clipboard.writeText(link!); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const showQr = async () => setQr(await QRCode.toDataURL(link!, { width: 512, margin: 2, color: { dark: '#10243D' } }));

  return (
    <Card className="border-2 border-primary" title={t.share.title} action={active ? <Badge tone="success">{t.share.active}</Badge> : undefined}>
      {err && <p className="mb-2 text-sm text-danger">{err}</p>}
      {active ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-background p-4 text-center"><p className="text-xs text-muted">{t.share.code}</p><p className="font-mono text-2xl font-bold tracking-wider">{active.short_code}</p></div>
          <div className="flex items-center gap-2 rounded-xl border border-border p-2"><span className="flex-1 truncate px-1 text-sm">{link}</span>
            <Button variant="secondary" size="sm" onClick={copy} aria-label={t.common.copy}><Copy className="h-4 w-4" />{copied ? t.common.copied : ''}</Button></div>
          {fresh?.id === active.id && <p className="text-xs text-warning">{t.share.tokenOnce}</p>}
          <div className="grid grid-cols-2 gap-2">
            <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><Button variant="success" className="w-full"><MessageCircle className="h-4 w-4" />{t.share.whatsapp}</Button></a>
            <Button variant="secondary" onClick={showQr}><QrCode className="h-4 w-4" />{t.share.qr}</Button>
          </div>
          <div className="flex justify-between border-t border-border pt-3 text-sm text-muted"><span>{t.share.validUntil(formatDateTime(active.expires_at))}</span><span>{t.share.views(active.views_count)}</span></div>
          {canWrite && <div className="flex justify-center gap-4">
            <button className="text-sm font-medium text-danger" onClick={() => confirm(t.share.revokeConfirm) && revoke.mutate(active.id)}>{t.share.revoke}</button>
            <button className="text-sm font-medium text-primary" onClick={async () => { await revoke.mutateAsync(active.id); create.mutate(); }}>{t.share.regenerate}</button></div>}
        </div>
      ) : canWrite ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t.share.none}</p>
          <fieldset className="space-y-1 text-sm"><legend className="label">{t.share.options}</legend>
            {([['show_company', t.share.showCompany], ['show_logo', t.share.showLogo], ['show_plate_masked', t.share.showPlate], ['show_driver_first_name', t.share.showDriver]] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />{l}</label>))}
          </fieldset>
          <Button className="w-full" onClick={() => create.mutate()} loading={create.isPending}><Share2 className="h-4 w-4" />{t.share.create}</Button>
        </div>
      ) : <p className="text-sm text-muted">{t.share.none}</p>}
      <Modal open={!!qr} onClose={() => setQr(null)} title={t.share.qr}>
        {qr && <div className="text-center"><img src={qr} alt={active?.short_code} className="mx-auto w-64" /><p className="mt-2 font-mono font-bold">{active?.short_code}</p>
          <a href={qr} download={`${active?.short_code}.png`}><Button className="mt-4"><Download className="h-4 w-4" />{t.common.download} PNG</Button></a></div>}
      </Modal>
    </Card>
  );
}
