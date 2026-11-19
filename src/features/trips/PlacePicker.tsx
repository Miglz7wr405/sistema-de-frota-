import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
import { api } from '@/lib/api/client';
import { t } from '@/i18n/pt-MZ';
import { Input } from '@/components/ui';

export type PlaceOpt = { id: string; name: string; kind: string; province: string | null; private: boolean; lng: number; lat: number };

/** Pesquisa na base de localidades importada (OSM/HDX) + locais privados. Nunca cria coordenadas inventadas. */
export function PlacePicker({ value, onChange, placeholder, invalid }: { value: PlaceOpt | null; onChange: (p: PlaceOpt | null) => void; placeholder?: string; invalid?: boolean }) {
  const [text, setText] = useState(value?.name ?? '');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = setTimeout(() => setDebounced(text), 250); return () => clearTimeout(h); }, [text]);
  useEffect(() => { setText(value?.name ?? ''); }, [value?.id]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);
  const q = useQuery({ queryKey: ['places', debounced], queryFn: () => api<PlaceOpt[]>(`/api/places/search?q=${encodeURIComponent(debounced)}`), enabled: open && debounced.length >= 2 });
  return (
    <div ref={box} className="relative">
      <MapPin className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
      <Input className={`pl-9 ${invalid ? 'border-danger' : ''}`} value={text} placeholder={placeholder ?? t.trip.placeSearch} role="combobox" aria-expanded={open}
        onChange={(e) => { setText(e.target.value); setOpen(true); if (value) onChange(null); }} onFocus={() => setOpen(true)} />
      {open && debounced.length >= 2 && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-white shadow-lg" role="listbox">
          {q.isLoading && <li className="px-3 py-2 text-sm text-muted">{t.common.loading}</li>}
          {q.data?.length === 0 && <li className="px-3 py-2 text-sm text-muted">{t.trip.noPlacesFound}</li>}
          {q.data?.map((p) => (
            <li key={p.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-primary-soft" onClick={() => { onChange(p); setText(p.name); setOpen(false); }}>
              <span className="font-medium">{p.name}</span> <span className="text-muted">· {p.province ?? ''}{p.private ? ' · privado' : ''}</span></button></li>))}
        </ul>
      )}
    </div>
  );
}
