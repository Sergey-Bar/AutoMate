import { Tool } from '@/components/ai-elements/index.js';

export function ToolPart({
  name,
  state,
}: {
  name: string;
  state: 'partial-call' | 'call' | 'result';
}) {
  return (
    <Tool>
      <div>{name}</div>
      <div>{state}</div>
    </Tool>
  );
}
