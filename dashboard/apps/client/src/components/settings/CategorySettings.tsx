import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { SettingsSection } from './SettingsSection';

export function CategorySettings() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#6b7280');

  const { data: categories } = useQuery<Array<{ id: string; name: string; color: string }>>({
    queryKey: ['categories'],
    queryFn: () => fetch('/api/categories').then((r) => r.json()),
  });

  const create = useMutation({
    mutationFn: () =>
      fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, color: newColor }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      setNewName('');
      toast.success('Category created');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => fetch(`/api/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories'] }),
  });

  return (
    <SettingsSection title="Defect Categories">
      <div className="space-y-2 px-4 py-3">
        {(categories ?? []).map((cat) => (
          <div key={cat.id} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.color }} />
            <span className="text-sm flex-1 text-text-primary">{cat.name}</span>
            <Button variant="ghost" size="sm" onClick={() => remove.mutate(cat.id)} aria-label={`Delete ${cat.name}`}>
              <Trash2 size={13} className="text-text-tertiary" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-2">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="w-8 h-8 rounded border border-border-default cursor-pointer"
          />
          <Input
            size="sm"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Category name…"
            className="flex-1"
          />
          <Button size="sm" icon={<Plus size={12} />} disabled={!newName.trim()} onClick={() => create.mutate()}>
            Add
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
