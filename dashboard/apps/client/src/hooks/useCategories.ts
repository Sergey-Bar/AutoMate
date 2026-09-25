import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface DefectCategory {
  id: string;
  name: string;
  color: string;
}

export interface FingerprintCategory {
  fingerprint: string;
  categoryId: string;
}

export function useCategories() {
  return useQuery<DefectCategory[]>({
    queryKey: ['categories'],
    queryFn: () => fetch('/api/categories').then((r) => r.json()),
    staleTime: 60_000,
  });
}

export function useFingerprintCategories() {
  return useQuery<FingerprintCategory[]>({
    queryKey: ['fingerprint-categories'],
    queryFn: () => fetch('/api/fingerprint-categories').then((r) => r.json()),
    staleTime: 30_000,
  });
}

export function useAssignCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fingerprint, categoryId }: { fingerprint: string; categoryId: string | null }) => {
      if (categoryId === null) {
        return fetch(`/api/fingerprint-categories/${encodeURIComponent(fingerprint)}`, { method: 'DELETE' });
      }
      return fetch(`/api/fingerprint-categories/${encodeURIComponent(fingerprint)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fingerprint-categories'] }),
  });
}
