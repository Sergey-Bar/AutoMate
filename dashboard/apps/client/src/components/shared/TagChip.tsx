interface TagChipProps {
  tag: string;
  onClick?: () => void;
  active?: boolean;
  /** Render as 'button' (default) or 'span' to avoid button-in-button nesting */
  as?: 'button' | 'span';
}

const TAG_COLORS: Record<string, string> = {
  smoke:    'var(--color-chart-1)',
  critical: 'var(--color-fail)',
  slow:     'var(--color-flaky)',
  flaky:    'var(--color-flaky)',
  wip:      'var(--color-text-tertiary)',
};

function tagColor(tag: string): string {
  const cleaned = tag.replace(/^@/, '').toLowerCase();
  return TAG_COLORS[cleaned] ?? 'var(--color-text-secondary)';
}

export function TagChip({ tag, onClick, active, as: Component = 'button' }: TagChipProps) {
  const cleaned = tag.startsWith('@') ? tag : `@${tag}`;
  const color = tagColor(tag);

  return (
    <Component
      onClick={onClick}
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border transition-colors"
      style={{
        color: active ? '#fff' : color,
        background: active ? color : `${color}1a`,
        borderColor: `${color}40`,
        cursor: onClick ? 'pointer' : 'default',
      }}
      aria-pressed={active}
    >
      {cleaned}
    </Component>
  );
}
