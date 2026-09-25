import { Tree, type NodeRendererProps } from 'react-arborist';
import type { Step } from '@/lib/types';
import { formatDuration } from '@/lib/formatters';
import { ChevronRight, AlertCircle, CheckCircle2, Loader2, Info } from 'lucide-react';

interface StepNode extends Step {
  id: string;
  children?: StepNode[];
}

function toStepNodes(steps: Step[]): StepNode[] {
  return steps.map((s, i) => ({
    ...s,
    id: `${i}-${s.title}`,
    children: s.steps ? toStepNodes(s.steps) : undefined,
  }));
}

function StepNodeRow({ node, style, dragHandle }: NodeRendererProps<StepNode>) {
  const data = node.data;
  const icon = data.error
    ? <AlertCircle size={12} className="text-fail" />
    : data.durationMs == null
    ? <Loader2 size={12} className="animate-spin text-text-tertiary" />
    : <CheckCircle2 size={12} className="text-pass" />;

  return (
    <div
      ref={dragHandle}
      style={style}
      className="flex items-center gap-1.5 px-2 py-0.5 text-xs rounded hover:bg-bg-elevated cursor-default select-none"
    >
      {node.isInternal ? (
        <ChevronRight
          size={12}
          className="shrink-0 transition-transform text-text-tertiary"
          style={{
            transform: node.isOpen ? 'rotate(90deg)' : 'none',
          }}
          onClick={() => node.toggle()}
        />
      ) : (
        <span className="w-3" />
      )}
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate text-text-primary">
        {data.title}
      </span>
      {data.durationMs != null && (
        <span className="tabular shrink-0 text-text-tertiary">
          {formatDuration(data.durationMs)}
        </span>
      )}
    </div>
  );
}

interface StepTreeProps {
  steps: Step[];
  height?: number;
}

export function StepTree({ steps, height = 400 }: StepTreeProps) {
  const data = toStepNodes(steps);

  if (!data.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-text-tertiary">
        <Info size={18} />
        <p className="text-xs">No steps recorded</p>
      </div>
    );
  }

  return (
    <Tree
      data={data}
      openByDefault
      width="100%"
      height={height}
      rowHeight={24}
      indent={16}
    >
      {StepNodeRow}
    </Tree>
  );
}
