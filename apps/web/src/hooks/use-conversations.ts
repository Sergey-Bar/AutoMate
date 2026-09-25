import { useState, useEffect } from 'react';

export function useConversations() {
  const [conversations, setConversations] = useState<Array<{ id: string; title: string | null; createdAt: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/conversations', { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error('Failed to fetch conversations');
        return r.json();
      })
      .then((data) => {
        setError(null);
        setConversations(data);
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message);
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const create = async (title?: string) => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('Failed to create conversation');
      const conv = await res.json();
      setError(null);
      setConversations(prev => [conv, ...prev]);
      return conv;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  const clearError = () => setError(null);

  return { conversations, loading, error, create, clearError };
}
