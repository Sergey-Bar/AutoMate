import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, Badge, Button } from '@automate/ui';

export interface CodegenPanelProps {
  code: string;
  language: string;
}

export function CodegenPanel({ code, language }: CodegenPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card data-testid="codegen-panel">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Generated Code</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" data-testid="language-badge">
              {language}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              data-testid="copy-button"
            >
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <div className="p-4">
        <pre
          data-testid="code-block"
          className={`language-${language} overflow-auto rounded bg-surface-raised p-4 text-sm font-mono`}
        >
          <code className={`language-${language}`}>{code}</code>
        </pre>
      </div>
    </Card>
  );
}
