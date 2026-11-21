// Ícones próprios (camião de carga visto de lado e motorista com carta de condução), no mesmo traço dos ícones Lucide.
type P = { className?: string };

export function TruckIcon({ className }: P) {
  return (
    <svg viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* carroçaria */}
      <rect x="1.5" y="4" width="18" height="12.5" rx="1.5" fill="currentColor" fillOpacity="0.14" />
      {/* cabine com para-brisas */}
      <path d="M19.5 8.5h5.2c.5 0 1 .25 1.3.65l3.2 4.2c.2.25.3.6.3.9v2.25h-10" fill="currentColor" fillOpacity="0.14" />
      <path d="M21.8 8.8v3.7h5.6" />
      {/* rodas */}
      <circle cx="7" cy="18.5" r="2.4" fill="#fff" /><circle cx="13" cy="18.5" r="2.4" fill="#fff" /><circle cx="25" cy="18.5" r="2.4" fill="#fff" />
    </svg>
  );
}

export function DriverIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* cabeça com boné */}
      <path d="M7.5 8.2a4.5 4.5 0 0 1 9 0" fill="currentColor" fillOpacity="0.14" />
      <path d="M6.5 8.3h11" />
      <path d="M8.2 8.6a3.8 3.8 0 0 0 7.6 0" />
      {/* tronco */}
      <path d="M4.5 21v-1.2a5.5 5.5 0 0 1 5.5-5.5h4a5.5 5.5 0 0 1 5.5 5.5V21" fill="currentColor" fillOpacity="0.14" />
      {/* volante */}
      <circle cx="12" cy="18.6" r="2.4" /><path d="M12 16.2v2.4M9.6 18.6h4.8" />
    </svg>
  );
}
