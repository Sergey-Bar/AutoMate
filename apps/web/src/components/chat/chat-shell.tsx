import {
  Conversation,
  Message,
  PromptInput,
  Shimmer,
  ToolApproval,
  ToolResult,
  AnimatedList,
} from '@/components/ai-elements/index.js';
import { useAutomateChat } from '@/hooks/use-automate-chat.js';
import { Button } from '@/components/ui/Button';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { EmptyState } from '@/components/shared/EmptyState';
import { CrossProductLink } from '@/components/shared/CrossProductLink.js';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { RefreshCw, MessageSquare } from 'lucide-react';
import { motion } from 'framer-motion';
import { reducedMotionSafe, fadeSlideUp } from '@/lib/motion';

const STARTER_PROMPTS = [
  {
    title: 'Triage failing run',
    prompt: 'Summarize the latest failed Playwright run, group failures by likely root cause, and suggest the first fix to try.',
  },
  {
    title: 'Create regression plan',
    prompt: 'Create a focused regression plan for the riskiest user journeys before release.',
  },
  {
    title: 'Check integration health',
    prompt: 'Check GitHub, Jira, Slack, and dashboard connector readiness, then tell me what needs setup.',
  },
];

function getMessageText(message: { parts?: Array<{ type: string; text?: string }> }): string {
  if (!message.parts) return '';
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

interface ToolApprovalPart {
  type: string;
  state?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  approval?: { id: string };
}

function getDashboardRunId(toolName: string, output: unknown): string | null {
  if (typeof output !== 'object' || output === null) return null;

  const record = output as Record<string, unknown>;
  const directRunId = typeof record.runId === 'string' ? record.runId : typeof record.run_id === 'string' ? record.run_id : null;
  if (directRunId) return directRunId;

  if (toolName.toLowerCase().includes('dashboard') && toolName.toLowerCase().includes('triggertestrun')) {
    const candidate = record.runId ?? record.run_id ?? record.id;
    return typeof candidate === 'string' ? candidate : null;
  }

  return null;
}

function getRunIdFromText(text: string): string | null {
  const match = /Run ID:\s*([A-Za-z0-9_-]+)/i.exec(text);
  return match?.[1] ?? null;
}

function getContextualLink(message: { parts?: Array<{ type: string; text?: string }> }) {
  const text = getMessageText(message);
  const runId = getRunIdFromText(text);

  if (runId) {
    return <CrossProductLink targetApp="dashboard" path={`/runs/${runId}`} label="View in Dashboard" className="inline-flex items-center gap-1 text-sm text-text-link hover:underline" />;
  }

  return null;
}

function isToolApprovalPart(part: unknown): part is ToolApprovalPart {
  if (typeof part !== 'object' || part === null) return false;
  const p = part as Record<string, unknown>;
  return typeof p.type === 'string' && p.type.startsWith('tool-');
}

function ChatContent({ conversationId }: { conversationId?: string }) {
  const { messages, sendMessage, isLoading, error, regenerate, addToolApprovalResponse } = useAutomateChat(conversationId);

  const handleSubmit = (text: string) => {
    if (text.trim()) {
      sendMessage({ text });
    }
  };

  const handleStarterPrompt = (prompt: string) => {
    if (!isLoading && error == null) {
      sendMessage({ text: prompt });
    }
  };

  const handleRetry = () => {
    regenerate();
  };

  const handleApprove = (approvalId: string) => {
    addToolApprovalResponse({ id: approvalId, approved: true });
  };

  const handleDeny = (approvalId: string) => {
    addToolApprovalResponse({ id: approvalId, approved: false });
  };

  const renderToolPart = (part: ToolApprovalPart) => {
    const toolName = part.type.replace('tool-', '');
    const inputSummary = part.input && typeof part.input === 'object' && part.input !== null
      ? JSON.stringify(part.input, null, 2)
      : '';

    switch (part.state) {
      case 'approval-requested':
        return (
          <ToolApproval
            key={part.toolCallId}
            toolName={toolName}
            input={inputSummary}
            onApprove={() => handleApprove(part.approval!.id)}
            onDeny={() => handleDeny(part.approval!.id)}
          />
        );
      case 'output-available': {
        const runId = getDashboardRunId(toolName, part.output);
        const outputText = typeof part.output === 'string' ? part.output : JSON.stringify(part.output, null, 2);

        return (
          <div key={part.toolCallId} className="space-y-2">
            <ToolResult
              toolName={toolName}
              output={outputText}
              success={true}
            />
            {runId && (
              <CrossProductLink
                targetApp="dashboard"
                path={`/runs/${runId}`}
                label="View in Dashboard"
                className="inline-flex items-center gap-1 text-sm text-text-link hover:underline"
              />
            )}
          </div>
        );
      }
      case 'output-denied':
        return (
          <ToolResult
            key={part.toolCallId}
            toolName={toolName}
            output="Request denied by user"
            success={false}
          />
        );
      default:
        return null;
    }
  };

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full bg-bg-base">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border-subtle glass-panel">
        <div className="flex items-center gap-3">
          <MessageSquare size={20} className="text-primary" />
          <h1 className="text-lg font-semibold text-text-primary">Automate</h1>
        </div>
        <ThemeToggle />
      </header>

      {/* Messages area */}
      <div className="flex-1 overflow-hidden">
        {!hasMessages ? (
          <div className="flex items-center justify-center h-full p-4">
            <div className="w-full max-w-3xl space-y-6">
              <EmptyState
                illustration="chat"
                title="No conversations yet"
                description="Start faster with a QA workflow prompt, or ask Automate anything."
              />
              <div role="group" className="grid gap-3 sm:grid-cols-3" aria-label="Starter prompts">
                {STARTER_PROMPTS.map((starter) => (
                  <button
                    key={starter.title}
                    type="button"
                    onClick={() => handleStarterPrompt(starter.prompt)}
                    disabled={isLoading || error != null}
                    className="group rounded-2xl border border-border-subtle bg-bg-surface/70 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="block text-sm font-semibold text-text-primary group-hover:text-primary">
                      {starter.title}
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-text-secondary">
                      {starter.prompt}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <Conversation className="h-full">
            <AnimatedList>
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  variants={reducedMotionSafe(fadeSlideUp)}
                  initial="hidden"
                  animate="visible"
                  className="space-y-2"
                >
                  <Message messageRole={m.role}>
                    {getMessageText(m)}
                  </Message>
                  {getContextualLink(m)}
                  {m.parts?.filter(isToolApprovalPart).map((part) => renderToolPart(part))}
                </motion.div>
              ))}
            </AnimatedList>
            {isLoading && <Shimmer />}
            {error && (
              <motion.div
                variants={reducedMotionSafe(fadeSlideUp)}
                initial="hidden"
                animate="visible"
                className="flex flex-col items-center gap-3 py-4"
              >
                <Message messageRole="system">
                  Something went wrong. Please try again.
                </Message>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCw size={14} />}
                  onClick={handleRetry}
                  aria-label="Retry last message"
                >
                  Retry
                </Button>
              </motion.div>
            )}
          </Conversation>
        )}
      </div>

      {/* Input area */}
      <div className="p-4 border-t border-border-subtle glass-panel">
        <PromptInput
          placeholder="Ask Automate anything..."
          onSubmit={handleSubmit}
          disabled={isLoading || error != null}
        />
      </div>
    </div>
  );
}

export function ChatShell({ conversationId }: { conversationId?: string } = {}) {
  return (
    <ErrorBoundary label="Chat">
      <ChatContent conversationId={conversationId} />
    </ErrorBoundary>
  );
}
