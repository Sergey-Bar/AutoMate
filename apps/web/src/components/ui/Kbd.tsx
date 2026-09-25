import type { ReactNode } from 'react';

interface KbdProps {
  children?: ReactNode;
  keys?: string[];
}

export function Kbd({ children, keys }: KbdProps) {
  if (keys) {
    return (
      <span className="inline-flex items-center gap-0.5">
        {keys.map((key, i) => (
          <span key={i}>
            <KeyCap>{key}</KeyCap>
            {i < keys.length - 1 && (
              <span className="text-[10px] mx-0.5 text-text-tertiary">+</span>
            )}
          </span>
        ))}
      </span>
    );
  }

  return <KeyCap>{children}</KeyCap>;
}

function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded text-[10px] font-mono font-medium border border-border-default leading-none bg-bg-elevated text-text-tertiary"
      style={{
        boxShadow: '0 1px 0 var(--color-border-subtle)',
      }}
    >
      {children}
    </kbd>
  );
}
