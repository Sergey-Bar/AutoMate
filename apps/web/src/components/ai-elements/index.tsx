import type { ReactNode, FormEvent } from 'react';
import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { reducedMotionSafe, messageBubble, spring } from '@/lib/motion';
import { Button } from '@/components/ui/Button';

// ─── Conversation Container ────────────────────────────────────────────────

interface ConversationProps {
  children?: ReactNode;
  className?: string;
}

export function Conversation({ children, className }: ConversationProps) {
  return (
    <div
      data-testid="conversation"
      className={cn(
        'flex flex-col h-full overflow-y-auto',
        'px-4 py-6 space-y-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────────────

interface MessageProps {
  children?: ReactNode;
  messageRole: 'user' | 'assistant' | 'system' | string;
  className?: string;
}

export function Message({ children, messageRole, className }: MessageProps) {
  const isUser = messageRole === 'user';
  const isSystem = messageRole === 'system';

  return (
    <motion.div
      data-testid="message"
      data-role={messageRole}
      variants={reducedMotionSafe(messageBubble)}
      initial="hidden"
      animate="visible"
      className={cn(
        'max-w-[85%] px-4 py-3',
        isUser && 'message-user ml-auto',
        !isUser && !isSystem && 'message-assistant',
        isSystem && 'text-center text-text-secondary text-sm mx-auto bg-transparent',
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

// ─── Prompt Input ──────────────────────────────────────────────────────────

interface PromptInputProps {
  placeholder?: string;
  onSubmit?: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function PromptInput({
  placeholder = 'Type a message...',
  onSubmit,
  disabled,
  className,
}: PromptInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
    }
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && onSubmit) {
      onSubmit(value.trim());
      setValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'flex items-end gap-2 p-3 glass-panel rounded-2xl border border-border-subtle',
        className,
      )}
    >
      <textarea
        ref={inputRef}
        data-testid="prompt-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (inputRef.current) {
            inputRef.current.style.height = 'auto';
            inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`;
          }
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        className={cn(
          'flex-1 bg-transparent resize-none outline-none',
          'text-text-primary placeholder:text-text-tertiary',
          'text-sm leading-relaxed',
          'max-h-[200px] min-h-[24px]',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      />
      <Button
        type="submit"
        variant="primary"
        size="sm"
        disabled={disabled || !value.trim()}
        icon={<Send size={14} />}
        className="shrink-0"
      >
        Send
      </Button>
    </form>
  );
}

// ─── Tool Card ─────────────────────────────────────────────────────────────

interface ToolProps {
  children?: ReactNode;
  status?: 'pending' | 'success' | 'error' | 'default';
  className?: string;
}

export function Tool({ children, status = 'default', className }: ToolProps) {
  return (
    <motion.div
      data-testid="tool"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={spring.smooth}
      className={cn(
        'tool-card overflow-hidden',
        status === 'pending' && 'tool-card-pending',
        status === 'success' && 'tool-card-success',
        status === 'error' && 'tool-card-error',
        className,
      )}
    >
      <div className="p-3">{children}</div>
    </motion.div>
  );
}

// ─── Tool Approval Card ────────────────────────────────────────────────────

interface ToolApprovalProps {
  toolName: string;
  input?: string;
  onApprove: () => void;
  onDeny: () => void;
}

export function ToolApproval({ toolName, input, onApprove, onDeny }: ToolApprovalProps) {
  return (
    <Tool status="pending">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-warning animate-pulse" />
          <span className="text-sm font-medium text-text-primary">
            Tool Request: {toolName}
          </span>
        </div>
        {input && (
          <pre className="text-xs text-text-secondary bg-bg-surface rounded-lg p-2 overflow-x-auto">
            {input}
          </pre>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={onApprove}
            aria-label={`Approve ${toolName}`}
          >
            Approve
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDeny}
            aria-label={`Deny ${toolName}`}
          >
            Deny
          </Button>
        </div>
      </div>
    </Tool>
  );
}

// ─── Tool Result Card ──────────────────────────────────────────────────────

interface ToolResultProps {
  toolName: string;
  output: string;
  success?: boolean;
}

export function ToolResult({ toolName, output, success = true }: ToolResultProps) {
  return (
    <Tool status={success ? 'success' : 'error'}>
      <div className="space-y-2">
        <span className="text-sm font-medium text-text-primary">{toolName}</span>
        <pre className="text-xs text-text-secondary bg-bg-surface rounded-lg p-2 overflow-x-auto">
          {output}
        </pre>
      </div>
    </Tool>
  );
}

// ─── Shimmer / Typing Indicator ────────────────────────────────────────────

export function Shimmer() {
  return (
    <div
      data-testid="shimmer"
      className="flex items-center gap-1.5 px-4 py-3 message-assistant w-fit"
    >
      <span className="w-2 h-2 rounded-full bg-text-tertiary typing-dot" />
      <span className="w-2 h-2 rounded-full bg-text-tertiary typing-dot" />
      <span className="w-2 h-2 rounded-full bg-text-tertiary typing-dot" />
    </div>
  );
}

// ─── Animated List (for message lists) ─────────────────────────────────────

interface AnimatedListProps {
  children: ReactNode;
}

export function AnimatedList({ children }: AnimatedListProps) {
  return (
    <AnimatePresence mode="popLayout">
      {children}
    </AnimatePresence>
  );
}
