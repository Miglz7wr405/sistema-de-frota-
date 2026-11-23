// Aviso quando o camião/motorista já está noutra viagem em curso: "cancelar essa viagem para iniciar esta?"
import { useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Button, Modal } from '@/components/ui';
import { Checkout } from '../billing/Checkout';

export type BusyTrip = { id: string; code: string; status: string; origin: string; destination: string; plate: string | null; driver: string | null; same_vehicle: boolean; same_driver: boolean };
export type Replace = { tripIds: string[]; action: 'cancelar' | 'concluir' };

/** Iniciar uma viagem. Depois de um pagamento confirmado a BD já a iniciou sozinha: "transição inválida" conta como iniciada. */
export async function startTripApi(tripId: string, replace?: Replace) {
  try { await api(`/api/trips/${tripId}/transition`, { body: { to: 'em_viagem', replace } }); }
  catch (e) { if (!(e instanceof ApiError && e.code === 'transicao_invalida')) throw e; }
}

/** Envolve um "iniciar viagem": se o servidor disser que o camião/motorista já está em viagem, mostra o aviso e repete com a escolha. */
export function useStartWithReplace() {
  const [busy, setBusy] = useState<BusyTrip[] | null>(null);
  const [pending, setPending] = useState<((r: Replace) => Promise<void>) | null>(null);
  const [working, setWorking] = useState<Replace['action'] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // checkout: viagem sem viagem grátis nem pagamento → pagar e, quando confirmado, repetir o "iniciar"
  const [pay, setPay] = useState<{ tripId: string; trip?: { origin?: string; destination?: string; code?: string }; retry: () => Promise<unknown> } | null>(null);
  const openCheckout = (tripId: string, retry: () => Promise<unknown>, trip?: { origin?: string; destination?: string; code?: string }) => setPay({ tripId, retry, trip });

  /** `go(replace?)` faz o pedido. Devolve true se iniciou, false se ficou à espera da escolha no aviso. Outros erros sobem. */
  const run = async (go: (r?: Replace) => Promise<void>, opts?: { tripId?: string; trip?: { origin?: string; destination?: string; code?: string } }): Promise<boolean> => {
    try { await go(); return true; } catch (e) {
      if (e instanceof ApiError && e.code === 'pagamento_necessario' && opts?.tripId) {
        openCheckout(opts.tripId, () => run(go, opts), opts.trip);
        return false;
      }
      if (e instanceof ApiError && e.code === 'ja_em_viagem') {
        setBusy(((e.details as { trips?: BusyTrip[] }) ?? {}).trips ?? []);
        setPending(() => go); setErr(null);
        return false;
      }
      throw e;
    }
  };
  const choose = async (action: Replace['action']) => {
    if (!busy || !pending) return;
    setWorking(action); setErr(null);
    try { await pending({ tripIds: busy.map((b) => b.id), action }); setBusy(null); setPending(null); }
    catch (e) { setErr(errorMessage(e)); } finally { setWorking(null); }
  };
  const dialog: ReactNode = (<>
    {pay && <Checkout open tripId={pay.tripId} trip={pay.trip} onClose={() => setPay(null)}
      onPaid={() => { const r = pay.retry; setPay(null); void r(); }} />}
    <Modal open={!!busy} onClose={() => { setBusy(null); setPending(null); }} title={t.busy.title}>
      <div className="space-y-3">
        {busy?.map((b) => (
          <div key={b.id} className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm">
            <p className="text-navy">{t.busy.who(b.same_vehicle ? b.plate : null, b.same_driver ? b.driver : null)}</p>
            <p className="mt-1 font-semibold text-navy">{b.code} · {b.origin} → {b.destination} ({t.trip.statuses[b.status]})</p>
          </div>))}
        <p className="text-sm">{t.busy.question}</p>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <div className="flex flex-col gap-2">
          <Button size="lg" variant="danger" loading={working === 'cancelar'} disabled={!!working} onClick={() => choose('cancelar')}>{t.busy.cancelAndStart}</Button>
          <Button size="lg" variant="secondary" loading={working === 'concluir'} disabled={!!working} onClick={() => choose('concluir')}>{t.busy.finishAndStart}</Button>
          <Button variant="ghost" disabled={!!working} onClick={() => { setBusy(null); setPending(null); }}>{t.common.back}</Button>
        </div>
      </div>
    </Modal>
  </>);
  return { run, dialog, openCheckout };
}
