import { useState } from 'react';

interface GeneratedTest {
  testCode: string;
  testFileName: string;
  functionsAnalyzed: string[];
  prompt: string;
}

export function AiTestGenerator() {
  const [sourceCode, setSourceCode] = useState('');
  const [filePath, setFilePath] = useState('');
  const [result, setResult] = useState<GeneratedTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setError(null);
    setResult(null);
    setCopied(false);
    setLoading(true);
    try {
      const res = await fetch('/api/ai/generate-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode, filePath }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        setError(data.error ?? `Request failed: ${res.status}`);
        return;
      }
      const data = await res.json() as GeneratedTest;
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.testCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-lg font-semibold">AI Test Generator</h2>
      <div className="flex flex-col gap-2">
        <label htmlFor="file-path" className="text-sm font-medium">
          File Path
        </label>
        <input
          id="file-path"
          type="text"
          value={filePath}
          onChange={(e) => setFilePath(e.target.value)}
          placeholder="src/services/my-service.ts"
          className="rounded border px-3 py-2 text-sm"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="source-code" className="text-sm font-medium">
          Source Code
        </label>
        <textarea
          id="source-code"
          value={sourceCode}
          onChange={(e) => setSourceCode(e.target.value)}
          placeholder="Paste your TypeScript source code here..."
          rows={10}
          className="rounded border px-3 py-2 font-mono text-sm"
        />
      </div>
      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading || !sourceCode.trim() || !filePath.trim()}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Generating...' : 'Generate Tests'}
      </button>
      {error && (
        <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {result && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              Generated: {result.testFileName} ({result.functionsAnalyzed.length} functions analyzed)
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
            >
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
          <pre className="overflow-auto rounded border bg-gray-50 p-3 font-mono text-xs">
            <code>{result.testCode}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
