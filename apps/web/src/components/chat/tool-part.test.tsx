import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ToolPart } from './tool-part.js';

describe('ToolPart', () => {
  it('renders tool name and state', () => {
    const html = renderToString(<ToolPart name="github.create_issue" state="call" />);
    expect(html).toContain('github.create_issue');
    expect(html).toContain('call');
  });
});
