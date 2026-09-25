import { useState, useCallback } from 'react';

export function SqlBrowserPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  const handleSubmit = useCallback(async () => {
    if (!query.trim()) return;
    setStatus('loading');
    setResult('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: `Generate a safe, read-only SELECT SQL query for the following request. Only output the SQL query, no explanations:\n\n${query}`,
            },
          ],
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Parse streaming text response
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let accumulated = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setResult(accumulated);
      }

      setStatus('idle');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setResult(`Error: ${msg}`);
      setStatus('error');
    }
  }, [query]);

  return (
    <section style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 24 }}>Text-to-SQL Browser</h1>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="sql-query" style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}>
          Describe your query in natural language
        </label>
        <textarea
          id="sql-query"
          placeholder="e.g., Show all conversations from the last 7 days"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) void handleSubmit(); }}
          rows={4}
          style={{ width: '100%', padding: 8, fontFamily: 'inherit' }}
        />
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={status === 'loading' || !query.trim()}
        style={{ padding: '8px 24px', fontWeight: 600, marginBottom: 16 }}
      >
        {status === 'loading' ? 'Generating...' : 'Generate SQL'}
      </button>

      <p style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>Ctrl+Enter to submit</p>

      {result && (
        <div>
          <h2 style={{ marginBottom: 8 }}>Generated SQL</h2>
          <pre style={{
            background: '#f5f5f5',
            padding: 16,
            borderRadius: 8,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            fontSize: 14,
            fontFamily: 'monospace',
          }}>
            {result}
          </pre>
        </div>
      )}
    </section>
  );
}

export default SqlBrowserPage;
