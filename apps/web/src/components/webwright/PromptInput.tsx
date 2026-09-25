import React, { useState } from 'react';
import { Button } from '@automate/ui';

export interface PromptInputProps {
  onSubmit: (prompt: string) => void;
  isLoading?: boolean;
}

export function PromptInput({ onSubmit, isLoading = false }: PromptInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSubmit();
    }
  };

  return (
    <div data-testid="prompt-input" className="flex flex-col gap-2">
      <textarea
        data-testid="prompt-textarea"
        className="w-full min-h-[100px] p-3 rounded-md border border-border-default bg-bg-elevated text-text-primary resize-y focus:outline-none focus:ring-2 focus:ring-primary"
        placeholder="Describe what you want the agent to do... (Ctrl+Enter to submit)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isLoading}
        aria-label="Natural language prompt"
      />
      <div className="flex justify-end">
        <Button
          data-testid="prompt-submit"
          onClick={handleSubmit}
          disabled={isLoading || !value.trim()}
        >
          {isLoading ? 'Running...' : 'Run'}
        </Button>
      </div>
    </div>
  );
}
