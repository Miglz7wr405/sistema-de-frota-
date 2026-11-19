import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export type Me = {
  user: { id: string; fullName: string; email: string; isPlatformAdmin: boolean } | null;
  activeOrgId: string | null; role: 'owner' | 'admin' | 'dispatcher' | 'viewer' | null;
  orgs: { id: string; name: string; role: string }[]; emailRecovery: boolean; serverTime: string;
};
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/api/auth/me'), staleTime: 60_000 });
export const useRole = () => {
  const me = useMe().data;
  const r = me?.role;
  return { role: r, canWrite: r === 'owner' || r === 'admin' || r === 'dispatcher', canAdmin: r === 'owner' || r === 'admin', isOwner: r === 'owner', canSeeCosts: r !== 'viewer' && !!r };
};
export const useRefreshMe = () => { const qc = useQueryClient(); return () => qc.invalidateQueries(); };
