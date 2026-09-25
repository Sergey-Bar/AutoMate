import React, { useState, useCallback } from 'react';
import { useAIGenerate } from '../hooks/useAIGenerate.js';

export function NLTestGenerator() {
  const [prompt, setPrompt] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const { status, result, error, generate, reset } = useAIGenerate();

  const isLoading = status === 'loading';

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    await generate(prompt, targetUrl);
  }, [prompt, targetUrl, generate]);

  const handleCopy = useCallback(async () => {
    if (!result?.code) return;
    await navigator.clipboard.writeText(result.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  const handleRunTest = useCallback(() => {
    alert('Run Test: feature coming soon!');
  }, []);

  const handleReset = useCallback(() => {
    setPrompt('');
    setTargetUrl('');
    reset();
  }, [reset]);

  return (
    <div
      style={{
        display: 'flex',
        gap: 24,
        height: '100%',
        minHeight: 480,
      }}
    >
      {/* Left panel — NL input */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div>
          <label
            htmlFor="nl-prompt"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            Describe the test in natural language
          </label>
          <textarea
            id="nl-prompt"
            placeholder="e.g., Navigate to the login page, enter valid credentials, and verify the dashboard loads"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && e.ctrlKey) void handleGenerate();
            }}
            rows={8}
            style={{ width: '100%', padding: 8, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </div>

        <div>
          <label
            htmlFor="target-url"
            style={{ display: 'block', marginBottom: 4, fontWeight: 600 }}
          >
            Target URL (optional)
          </label>
          <input
            id="target-url"
            type="text"
            placeholder="https://example.com"
            value={targetUrl}
            onChange={e => setTargetUrl(e.target.value)}
            style={{ width: '100%', padding: 8, fontFamily: 'inherit' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            id="generate-btn"
            onClick={handleGenerate}
            disabled={isLoading || !prompt.trim()}
            style={{ padding: '8px 24px', fontWeight: 600 }}
          >
            {isLoading ? 'Generating...' : 'Generate'}
          </button>

          {(result ?? error) && (
            <button
              type="button"
              onClick={handleReset}
              style={{ padding: '8px 16px' }}
            >
              Reset
            </button>
          )}
        </div>

        <p style={{ fontSize: 12, color: '#999' }}>Ctrl+Enter to generate</p>

        {error && (
          <p role="alert" style={{ color: '#c00', fontSize: 14 }}>
            Error: {error}
          </p>
        )}
      </div>

      {/* Right panel — generated code */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: '#f8f8f8',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Generated Test</h2>
          {result && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                id="copy-btn"
                onClick={handleCopy}
                style={{ padding: '4px 12px', fontSize: 13 }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                type="button"
                id="run-test-btn"
                onClick={handleRunTest}
                style={{ padding: '4px 12px', fontSize: 13, fontWeight: 600 }}
              >
                Run Test
              </button>
            </div>
          )}
        </div>

        {!result && !isLoading && (
          <p style={{ color: '#999', fontSize: 14 }}>
            Generated Playwright test code will appear here.
          </p>
        )}

        {isLoading && (
          <p style={{ color: '#666', fontSize: 14 }}>Generating test…</p>
        )}

        {result && (
          <>
            <pre
              style={{
                background: '#1e1e1e',
                color: '#d4d4d4',
                padding: 16,
                borderRadius: 6,
                overflow: 'auto',
                flex: 1,
                fontSize: 13,
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              <code>{result.code}</code>
            </pre>

            {result.explanation && (
              <div style={{ fontSize: 14, color: '#444', marginTop: 8 }}>
                <strong>Explanation:</strong>
                <p style={{ margin: '4px 0 0' }}>{result.explanation}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default NLTestGenerator;
