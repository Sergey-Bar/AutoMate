import { useMemo } from 'react';
import { Tree, type NodeRendererProps } from 'react-arborist';
import { AnimatePresence } from 'framer-motion';
import type { TestWithResults as Test } from '@/lib/types';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { formatDuration, shortPath } from '@/lib/formatters';
import { ChevronRight, Folder, FileCode } from 'lucide-react';
import { useRunTests } from '@/hooks/useRun';
import { cn } from '@/lib/utils';

type GroupBy = 'file' | 'suite' | 'status' | 'worker';

interface TestTreeNode {
  id: string;
  name: string;
  type: 'group' | 'test';
  test?: Test;
  children?: TestTreeNode[];
}

function groupTests(tests: Test[], by: GroupBy): TestTreeNode[] {
  const groups = new Map<string, Test[]>();

  for (const t of tests) {
    let key: string;
    switch (by) {
      case 'file':
        key = shortPath(t.file);
        break;
      case 'suite':
        key = t.suite ?? '(root)';
        break;
      case 'status':
        key = t.status;
        break;
      case 'worker':
        key = t.workerIndex != null ? `Worker ${t.workerIndex}` : 'Unknown';
        break;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  return [...groups.entries()].map(([label, children]) => ({
    id: `group-${label}`,
    name: `${label} (${children.length})`,
    type: 'group',
    children: children.map((t) => ({
      id: t.id,
      name: t.title,
      type: 'test',
      test: t,
    })),
  }));
}

interface NodeProps extends NodeRendererProps<TestTreeNode> {
  selectedId?: string;
  onSelect: (test: Test) => void;
}

function Node({ node, style, dragHandle, onSelect, selectedId }: NodeProps) {
  const data = node.data;

  const isSelected = data.type === 'test' && data.test?.id === selectedId;

  return (
    <div
      ref={dragHandle}
      style={style}
      className={cn(
        'flex items-center gap-1.5 px-2 py-0.5 text-xs rounded cursor-default hover:bg-bg-elevated select-none border-l-2',
        isSelected ? 'bg-bg-surface-active border-l-border-focus' : 'border-l-transparent',
      )}
      role={data.type === 'group' ? 'treeitem' : undefined}
      aria-expanded={data.type === 'group' ? node.isOpen : undefined}
      onClick={() => {
        if (data.type === 'group') {
          node.toggle();
        } else if (data.test) {
          onSelect(data.test);
        }
      }}
    >
      {data.type === 'group' ? (
        <>
          <ChevronRight
            size={12}
            className="shrink-0 transition-transform text-text-tertiary"
            style={{
              transform: node.isOpen ? 'rotate(90deg)' : 'none',
            }}
          />
          <Folder size={12} className="text-text-tertiary" />
          <span className="text-text-secondary">{data.name}</span>
        </>
      ) : (
        <>
          <span className="w-3" />
          <FileCode size={12} className="text-text-tertiary" />
          {data.test && <StatusBadge status={data.test.status} showLabel={false} />}
          <span className="flex-1 truncate text-text-primary">
            {data.name}
          </span>
          {data.test?.durationMs && (
            <span className="tabular shrink-0 text-text-tertiary">
              {formatDuration(data.test.durationMs)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

interface TestTreeProps {
  runId?: string;
  tests?: Test[];
  groupBy?: GroupBy;
  selectedId?: string;
  onSelect?: (test: Test) => void;
  height?: number;
}

export function TestTree({ runId, tests: testsProp, groupBy = 'file', selectedId, onSelect, height = 600 }: TestTreeProps) {
  const { data: fetchedTests = [] } = useRunTests(runId ?? '');
  const tests = (testsProp ?? fetchedTests) as Test[];
  const handleSelect = onSelect ?? (() => {});
  const data = useMemo(() => groupTests(tests, groupBy), [tests, groupBy]);

  return (
    <AnimatePresence>
      <Tree
        data={data}
        openByDefault
        width="100%"
        height={height}
        rowHeight={26}
        indent={16}
      >
        {(props) => <Node {...props} selectedId={selectedId} onSelect={handleSelect} />}
      </Tree>
    </AnimatePresence>
  );
}
