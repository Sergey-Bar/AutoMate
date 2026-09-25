import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { SettingsSection, SettingRow } from './SettingsSection';

const PROVIDER_OPTIONS = [
  { value: 'ollama', label: 'Ollama (Local)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google (Gemini)' },
  { value: 'azure-openai', label: 'Azure OpenAI' },
  { value: 'groq', label: 'Groq' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'bedrock', label: 'AWS Bedrock' }
];

type FieldConfig = {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'password' | 'url';
  placeholder?: string;
  required: boolean;
};

const PROVIDER_FIELDS: Record<string, FieldConfig[]> = {
  ollama: [
    { key: 'model', label: 'Model', description: 'Model name (e.g. llama3)', type: 'text', placeholder: 'llama3', required: true },
    { key: 'baseUrl', label: 'Endpoint URL', description: 'Local Ollama URL', type: 'url', placeholder: 'http://localhost:11434', required: false },
  ],
  openai: [
    { key: 'model', label: 'Model', description: 'Model name (e.g. gpt-4o)', type: 'text', placeholder: 'gpt-4o', required: true },
    { key: 'apiKey', label: 'API Key', description: 'Authentication key for OpenAI', type: 'password', required: true },
    { key: 'baseUrl', label: 'Endpoint URL', description: 'Optional custom endpoint', type: 'url', placeholder: 'https://api.openai.com/v1/chat/completions', required: false },
  ],
  anthropic: [
    { key: 'model', label: 'Model', description: 'Model name (e.g. claude-3-sonnet)', type: 'text', placeholder: 'claude-3-sonnet', required: true },
    { key: 'apiKey', label: 'API Key', description: 'Authentication key for Anthropic', type: 'password', required: true },
  ],
  google: [
    { key: 'model', label: 'Model', description: 'Model name (e.g. gemini-1.5-pro)', type: 'text', placeholder: 'gemini-1.5-pro', required: true },
    { key: 'apiKey', label: 'API Key', description: 'Authentication key for Google Gemini', type: 'password', required: true },
  ],
  'azure-openai': [
    { key: 'model', label: 'Model', description: 'Model name', type: 'text', placeholder: 'gpt-4o', required: true },
    { key: 'apiKey', label: 'API Key', description: 'Authentication key for Azure', type: 'password', required: true },
    { key: 'baseUrl', label: 'Endpoint URL', description: 'Azure resource endpoint', type: 'url', placeholder: 'https://<resource>.openai.azure.com', required: true },
    { key: 'apiVersion', label: 'API Version', description: 'Azure API version', type: 'text', placeholder: '2024-02-01', required: true },
  ],
  groq: [
    { key: 'model', label: 'Model', description: 'Model name', type: 'text', placeholder: 'llama3-70b-8192', required: true },
    { key: 'apiKey', label: 'API Key', description: 'Authentication key for Groq', type: 'password', required: true },
  ],
  mistral: [
    { key: 'model', label: 'Model', description: 'Model name', type: 'text', placeholder: 'mistral-large-latest', required: true },
    { key: 'apiKey', label: 'API Key', description: 'Authentication key for Mistral', type: 'password', required: true },
  ],
  openrouter: [
    { key: 'model', label: 'Model', description: 'Model name', type: 'text', placeholder: 'openai/gpt-4o', required: true },
    { key: 'apiKey', label: 'API Key', description: 'Authentication key for OpenRouter', type: 'password', required: true },
  ],
  cohere: [
    { key: 'model', label: 'Model', description: 'Model name', type: 'text', placeholder: 'command-r-plus', required: true },
    { key: 'apiKey', label: 'API Key', description: 'Authentication key for Cohere', type: 'password', required: true },
  ],
  bedrock: [
    { key: 'model', label: 'Model', description: 'Model name', type: 'text', placeholder: 'anthropic.claude-3-sonnet-20240229-v1:0', required: true },
    { key: 'accessKeyId', label: 'Access Key ID', description: 'AWS access key', type: 'text', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', description: 'AWS secret key', type: 'password', required: true },
    { key: 'region', label: 'Region', description: 'AWS region', type: 'text', placeholder: 'us-east-1', required: true },
    { key: 'sessionToken', label: 'Session Token', description: 'Optional STS token', type: 'password', required: false },
  ]
};

export function AISettings() {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<Record<string, string>>({ provider: 'openai' });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [dualAgentRca, setDualAgentRca] = useState(false);

  const { data: config } = useQuery<Record<string, string>>({
    queryKey: ['ai-config'],
    queryFn: async () => {
      const res = await fetch('/api/ai/config');
      if (!res.ok) return null;
      return res.json();
    },
  });

  useEffect(() => {
    if (config) {
      const initialData: Record<string, string> = {};
      for (const [k, v] of Object.entries(config)) {
        if (k !== 'apiKey' && k !== 'secretAccessKey') {
          initialData[k] = v as string;
        }
      }
      setFormData((prev) => ({ ...prev, ...initialData }));
      setDualAgentRca(String(config['dualAgentRca']) === 'true');
    }
  }, [config]);

  const save = useMutation({
    mutationFn: () => {
      const provider = formData.provider ?? 'openai';
      const payload: Record<string, string> = { provider };
      const fields = PROVIDER_FIELDS[provider] ?? [];
      
      for (const field of fields) {
        const val = formData[field.key];
        
        if (val !== undefined && val !== '') {
          payload[field.key] = val;
        } else if (config && config.provider === provider) {
          const configVal = config[field.key];
          if (configVal) {
            payload[field.key] = configVal;
          }
        }
      }

      return fetch('/api/ai/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, dualAgentRca }),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to save');
        return r.json();
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-config'] });
      toast.success('AI configuration saved');
    },
    onError: () => toast.error('Failed to save AI config'),
  });

  const testAi = useMutation({
    mutationFn: () =>
      fetch('/api/ai/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Test error: expect(received).toBe(expected) — Expected: true, Received: false' }),
      }).then(async (r) => {
        if (!r.ok) {
          const err = await r.json() as { error: string };
          throw new Error(err.error);
        }
        return r.json() as Promise<{ summary: string; suggestion: string; confidence: number }>;
      }),
    onSuccess: (data) => {
      setTestResult(data.summary);
      toast.success('AI connection works!');
    },
    onError: (err) => {
      setTestResult(null);
      toast.error(err instanceof Error ? err.message : 'AI test failed');
    },
  });

  return (
    <SettingsSection title="AI Configuration">
      <div className="px-4 py-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={14} className="text-accent" />
          <p className="text-sm font-medium text-text-primary">AI Failure Analysis</p>
        </div>
        <p className="text-[11px] mb-3 text-text-tertiary">
          Configure an AI provider to explain test failures. Supports OpenAI, Ollama, Anthropic, Google, Azure, and more.
        </p>
      </div>

      <SettingRow label="Provider *" description="LLM provider to use">
        <Select
          size="sm"
          value={formData.provider}
          onChange={(e) => setFormData((prev) => ({ ...prev, provider: e.target.value }))}
          options={PROVIDER_OPTIONS}
        />
      </SettingRow>

      {(PROVIDER_FIELDS[formData.provider ?? 'openai'] ?? []).map((field: FieldConfig) => {
        const configVal = config?.[field.key];
        const isSecret = field.type === 'password' || field.key === 'apiKey' || field.key === 'secretAccessKey';
        const showConfigPlaceholder = config?.provider === (formData.provider ?? 'openai') && configVal && isSecret;
        return (
          <SettingRow 
            key={field.key} 
            label={field.required ? `${field.label} *` : field.label} 
            description={field.description}
          >
            <Input
              size="sm"
              type={field.type}
              value={formData[field.key] ?? ''}
              onChange={(e) => setFormData((prev) => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={showConfigPlaceholder ? configVal : field.placeholder}
              className={field.type === 'url' || field.key.toLowerCase().includes('key') ? 'font-mono' : ''}
              style={{ width: field.type === 'url' ? '18rem' : '12rem' }}
            />
          </SettingRow>
        );
      })}

      <SettingRow label="Dual-Agent RCA" description="Enable Critic pass to validate AI diagnosis (slower but more accurate)">
        <input
          type="checkbox"
          id="dual-agent-rca"
          checked={dualAgentRca}
          onChange={(e) => setDualAgentRca(e.target.checked)}
          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-indigo-600"
        />
      </SettingRow>

      <div className="flex items-center gap-2 px-4 py-3">
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" size="sm" icon={<Send size={11} />} loading={testAi.isPending} onClick={() => testAi.mutate()}>
          {testAi.isPending ? 'Testing…' : 'Test'}
        </Button>
      </div>

      {testResult && (
        <div className="px-4 py-2 border-t border-border-subtle">
          <p className="text-xs text-text-secondary">
            <strong>AI Response:</strong> {testResult}
          </p>
        </div>
      )}
    </SettingsSection>
  );
}
