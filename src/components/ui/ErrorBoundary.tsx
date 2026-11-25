// Apanha erros de renderização para nunca deixar um ecrã branco.
// Depois de um deploy novo, um chunk antigo pode já não existir: nesse caso recarrega a página sozinho (uma vez).
import { Component, type ReactNode } from 'react';
import { tt } from '@/i18n/pt-MZ.track';

const RELOAD_KEY = 'if_chunk_reload';
const isChunkError = (e: unknown) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(String((e as Error)?.message ?? e));

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) { return { error }; }

  componentDidCatch(error: unknown) {
    if (!isChunkError(error)) return;
    try {
      if (sessionStorage.getItem(RELOAD_KEY)) return; // já recarregou uma vez: mostra o ecrã de erro
      sessionStorage.setItem(RELOAD_KEY, '1');
    } catch { return; }
    window.location.reload();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold text-navy">{tt.states.crashTitle}</h1>
          <p className="mt-2 text-sm text-muted">{tt.states.crashText}</p>
          <button type="button" onClick={() => { try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* sem armazenamento */ } window.location.reload(); }}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-[#125BCB]">{tt.states.reload}</button>
        </div>
      </div>
    );
  }
}
