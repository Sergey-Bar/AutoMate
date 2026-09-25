/**
 * WebhookConfig.tsx — Manage generic webhook integrations
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { safeMotion, fadeSlideUp } from '@/lib/motion';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface Webhook {
  url: string;
  events: string[];
}

const AVAILABLE_EVENTS = ['run:start', 'run:end', 'test:fail', 'gate:fail'] as const;

export function WebhookConfig() {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [testingIndex, setTestingIndex] = useState<number | null>(null);

  // Fetch webhooks
  const { data: webhooks = [] } = useQuery<Webhook[]>({
    queryKey: ['webhooks'],
    queryFn: async () => {
      const res = await fetch('/api/integrations/webhooks');
      if (!res.ok) throw new Error('Failed to fetch webhooks');
      return res.json();
    },
  });

  // Add webhook
  const addMutation = useMutation({
    mutationFn: async (webhook: Webhook) => {
      const res = await fetch('/api/integrations/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhook),
      });
      if (!res.ok) throw new Error('Failed to add webhook');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      setUrl('');
      setSelectedEvents([]);
    },
  });

  // Delete webhook
  const deleteMutation = useMutation({
    mutationFn: async (index: number) => {
      const res = await fetch(`/api/integrations/webhooks/${index}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete webhook');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  // Test webhook
  const testMutation = useMutation({
    mutationFn: async ({ url, index }: { url: string; index: number }) => {
      setTestingIndex(index);
      const res = await fetch('/api/integrations/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error('Test failed');
      return res.json();
    },
    onSuccess: () => {
      setTestingIndex(null);
    },
    onError: () => {
      setTestingIndex(null);
    },
  });

  const handleAdd = () => {
    if (!url || selectedEvents.length === 0) return;
    addMutation.mutate({ url, events: selectedEvents });
  };

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  return (
    <div style={{ padding: 'var(--space-6)' }}>
      <h2
        style={{
          fontSize: 'var(--font-size-lg)',
          fontWeight: 'var(--font-weight-semibold)',
          color: 'var(--color-text-primary)',
          marginBottom: 'var(--space-4)',
        }}
      >
        Generic Webhooks
      </h2>

      {/* Add webhook form */}
      <div
        style={{
          padding: 'var(--space-4)',
          backgroundColor: 'var(--color-bg-surface)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <label
          style={{
            display: 'block',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-2)',
          }}
        >
          Webhook URL
        </label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-webhook-endpoint.com/hook"
          style={{
            width: '100%',
            padding: 'var(--space-2)',
            backgroundColor: 'var(--color-bg-base)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-default)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-sm)',
            marginBottom: 'var(--space-4)',
          }}
        />

        <label
          style={{
            display: 'block',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-2)',
          }}
        >
          Events
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          {AVAILABLE_EVENTS.map((event) => (
            <button
              key={event}
              onClick={() => toggleEvent(event)}
              style={{
                padding: 'var(--space-2) var(--space-3)',
                fontSize: 'var(--font-size-xs)',
                backgroundColor: selectedEvents.includes(event)
                  ? 'var(--color-running)'
                  : 'var(--color-bg-elevated)',
                color: selectedEvents.includes(event)
                  ? '#fff'
                  : 'var(--color-text-secondary)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
              }}
            >
              {event}
            </button>
          ))}
        </div>

        <button
          onClick={handleAdd}
          disabled={addMutation.isPending || !url || selectedEvents.length === 0}
          style={{
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor: 'var(--color-running)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-sm)',
            cursor: 'pointer',
            opacity: !url || selectedEvents.length === 0 ? 0.5 : 1,
          }}
        >
          {addMutation.isPending ? 'Adding...' : 'Add Webhook'}
        </button>
      </div>

      {/* Webhook list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {webhooks.map((webhook, index) => (
          <motion.div
            key={`${webhook.url}-${index}`}
            variants={safeMotion(fadeSlideUp) as import('framer-motion').Variants}
            initial="hidden"
            animate="visible"
            style={{
              padding: 'var(--space-4)',
              backgroundColor: 'var(--color-bg-surface)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border-default)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-primary)',
                    fontFamily: 'var(--font-mono)',
                    marginBottom: 'var(--space-2)',
                    wordBreak: 'break-all',
                  }}
                >
                  {webhook.url.length > 60 ? webhook.url.slice(0, 60) + '...' : webhook.url}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {webhook.events.map((event) => (
                    <span
                      key={event}
                      style={{
                        padding: 'var(--space-1) var(--space-2)',
                        fontSize: 'var(--font-size-xs)',
                        backgroundColor: 'var(--color-bg-elevated)',
                        color: 'var(--color-text-secondary)',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {event}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'var(--space-4)' }}>
                <button
                  onClick={() => testMutation.mutate({ url: webhook.url, index })}
                  disabled={testingIndex === index}
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    fontSize: 'var(--font-size-xs)',
                    backgroundColor: 'var(--color-bg-elevated)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  {testingIndex === index ? 'Testing...' : 'Test'}
                </button>
                <button
                  onClick={() => deleteMutation.mutate(index)}
                  disabled={deleteMutation.isPending}
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    fontSize: 'var(--font-size-xs)',
                    backgroundColor: 'var(--color-fail)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {webhooks.length === 0 && (
        <div
          style={{
            padding: 'var(--space-6)',
            textAlign: 'center',
            color: 'var(--color-text-tertiary)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          No webhooks configured
        </div>
      )}
    </div>
  );
}
