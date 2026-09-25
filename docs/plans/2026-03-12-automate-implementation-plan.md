# Automate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AI-native QA orchestration platform with chat-based tool chaining via local LLM and MCP connectors.

**Architecture:** Turborepo monorepo with Fastify server, React+Vite frontend using Vercel AI Elements, Drizzle+SQLite database, MCP connector SDK, and Tauri desktop shell. Agent core uses Vercel AI SDK for LLM streaming and multi-step tool calling.

**Tech Stack:** TypeScript, Fastify, React 19, Vite, Vercel AI SDK, AI Elements, Drizzle, better-sqlite3, MCP TypeScript SDK, Tauri v2, Zod, Zustand, TanStack Router, Tailwind CSS 4

---

> Execution discipline: follow @superpowers/test-driven-development for all non-scaffold tasks.

## Phase 1: Project Scaffold

### Task 1: Root Workspace Manifest

**Files:**
- Modify: `pnpm-workspace.yaml`
- Test: `pnpm-workspace.yaml`

**Step 1: Create file with exact contents**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm install`
Expected: workspace packages are detected, lockfile updates succeed.

**Step 3: Commit**

```bash
git add pnpm-workspace.yaml && git commit -m "chore: initialize pnpm workspace for automate monorepo"
```

### Task 2: Root TypeScript Baseline

**Files:**
- Modify: `tsconfig.base.json`
- Test: `tsconfig.base.json`

**Step 1: Create file with exact contents**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  }
}
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm -r typecheck`
Expected: all packages using base config parse successfully.

**Step 3: Commit**

```bash
git add tsconfig.base.json && git commit -m "chore: add strict shared tsconfig baseline"
```

### Task 3: Root ESLint Configuration

**Files:**
- Modify: `.eslintrc.json`
- Test: `.eslintrc.json`

**Step 1: Create file with exact contents**

```json
{
  "parser": "@typescript-eslint/parser",
  "parserOptions": { "ecmaVersion": "latest", "sourceType": "module" },
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "plugins": ["@typescript-eslint"],
  "env": { "node": true, "es2022": true },
  "ignorePatterns": ["dist/", "node_modules/", ".turbo/", "build/"],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    "@typescript-eslint/no-explicit-any": "error",
    "prefer-const": "error"
  }
}
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm lint`
Expected: eslint runs with no config parse errors.

**Step 3: Commit**

```bash
git add .eslintrc.json && git commit -m "chore: add root eslint policy"
```

### Task 4: Root Package Scripts

**Files:**
- Modify: `package.json`
- Test: `package.json`

**Step 1: Create file with exact contents**

```json
{
  "name": "automate",
  "private": true,
  "packageManager": "pnpm@10.6.5",
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "@typescript-eslint/eslint-plugin": "^8.25.0",
    "@typescript-eslint/parser": "^8.25.0",
    "eslint": "^9.21.0",
    "turbo": "^2.4.4",
    "typescript": "^5.8.2"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3", "esbuild"]
  }
}
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm install`
Expected: dependencies install and scripts are available.

**Step 3: Commit**

```bash
git add package.json && git commit -m "chore: add root scripts and toolchain deps"
```

### Task 5: Turbo Pipeline

**Files:**
- Create: `turbo.json`
- Test: `turbo.json`

**Step 1: Create file with exact contents**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", "build/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": { "dependsOn": ["^lint"] },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test": { "dependsOn": ["^test"] }
  }
}
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm build`
Expected: turbo resolves graph and executes build tasks.

**Step 3: Commit**

```bash
git add turbo.json && git commit -m "chore: configure turborepo task graph"
```

### Task 6: Web App Package Scaffold

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/src/main.tsx`
- Test: `apps/web/package.json`

**Step 1: Create file with exact contents**

```json
{
  "name": "@automate/web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint src --ext .ts,.tsx",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.4.1",
    "vite": "^6.2.1",
    "vitest": "^3.0.8"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "types": ["vite/client"] },
  "include": ["src", "vite.config.ts"]
}
```

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <main>Automate</main>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm --filter @automate/web build`
Expected: Vite build succeeds.

**Step 3: Commit**

```bash
git add apps/web/package.json apps/web/tsconfig.json apps/web/src/main.tsx && git commit -m "chore(web): scaffold react vite package"
```

### Task 7: Server Package Scaffold

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/index.ts`
- Test: `apps/server/src/index.ts`

**Step 1: Create file with exact contents**

```json
{
  "name": "@automate/server",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json --outDir dist",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "fastify": "^5.2.1",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "tsx": "^4.19.3",
    "vitest": "^3.0.8"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"]
}
```

```ts
import Fastify from 'fastify';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

await app.listen({ port: 4000, host: '0.0.0.0' });
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm --filter @automate/server build`
Expected: TypeScript server build succeeds.

**Step 3: Commit**

```bash
git add apps/server/package.json apps/server/tsconfig.json apps/server/src/index.ts && git commit -m "chore(server): scaffold fastify package"
```

### Task 8: Desktop Package Scaffold

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Test: `apps/desktop/package.json`

**Step 1: Create file with exact contents**

```json
{
  "name": "@automate/desktop",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "lint": "eslint . --ext .ts"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.2.5"
  }
}
```

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Automate",
  "version": "0.1.0",
  "identifier": "com.automate.app",
  "build": {
    "frontendDist": "../web/dist",
    "devUrl": "http://localhost:5173"
  },
  "app": { "windows": [{ "title": "Automate", "width": 1280, "height": 900 }] }
}
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm --filter @automate/desktop lint`
Expected: desktop package scripts resolve.

**Step 3: Commit**

```bash
git add apps/desktop/package.json apps/desktop/src-tauri/tauri.conf.json && git commit -m "chore(desktop): scaffold tauri shell package"
```

### Task 9: Shared Package Scaffold

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.ts`

**Step 1: Create file with exact contents**

```json
{
  "name": "@automate/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.24.2" }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "noEmit": false },
  "include": ["src"]
}
```

```ts
export const PROJECT_NAME = 'Automate';
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm --filter @automate/shared build`
Expected: shared package emits dist output.

**Step 3: Commit**

```bash
git add packages/shared/package.json packages/shared/tsconfig.json packages/shared/src/index.ts && git commit -m "chore(shared): scaffold shared package"
```

### Task 10: Connector SDK Scaffold

**Files:**
- Create: `packages/connector-sdk/package.json`
- Create: `packages/connector-sdk/tsconfig.json`
- Create: `packages/connector-sdk/src/index.ts`
- Test: `packages/connector-sdk/src/index.ts`

**Step 1: Create file with exact contents**

```json
{
  "name": "@automate/connector-sdk",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.7.0",
    "zod": "^3.24.2"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "noEmit": false },
  "include": ["src"]
}
```

```ts
export * from './types.js';
export * from './base-connector.js';
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm --filter @automate/connector-sdk build`
Expected: connector SDK compiles.

**Step 3: Commit**

```bash
git add packages/connector-sdk/package.json packages/connector-sdk/tsconfig.json packages/connector-sdk/src/index.ts && git commit -m "chore(connector-sdk): scaffold mcp sdk package"
```

### Task 11: Built-in Connectors Workspace Skeleton

**Files:**
- Create: `packages/connectors/github/package.json`
- Create: `packages/connectors/jira/package.json`
- Create: `packages/connectors/slack/package.json`
- Test: `packages/connectors/github/package.json`

**Step 1: Create file with exact contents**

```json
{
  "name": "@automate/connector-github",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": {
    "@automate/connector-sdk": "workspace:*",
    "zod": "^3.24.2"
  }
}
```

```json
{
  "name": "@automate/connector-jira",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": {
    "@automate/connector-sdk": "workspace:*",
    "zod": "^3.24.2"
  }
}
```

```json
{
  "name": "@automate/connector-slack",
  "version": "0.1.0",
  "type": "module",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": {
    "@automate/connector-sdk": "workspace:*",
    "zod": "^3.24.2"
  }
}
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm build`
Expected: connector workspaces are included in turbo graph.

**Step 3: Commit**

```bash
git add packages/connectors/github/package.json packages/connectors/jira/package.json packages/connectors/slack/package.json && git commit -m "chore(connectors): add github jira slack package skeletons"
```

### Task 12: End-to-End Scaffold Validation

**Files:**
- Modify: `package.json`
- Test: `package.json`

**Step 1: Create file with exact contents**

```json
{
  "scripts": {
    "validate": "pnpm install && pnpm build && pnpm typecheck && pnpm lint"
  }
}
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm validate`
Expected: full scaffold pipeline passes.

**Step 3: Commit**

```bash
git add package.json && git commit -m "chore: add workspace validation script"
```

## Phase 2: Shared Package

### Task 13: Conversation Role Schema

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/index.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { MessageRoleSchema } from './index.js';

describe('MessageRoleSchema', () => {
  it('accepts user assistant system tool', () => {
    expect(MessageRoleSchema.parse('user')).toBe('user');
    expect(MessageRoleSchema.parse('assistant')).toBe('assistant');
    expect(MessageRoleSchema.parse('system')).toBe('system');
    expect(MessageRoleSchema.parse('tool')).toBe('tool');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/shared test packages/shared/src/index.test.ts`
Expected: FAIL with "MessageRoleSchema is not exported".

**Step 3: Write minimal implementation**

```ts
import { z } from 'zod';

export const MessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/shared test packages/shared/src/index.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/index.test.ts && git commit -m "feat(shared): add message role schema"
```

### Task 14: Conversation Schema

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/conversation-schema.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ConversationSchema } from './index.js';

describe('ConversationSchema', () => {
  it('parses persisted conversation row', () => {
    const row = ConversationSchema.parse({
      id: 'c1',
      title: 'Regression Gate',
      flowTemplateId: null,
      createdAt: '2026-03-12T00:00:00.000Z',
      updatedAt: '2026-03-12T00:00:00.000Z',
    });
    expect(row.id).toBe('c1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/shared test packages/shared/src/conversation-schema.test.ts`
Expected: FAIL with "ConversationSchema is not defined".

**Step 3: Write minimal implementation**

```ts
import { z } from 'zod';

export const ConversationSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  flowTemplateId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/shared test packages/shared/src/conversation-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/conversation-schema.test.ts && git commit -m "feat(shared): add conversation schema"
```

### Task 15: Message Schema

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/message-schema.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { MessageSchema } from './index.js';

describe('MessageSchema', () => {
  it('parses tool result messages with metadata', () => {
    const msg = MessageSchema.parse({
      id: 'm1',
      conversationId: 'c1',
      role: 'tool',
      content: '{"ok":true}',
      toolCallId: 'call-1',
      toolName: 'github.create_issue',
      metadata: '{"latencyMs":120}',
      createdAt: '2026-03-12T00:00:00.000Z',
    });
    expect(msg.role).toBe('tool');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/shared test packages/shared/src/message-schema.test.ts`
Expected: FAIL with "MessageSchema is not defined".

**Step 3: Write minimal implementation**

```ts
import { z } from 'zod';
import { MessageRoleSchema } from './index.js';

export const MessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: MessageRoleSchema,
  content: z.string(),
  toolCallId: z.string().nullable(),
  toolName: z.string().nullable(),
  metadata: z.string().nullable(),
  createdAt: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/shared test packages/shared/src/message-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/message-schema.test.ts && git commit -m "feat(shared): add message schema"
```

### Task 16: Connector Config Schema

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/connector-config-schema.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ConnectorConfigSchema } from './index.js';

describe('ConnectorConfigSchema', () => {
  it('parses enabled connector config', () => {
    const cfg = ConnectorConfigSchema.parse({
      id: 'g1',
      connectorName: 'github',
      enabled: true,
      credentialRef: 'vault:github',
      settings: '{}',
      updatedAt: '2026-03-12T00:00:00.000Z',
    });
    expect(cfg.enabled).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/shared test packages/shared/src/connector-config-schema.test.ts`
Expected: FAIL with "ConnectorConfigSchema is not defined".

**Step 3: Write minimal implementation**

```ts
import { z } from 'zod';

export const ConnectorConfigSchema = z.object({
  id: z.string(),
  connectorName: z.string(),
  enabled: z.boolean(),
  credentialRef: z.string().nullable(),
  settings: z.string().nullable(),
  updatedAt: z.string(),
});
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/shared test packages/shared/src/connector-config-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/connector-config-schema.test.ts && git commit -m "feat(shared): add connector config schema"
```

### Task 17: Flow Template Schema

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/flow-template-schema.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { FlowTemplateSchema } from './index.js';

describe('FlowTemplateSchema', () => {
  it('parses a built-in flow template', () => {
    const flow = FlowTemplateSchema.parse({
      id: 'regression-gate',
      name: 'Regression Gate',
      description: 'Run tests then post summary',
      systemPrompt: 'You are QA orchestrator',
      steps: '[]',
      category: 'regression',
      isBuiltIn: true,
      createdAt: '2026-03-12T00:00:00.000Z',
      updatedAt: '2026-03-12T00:00:00.000Z',
    });
    expect(flow.isBuiltIn).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/shared test packages/shared/src/flow-template-schema.test.ts`
Expected: FAIL with "FlowTemplateSchema is not defined".

**Step 3: Write minimal implementation**

```ts
import { z } from 'zod';

export const FlowTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  systemPrompt: z.string(),
  steps: z.string().nullable(),
  category: z.string().nullable(),
  isBuiltIn: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FlowTemplate = z.infer<typeof FlowTemplateSchema>;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/shared test packages/shared/src/flow-template-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/flow-template-schema.test.ts && git commit -m "feat(shared): add flow template schema"
```

### Task 18: Execution Log Schema

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/execution-log-schema.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ExecutionLogSchema } from './index.js';

describe('ExecutionLogSchema', () => {
  it('accepts timeout status', () => {
    const row = ExecutionLogSchema.parse({
      id: 'e1',
      conversationId: 'c1',
      toolName: 'jira.create_issue',
      input: '{}',
      output: null,
      status: 'timeout',
      durationMs: 30000,
      errorMessage: 'timed out',
      createdAt: '2026-03-12T00:00:00.000Z',
    });
    expect(row.status).toBe('timeout');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/shared test packages/shared/src/execution-log-schema.test.ts`
Expected: FAIL with "ExecutionLogSchema is not defined".

**Step 3: Write minimal implementation**

```ts
import { z } from 'zod';

export const ExecutionStatusSchema = z.enum(['running', 'success', 'error', 'timeout']);
export const ExecutionLogSchema = z.object({
  id: z.string(),
  conversationId: z.string().nullable(),
  toolName: z.string(),
  input: z.string(),
  output: z.string().nullable(),
  status: ExecutionStatusSchema,
  durationMs: z.number().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
});
export type ExecutionLog = z.infer<typeof ExecutionLogSchema>;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/shared test packages/shared/src/execution-log-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/execution-log-schema.test.ts && git commit -m "feat(shared): add execution log schema"
```

### Task 19: Model Config Schema

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/model-config-schema.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ModelConfigSchema } from './index.js';

describe('ModelConfigSchema', () => {
  it('defaults provider to ollama', () => {
    const cfg = ModelConfigSchema.parse({
      id: 'default',
      provider: 'ollama',
      model: 'llama3.1',
      endpoint: 'http://localhost:11434',
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: null,
      updatedAt: '2026-03-12T00:00:00.000Z',
    });
    expect(cfg.provider).toBe('ollama');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/shared test packages/shared/src/model-config-schema.test.ts`
Expected: FAIL with "ModelConfigSchema is not defined".

**Step 3: Write minimal implementation**

```ts
import { z } from 'zod';

export const ModelConfigSchema = z.object({
  id: z.string(),
  provider: z.enum(['ollama']),
  model: z.string(),
  endpoint: z.string().url(),
  temperature: z.number(),
  maxTokens: z.number(),
  systemPrompt: z.string().nullable(),
  updatedAt: z.string(),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/shared test packages/shared/src/model-config-schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/model-config-schema.test.ts && git commit -m "feat(shared): add model config schema"
```

### Task 20: Shared API DTO Exports

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/public-exports.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import * as shared from './index.js';

describe('shared exports', () => {
  it('exports all automate schemas', () => {
    expect(shared.ConversationSchema).toBeDefined();
    expect(shared.MessageSchema).toBeDefined();
    expect(shared.ConnectorConfigSchema).toBeDefined();
    expect(shared.FlowTemplateSchema).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/shared test packages/shared/src/public-exports.test.ts`
Expected: FAIL with missing exports.

**Step 3: Write minimal implementation**

```ts
export {
  MessageRoleSchema,
  ConversationSchema,
  MessageSchema,
  ConnectorConfigSchema,
  FlowTemplateSchema,
  ExecutionLogSchema,
  ModelConfigSchema,
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/shared test packages/shared/src/public-exports.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/public-exports.test.ts && git commit -m "feat(shared): export automate domain schemas"
```

### Task 21: Shared Constants for Tool Namespacing

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/tool-constants.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { TOOL_NAME_PATTERN } from './index.js';

describe('TOOL_NAME_PATTERN', () => {
  it('matches connector.tool format', () => {
    expect(TOOL_NAME_PATTERN.test('github.create_issue')).toBe(true);
    expect(TOOL_NAME_PATTERN.test('create_issue')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/shared test packages/shared/src/tool-constants.test.ts`
Expected: FAIL with "TOOL_NAME_PATTERN not found".

**Step 3: Write minimal implementation**

```ts
export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/shared test packages/shared/src/tool-constants.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/tool-constants.test.ts && git commit -m "feat(shared): add tool namespacing constant"
```

### Task 22: Shared Parse Helper

**Files:**
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/parse-json-safe.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { parseJsonSafe } from './index.js';

describe('parseJsonSafe', () => {
  it('returns fallback on invalid json', () => {
    expect(parseJsonSafe('{oops', { ok: false })).toEqual({ ok: false });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/shared test packages/shared/src/parse-json-safe.test.ts`
Expected: FAIL with "parseJsonSafe is not defined".

**Step 3: Write minimal implementation**

```ts
export function parseJsonSafe<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/shared test packages/shared/src/parse-json-safe.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/parse-json-safe.test.ts && git commit -m "feat(shared): add safe json parse helper"
```

## Phase 3: Database Layer

### Task 23: Drizzle Client Initialization Pattern

**Files:**
- Create: `apps/server/src/db/client.ts`
- Test: `apps/server/src/db/client.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { sqlite } from './client.js';

describe('db client', () => {
  it('enables WAL mode', () => {
    const mode = sqlite.pragma('journal_mode', { simple: true }) as string;
    expect(mode.toLowerCase()).toBe('wal');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/db/client.test.ts`
Expected: FAIL with "Cannot find module './client.js'".

**Step 3: Write minimal implementation**

```ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as schema from './schema.js';

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DATABASE_URL ?? path.join(dataDir, 'automate.db');
const sqlite: InstanceType<typeof Database> = new Database(dbPath);

sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export type DB = typeof db;
export { sqlite };
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/db/client.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/client.ts apps/server/src/db/client.test.ts && git commit -m "feat(server-db): add sqlite drizzle wal client"
```

### Task 24: Core Conversations Table

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Test: `apps/server/src/db/schema-conversations.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { conversations } from './schema.js';

describe('schema conversations', () => {
  it('defines table name conversations', () => {
    expect(conversations[Symbol.for('drizzle:Name')]).toBe('conversations');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-conversations.test.ts`
Expected: FAIL with "conversations export missing".

**Step 3: Write minimal implementation**

```ts
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title'),
  flowTemplateId: text('flow_template_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-conversations.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/db/schema-conversations.test.ts && git commit -m "feat(server-db): add conversations table"
```

### Task 25: Messages Table

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Test: `apps/server/src/db/schema-messages.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { messages } from './schema.js';

describe('schema messages', () => {
  it('includes tool fields', () => {
    expect(messages.toolCallId).toBeDefined();
    expect(messages.toolName).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-messages.test.ts`
Expected: FAIL with "messages export missing".

**Step 3: Write minimal implementation**

```ts
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { conversations } from './schema.js';

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
  content: text('content').notNull(),
  toolCallId: text('tool_call_id'),
  toolName: text('tool_name'),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull(),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-messages.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/db/schema-messages.test.ts && git commit -m "feat(server-db): add messages table"
```

### Task 26: Message Attachments Table

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Test: `apps/server/src/db/schema-attachments.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { messageAttachments } from './schema.js';

describe('schema messageAttachments', () => {
  it('stores content type and path', () => {
    expect(messageAttachments.contentType).toBeDefined();
    expect(messageAttachments.path).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-attachments.test.ts`
Expected: FAIL with missing export.

**Step 3: Write minimal implementation**

```ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { messages } from './schema.js';

export const messageAttachments = sqliteTable('message_attachments', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  path: text('path').notNull(),
  sizeBytes: integer('size_bytes'),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-attachments.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/db/schema-attachments.test.ts && git commit -m "feat(server-db): add message attachments table"
```

### Task 27: Connector Config Table

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Test: `apps/server/src/db/schema-connector-config.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { connectorConfigs } from './schema.js';

describe('schema connectorConfigs', () => {
  it('contains unique connector name field', () => {
    expect(connectorConfigs.connectorName).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-connector-config.test.ts`
Expected: FAIL with missing connectorConfigs.

**Step 3: Write minimal implementation**

```ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const connectorConfigs = sqliteTable('connector_configs', {
  id: text('id').primaryKey(),
  connectorName: text('connector_name').notNull().unique(),
  enabled: integer('enabled', { mode: 'boolean' }).default(false),
  credentialRef: text('credential_ref'),
  settings: text('settings'),
  updatedAt: text('updated_at').notNull(),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-connector-config.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/db/schema-connector-config.test.ts && git commit -m "feat(server-db): add connector config table"
```

### Task 28: Flow Templates Table

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Test: `apps/server/src/db/schema-flow-templates.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { flowTemplates } from './schema.js';

describe('schema flowTemplates', () => {
  it('contains systemPrompt and steps columns', () => {
    expect(flowTemplates.systemPrompt).toBeDefined();
    expect(flowTemplates.steps).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-flow-templates.test.ts`
Expected: FAIL with missing flowTemplates.

**Step 3: Write minimal implementation**

```ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const flowTemplates = sqliteTable('flow_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  systemPrompt: text('system_prompt').notNull(),
  steps: text('steps'),
  category: text('category'),
  isBuiltIn: integer('is_built_in', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-flow-templates.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/db/schema-flow-templates.test.ts && git commit -m "feat(server-db): add flow templates table"
```

### Task 29: Execution Log Table

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Test: `apps/server/src/db/schema-execution-log.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { executionLog } from './schema.js';

describe('schema executionLog', () => {
  it('supports running success error timeout statuses', () => {
    expect(executionLog.status).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-execution-log.test.ts`
Expected: FAIL with missing executionLog.

**Step 3: Write minimal implementation**

```ts
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { conversations } from './schema.js';

export const executionLog = sqliteTable('execution_log', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').references(() => conversations.id),
  toolName: text('tool_name').notNull(),
  input: text('input').notNull(),
  output: text('output'),
  status: text('status', { enum: ['running', 'success', 'error', 'timeout'] }).notNull(),
  durationMs: integer('duration_ms'),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-execution-log.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/db/schema-execution-log.test.ts && git commit -m "feat(server-db): add execution log table"
```

### Task 30: Model Config Table

**Files:**
- Modify: `apps/server/src/db/schema.ts`
- Test: `apps/server/src/db/schema-model-config.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { modelConfig } from './schema.js';

describe('schema modelConfig', () => {
  it('contains endpoint and model fields', () => {
    expect(modelConfig.endpoint).toBeDefined();
    expect(modelConfig.model).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-model-config.test.ts`
Expected: FAIL with missing modelConfig.

**Step 3: Write minimal implementation**

```ts
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const modelConfig = sqliteTable('model_config', {
  id: text('id').primaryKey().default('default'),
  provider: text('provider').notNull().default('ollama'),
  model: text('model').notNull().default('llama3.1'),
  endpoint: text('endpoint').notNull().default('http://localhost:11434'),
  temperature: real('temperature').default(0.7),
  maxTokens: integer('max_tokens').default(4096),
  systemPrompt: text('system_prompt'),
  updatedAt: text('updated_at').notNull(),
});
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/db/schema-model-config.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/db/schema-model-config.test.ts && git commit -m "feat(server-db): add model config table"
```

### Task 31: Migration Runner Script

**Files:**
- Create: `apps/server/src/db/migrate.ts`
- Test: `apps/server/src/db/migrate.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildMigrationSql } from './migrate.js';

describe('buildMigrationSql', () => {
  it('includes conversations and messages tables', () => {
    const sql = buildMigrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS conversations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS messages');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/db/migrate.test.ts`
Expected: FAIL with missing buildMigrationSql.

**Step 3: Write minimal implementation**

```ts
export function buildMigrationSql(): string {
  return [
    'CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT, flow_template_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);',
    'CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, tool_call_id TEXT, tool_name TEXT, metadata TEXT, created_at TEXT NOT NULL, FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);',
  ].join('\n');
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/db/migrate.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/migrate.ts apps/server/src/db/migrate.test.ts && git commit -m "feat(server-db): add initial migration sql builder"
```

### Task 32: Seed Script for Built-in Flow Templates

**Files:**
- Create: `apps/server/src/db/seed.ts`
- Test: `apps/server/src/db/seed.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { builtInFlowTemplates } from './seed.js';

describe('builtInFlowTemplates', () => {
  it('contains Regression Gate template', () => {
    expect(builtInFlowTemplates.some((f) => f.id === 'regression-gate')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/db/seed.test.ts`
Expected: FAIL with missing export.

**Step 3: Write minimal implementation**

```ts
export const builtInFlowTemplates = [
  {
    id: 'regression-gate',
    name: 'Regression Gate',
    description: 'Run tests, create Jira tickets, post Slack summary',
    systemPrompt: 'Use playwright, jira, slack tools in order.',
    steps: JSON.stringify([
      { description: 'Run tests', toolHint: 'playwright.run_tests' },
      { description: 'Create issue for failures', toolHint: 'jira.create_issue' },
      { description: 'Post summary', toolHint: 'slack.post_summary' },
    ]),
    category: 'regression',
    isBuiltIn: true,
  },
];
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/db/seed.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/db/seed.ts apps/server/src/db/seed.test.ts && git commit -m "feat(server-db): add built-in flow seed data"
```

## Phase 4: Credential Vault

### Task 33: Vault Schema (Separate DB)

**Files:**
- Create: `apps/server/src/vault/schema.ts`
- Test: `apps/server/src/vault/schema.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { vaultEntriesTableSql } from './schema.js';

describe('vault schema', () => {
  it('creates vault_entries table', () => {
    expect(vaultEntriesTableSql).toContain('CREATE TABLE IF NOT EXISTS vault_entries');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/vault/schema.test.ts`
Expected: FAIL with missing vaultEntriesTableSql.

**Step 3: Write minimal implementation**

```ts
export const vaultEntriesTableSql = `
CREATE TABLE IF NOT EXISTS vault_entries (
  id TEXT PRIMARY KEY,
  connector_name TEXT NOT NULL UNIQUE,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/vault/schema.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/vault/schema.ts apps/server/src/vault/schema.test.ts && git commit -m "feat(vault): add vault sqlite schema"
```

### Task 34: PBKDF2 Key Derivation

**Files:**
- Create: `apps/server/src/vault/crypto.ts`
- Test: `apps/server/src/vault/pbkdf2.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { deriveKey } from './crypto.js';

describe('deriveKey', () => {
  it('returns 32-byte key for AES-256-GCM', async () => {
    const key = await deriveKey('master-pass', Buffer.alloc(16, 1), 100_000);
    expect(key.byteLength).toBe(32);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/vault/pbkdf2.test.ts`
Expected: FAIL with missing deriveKey.

**Step 3: Write minimal implementation**

```ts
import { pbkdf2 } from 'node:crypto';

export function deriveKey(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, 32, 'sha256', (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/vault/pbkdf2.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/vault/crypto.ts apps/server/src/vault/pbkdf2.test.ts && git commit -m "feat(vault): add pbkdf2 key derivation"
```

### Task 35: AES-256-GCM Encrypt/Decrypt

**Files:**
- Modify: `apps/server/src/vault/crypto.ts`
- Test: `apps/server/src/vault/aes-gcm.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.js';

describe('vault encryption', () => {
  it('round-trips plaintext with auth tag', async () => {
    const encrypted = await encryptSecret('master-pass', 'token-value');
    const decrypted = await decryptSecret('master-pass', encrypted);
    expect(decrypted).toBe('token-value');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/vault/aes-gcm.test.ts`
Expected: FAIL with missing encryptSecret/decryptSecret.

**Step 3: Write minimal implementation**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deriveKey } from './crypto.js';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
  iterations: number;
}

export async function encryptSecret(password: string, plaintext: string): Promise<EncryptedSecret> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const iterations = 100_000;
  const key = await deriveKey(password, salt, iterations);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    salt: salt.toString('base64'),
    iterations,
  };
}

export async function decryptSecret(password: string, encrypted: EncryptedSecret): Promise<string> {
  const key = await deriveKey(password, Buffer.from(encrypted.salt, 'base64'), encrypted.iterations);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/vault/aes-gcm.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/vault/crypto.ts apps/server/src/vault/aes-gcm.test.ts && git commit -m "feat(vault): add aes-256-gcm secret encryption"
```

### Task 36: Vault Repository

**Files:**
- Create: `apps/server/src/vault/repository.ts`
- Test: `apps/server/src/vault/repository.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createVaultRepository } from './repository.js';

describe('vault repository', () => {
  it('stores and loads encrypted record by connector name', () => {
    const repo = createVaultRepository(':memory:');
    repo.upsert('github', { ciphertext: 'a', iv: 'b', authTag: 'c', salt: 'd', iterations: 100000 });
    expect(repo.get('github')?.ciphertext).toBe('a');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/vault/repository.test.ts`
Expected: FAIL with missing createVaultRepository.

**Step 3: Write minimal implementation**

```ts
import Database from 'better-sqlite3';

interface StoredRecord {
  ciphertext: string;
  iv: string;
  authTag: string;
  salt: string;
  iterations: number;
}

export function createVaultRepository(dbPath: string) {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS vault_entries (connector_name TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL);`);
  return {
    upsert(connectorName: string, r: StoredRecord) {
      db.prepare('INSERT INTO vault_entries (connector_name, ciphertext, iv, auth_tag, salt, iterations) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(connector_name) DO UPDATE SET ciphertext=excluded.ciphertext, iv=excluded.iv, auth_tag=excluded.auth_tag, salt=excluded.salt, iterations=excluded.iterations').run(connectorName, r.ciphertext, r.iv, r.authTag, r.salt, r.iterations);
    },
    get(connectorName: string): StoredRecord | null {
      const row = db.prepare('SELECT ciphertext, iv, auth_tag, salt, iterations FROM vault_entries WHERE connector_name = ?').get(connectorName) as { ciphertext: string; iv: string; auth_tag: string; salt: string; iterations: number } | undefined;
      return row ? { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, salt: row.salt, iterations: row.iterations } : null;
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/vault/repository.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/vault/repository.ts apps/server/src/vault/repository.test.ts && git commit -m "feat(vault): add encrypted entry repository"
```

### Task 37: Vault Session Lock/Unlock

**Files:**
- Create: `apps/server/src/vault/session.ts`
- Test: `apps/server/src/vault/session.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createVaultSession } from './session.js';

describe('vault session', () => {
  it('locks and unlocks in-memory master password', () => {
    const session = createVaultSession();
    session.unlock('master-pass');
    expect(session.isUnlocked()).toBe(true);
    session.lock();
    expect(session.isUnlocked()).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/vault/session.test.ts`
Expected: FAIL with missing createVaultSession.

**Step 3: Write minimal implementation**

```ts
export function createVaultSession() {
  let password: string | null = null;
  return {
    unlock(masterPassword: string) {
      password = masterPassword;
    },
    lock() {
      password = null;
    },
    isUnlocked() {
      return password !== null;
    },
    getMasterPassword() {
      if (!password) throw new Error('Vault is locked');
      return password;
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/vault/session.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/vault/session.ts apps/server/src/vault/session.test.ts && git commit -m "feat(vault): add lock unlock session state"
```

### Task 38: Vault Service API

**Files:**
- Create: `apps/server/src/vault/service.ts`
- Test: `apps/server/src/vault/service.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createVaultService } from './service.js';

describe('vault service', () => {
  it('stores and retrieves decrypted connector credential', async () => {
    const svc = createVaultService(':memory:');
    await svc.unlock('master-pass');
    await svc.setCredential('github', 'token-123');
    await expect(svc.getCredential('github')).resolves.toBe('token-123');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/vault/service.test.ts`
Expected: FAIL with missing createVaultService.

**Step 3: Write minimal implementation**

```ts
import { decryptSecret, encryptSecret } from './crypto.js';
import { createVaultRepository } from './repository.js';
import { createVaultSession } from './session.js';

export function createVaultService(dbPath: string) {
  const repo = createVaultRepository(dbPath);
  const session = createVaultSession();
  return {
    async unlock(password: string) {
      session.unlock(password);
    },
    lock() {
      session.lock();
    },
    async setCredential(connectorName: string, secret: string) {
      const encrypted = await encryptSecret(session.getMasterPassword(), secret);
      repo.upsert(connectorName, encrypted);
    },
    async getCredential(connectorName: string) {
      const encrypted = repo.get(connectorName);
      if (!encrypted) return null;
      return decryptSecret(session.getMasterPassword(), encrypted);
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/vault/service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/vault/service.ts apps/server/src/vault/service.test.ts && git commit -m "feat(vault): add encrypted credential service"
```

## Phase 5: Connector SDK + First 3 Connectors

### Task 39: Connector SDK Types

**Files:**
- Create: `packages/connector-sdk/src/types.ts`
- Test: `packages/connector-sdk/src/types.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { ConnectorManifest } from './types.js';

describe('connector manifest type', () => {
  it('accepts name version displayName description icon tools', () => {
    const manifest: ConnectorManifest = {
      name: 'github',
      version: '0.1.0',
      displayName: 'GitHub',
      description: 'GitHub connector',
      icon: 'github',
      credentialSchema: {} as never,
      tools: [],
    };
    expect(manifest.name).toBe('github');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/connector-sdk test packages/connector-sdk/src/types.test.ts`
Expected: FAIL with missing ConnectorManifest type.

**Step 3: Write minimal implementation**

```ts
import type { z } from 'zod';

export interface ToolContext {
  credentials: Record<string, string>;
  abortSignal: AbortSignal;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject<Record<string, z.ZodTypeAny>>;
  handler: (input: unknown, context: ToolContext) => Promise<ToolResult>;
}

export interface ConnectorManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  icon: string;
  credentialSchema: z.ZodObject<Record<string, z.ZodTypeAny>>;
  tools: ToolDefinition[];
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/connector-sdk test packages/connector-sdk/src/types.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connector-sdk/src/types.ts packages/connector-sdk/src/types.test.ts && git commit -m "feat(connector-sdk): add core connector types"
```

### Task 40: BaseConnector with MCP Server Pattern

**Files:**
- Create: `packages/connector-sdk/src/base-connector.ts`
- Test: `packages/connector-sdk/src/base-connector.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { BaseConnector } from './base-connector.js';

describe('BaseConnector', () => {
  it('is constructible via subclass', () => {
    class Dummy extends BaseConnector { createContext() { return { credentials: {}, abortSignal: new AbortController().signal }; } manifest = { name: 'd', version: '1', displayName: 'd', description: 'd', icon: 'd', credentialSchema: {} as never, tools: [] }; }
    expect(new Dummy()).toBeInstanceOf(BaseConnector);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/connector-sdk test packages/connector-sdk/src/base-connector.test.ts`
Expected: FAIL with missing BaseConnector.

**Step 3: Write minimal implementation**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ConnectorManifest, ToolContext } from './types.js';

export abstract class BaseConnector {
  abstract manifest: ConnectorManifest;

  async start(): Promise<void> {
    const server = new McpServer({ name: this.manifest.name, version: this.manifest.version });
    for (const tool of this.manifest.tools) {
      server.tool(tool.name, tool.inputSchema, async (input) => tool.handler(input, this.createContext()));
    }
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  protected abstract createContext(): ToolContext;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/connector-sdk test packages/connector-sdk/src/base-connector.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connector-sdk/src/base-connector.ts packages/connector-sdk/src/base-connector.test.ts && git commit -m "feat(connector-sdk): add base connector mcp wrapper"
```

### Task 41: Connector Registry with Dispatch

**Files:**
- Create: `apps/server/src/connectors/registry.ts`
- Test: `apps/server/src/connectors/registry.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ConnectorRegistry } from './registry.js';

describe('ConnectorRegistry', () => {
  it('dispatches tool by connector.tool name', async () => {
    const registry = new ConnectorRegistry();
    registry.registerLocal('github', async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    const result = await registry.dispatch('github.create_issue', {});
    expect(result.content[0].text).toBe('ok');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/connectors/registry.test.ts`
Expected: FAIL with missing ConnectorRegistry.

**Step 3: Write minimal implementation**

```ts
type Handler = (input: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;

export class ConnectorRegistry {
  private connectors = new Map<string, Handler>();

  registerLocal(name: string, handler: Handler) {
    this.connectors.set(name, handler);
  }

  getToolSchemas(): Record<string, unknown> {
    return Object.fromEntries([...this.connectors.keys()].map((name) => [`${name}.*`, {}]));
  }

  async dispatch(toolName: string, input: unknown) {
    const [connector] = toolName.split('.');
    const handler = this.connectors.get(connector);
    if (!handler) throw new Error(`Connector not loaded: ${connector}`);
    return handler(input);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/connectors/registry.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/connectors/registry.ts apps/server/src/connectors/registry.test.ts && git commit -m "feat(server-connectors): add connector registry dispatch"
```

### Task 42: GitHub Connector Service Adaptation (Dashboard Reuse)

**Files:**
- Create: `packages/connectors/github/src/service.ts`
- Test: `packages/connectors/github/src/service.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildSummaryMarkdown } from './service.js';

describe('buildSummaryMarkdown', () => {
  it('uses dashboard run summary formatting', () => {
    const text = buildSummaryMarkdown({ status: 'passed', total: 10, passed: 10, failed: 0, flaky: 0, skipped: 0 });
    expect(text).toContain('Playwright Test Results');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/connector-github test packages/connectors/github/src/service.test.ts`
Expected: FAIL with missing buildSummaryMarkdown.

**Step 3: Write minimal implementation**

```ts
export function buildSummaryMarkdown(run: { status: string; total: number; passed: number; failed: number; flaky: number; skipped: number; durationMs?: number; branch?: string }) {
  const emoji = run.status === 'passed' ? '✅' : run.status === 'failed' ? '❌' : '⚠️';
  const passRate = run.total > 0 ? ((run.passed / run.total) * 100).toFixed(1) : '0';
  const duration = run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : 'N/A';
  return `## ${emoji} Playwright Test Results\n\n| Metric | Value |\n|---|---|\n| **Status** | ${run.status} |\n| **Pass Rate** | ${passRate}% |\n| **Total** | ${run.total} |\n| **Passed** | ${run.passed} |\n| **Failed** | ${run.failed} |\n| **Flaky** | ${run.flaky} |\n| **Skipped** | ${run.skipped} |\n| **Duration** | ${duration} |\n| **Branch** | ${run.branch ?? 'N/A'} |`;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/connector-github test packages/connectors/github/src/service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/github/src/service.ts packages/connectors/github/src/service.test.ts && git commit -m "feat(connector-github): adapt dashboard summary markdown builder"
```

### Task 43: GitHub Connector MCP Tool Wrapper

**Files:**
- Create: `packages/connectors/github/src/index.ts`
- Test: `packages/connectors/github/src/index.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { githubManifest } from './index.js';

describe('github connector manifest', () => {
  it('exposes namespaced create_issue tool', () => {
    expect(githubManifest.tools.map((t) => t.name)).toContain('create_issue');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/connector-github test packages/connectors/github/src/index.test.ts`
Expected: FAIL with missing githubManifest.

**Step 3: Write minimal implementation**

```ts
import { z } from 'zod';
import type { ConnectorManifest } from '@automate/connector-sdk';

export const githubManifest: ConnectorManifest = {
  name: 'github',
  version: '0.1.0',
  displayName: 'GitHub',
  description: 'GitHub MCP connector',
  icon: 'github',
  credentialSchema: z.object({ token: z.string(), owner: z.string(), repo: z.string() }),
  tools: [
    {
      name: 'create_issue',
      description: 'Create GitHub issue',
      inputSchema: z.object({ title: z.string(), body: z.string() }),
      handler: async ({ title, body }) => ({ content: [{ type: 'text', text: `Created issue: ${title}\n${body}` }] }),
    },
  ],
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/connector-github test packages/connectors/github/src/index.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/github/src/index.ts packages/connectors/github/src/index.test.ts && git commit -m "feat(connector-github): expose mcp tools manifest"
```

### Task 44: Jira Connector Service Adaptation (Dashboard Reuse)

**Files:**
- Create: `packages/connectors/jira/src/service.ts`
- Test: `packages/connectors/jira/src/service.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildJiraDescription } from './service.js';

describe('buildJiraDescription', () => {
  it('follows dashboard jira formatting', () => {
    const desc = buildJiraDescription({ title: 'fails', file: 'a.spec.ts', errorMessage: 'boom' });
    expect(desc).toContain('*Test:* fails');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/connector-jira test packages/connectors/jira/src/service.test.ts`
Expected: FAIL with missing buildJiraDescription.

**Step 3: Write minimal implementation**

```ts
export function buildJiraDescription(test: { title: string; file: string; errorMessage?: string; errorStack?: string; screenshotUrl?: string }) {
  return [
    `*Test:* ${test.title}`,
    `*File:* \`${test.file}\``,
    '',
    test.errorMessage ? `*Error:*\n{code}${test.errorMessage}{code}` : '',
    test.errorStack ? `*Stack:*\n{code}${test.errorStack.slice(0, 2000)}{code}` : '',
    '',
    test.screenshotUrl ? `[Screenshot|${test.screenshotUrl}]` : '',
    '',
    '_Created automatically by Automate',
  ].filter(Boolean).join('\n');
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/connector-jira test packages/connectors/jira/src/service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/jira/src/service.ts packages/connectors/jira/src/service.test.ts && git commit -m "feat(connector-jira): adapt dashboard jira description builder"
```

### Task 45: Jira Connector MCP Tool Wrapper

**Files:**
- Create: `packages/connectors/jira/src/index.ts`
- Test: `packages/connectors/jira/src/index.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { jiraManifest } from './index.js';

describe('jira connector manifest', () => {
  it('exposes create_issue and search_issues tools', () => {
    const names = jiraManifest.tools.map((t) => t.name);
    expect(names).toContain('create_issue');
    expect(names).toContain('search_issues');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/connector-jira test packages/connectors/jira/src/index.test.ts`
Expected: FAIL with missing jiraManifest.

**Step 3: Write minimal implementation**

```ts
import { z } from 'zod';
import type { ConnectorManifest } from '@automate/connector-sdk';

export const jiraManifest: ConnectorManifest = {
  name: 'jira',
  version: '0.1.0',
  displayName: 'Jira',
  description: 'Jira MCP connector',
  icon: 'jira',
  credentialSchema: z.object({ baseUrl: z.string().url(), email: z.string(), apiToken: z.string(), projectKey: z.string() }),
  tools: [
    {
      name: 'create_issue',
      description: 'Create Jira issue',
      inputSchema: z.object({ summary: z.string(), description: z.string() }),
      handler: async ({ summary }) => ({ content: [{ type: 'text', text: `Created Jira issue: ${summary}` }] }),
    },
    {
      name: 'search_issues',
      description: 'Search Jira issues',
      inputSchema: z.object({ jql: z.string() }),
      handler: async ({ jql }) => ({ content: [{ type: 'text', text: `Searched Jira with JQL: ${jql}` }] }),
    },
  ],
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/connector-jira test packages/connectors/jira/src/index.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/jira/src/index.ts packages/connectors/jira/src/index.test.ts && git commit -m "feat(connector-jira): expose mcp tools manifest"
```

### Task 46: Slack Connector Service Adaptation (Dashboard Reuse)

**Files:**
- Create: `packages/connectors/slack/src/service.ts`
- Test: `packages/connectors/slack/src/service.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildSlackBlocks } from './service.js';

describe('buildSlackBlocks', () => {
  it('renders block-kit sections', () => {
    const blocks = buildSlackBlocks({ runId: 'r1', status: 'passed', total: 10, passed: 10, failed: 0, flaky: 0, skipped: 0 });
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks[0].type).toBe('header');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/connector-slack test packages/connectors/slack/src/service.test.ts`
Expected: FAIL with missing buildSlackBlocks.

**Step 3: Write minimal implementation**

```ts
export function buildSlackBlocks(run: { runId: string; status: string; total: number; passed: number; failed: number; flaky: number; skipped: number; durationMs?: number; branch?: string; dashboardUrl?: string }) {
  const emoji = run.status === 'passed' ? ':white_check_mark:' : run.status === 'failed' ? ':x:' : ':warning:';
  const durationStr = run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : 'N/A';
  const passRate = run.total > 0 ? `${((run.passed / run.total) * 100).toFixed(1)}%` : '—';
  return [
    { type: 'header', text: { type: 'plain_text', text: `${emoji} Test Run ${run.status.toUpperCase()}`, emoji: true } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Run ID:*\n\`${run.runId.slice(0, 8)}\`` },
      { type: 'mrkdwn', text: `*Branch:*\n${run.branch ?? 'N/A'}` },
      { type: 'mrkdwn', text: `*Pass Rate:*\n${passRate}` },
      { type: 'mrkdwn', text: `*Duration:*\n${durationStr}` },
    ] },
  ];
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/connector-slack test packages/connectors/slack/src/service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/slack/src/service.ts packages/connectors/slack/src/service.test.ts && git commit -m "feat(connector-slack): adapt dashboard block kit payload builder"
```

### Task 47: Slack Connector MCP Tool Wrapper

**Files:**
- Create: `packages/connectors/slack/src/index.ts`
- Test: `packages/connectors/slack/src/index.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { slackManifest } from './index.js';

describe('slack connector manifest', () => {
  it('exposes post_summary tool', () => {
    expect(slackManifest.tools.map((t) => t.name)).toContain('post_summary');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/connector-slack test packages/connectors/slack/src/index.test.ts`
Expected: FAIL with missing slackManifest.

**Step 3: Write minimal implementation**

```ts
import { z } from 'zod';
import type { ConnectorManifest } from '@automate/connector-sdk';

export const slackManifest: ConnectorManifest = {
  name: 'slack',
  version: '0.1.0',
  displayName: 'Slack',
  description: 'Slack MCP connector',
  icon: 'slack',
  credentialSchema: z.object({ webhookUrl: z.string().url() }),
  tools: [
    {
      name: 'post_summary',
      description: 'Post QA summary to Slack',
      inputSchema: z.object({ text: z.string() }),
      handler: async ({ text }) => ({ content: [{ type: 'text', text: `Posted to Slack: ${text}` }] }),
    },
  ],
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/connector-slack test packages/connectors/slack/src/index.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/slack/src/index.ts packages/connectors/slack/src/index.test.ts && git commit -m "feat(connector-slack): expose mcp tools manifest"
```

### Task 48: Hot Load/Unload Connector Process Pattern

**Files:**
- Modify: `apps/server/src/connectors/registry.ts`
- Test: `apps/server/src/connectors/hot-reload.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ConnectorRegistry } from './registry.js';

describe('hot reload', () => {
  it('supports unload then load without restart', async () => {
    const r = new ConnectorRegistry();
    r.registerLocal('x', async () => ({ content: [{ type: 'text', text: 'v1' }] }));
    await r.unload('x');
    r.registerLocal('x', async () => ({ content: [{ type: 'text', text: 'v2' }] }));
    const out = await r.dispatch('x.run', {});
    expect(out.content[0].text).toBe('v2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/connectors/hot-reload.test.ts`
Expected: FAIL with "unload is not a function".

**Step 3: Write minimal implementation**

```ts
export class ConnectorRegistry {
  private connectors = new Map<string, (input: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>>();
  registerLocal(name: string, handler: (input: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>) { this.connectors.set(name, handler); }
  async unload(name: string) { this.connectors.delete(name); }
  async reload(name: string, nextHandler: (input: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>) { await this.unload(name); this.registerLocal(name, nextHandler); }
  async dispatch(toolName: string, input: unknown) { const [connector] = toolName.split('.'); const h = this.connectors.get(connector); if (!h) throw new Error(`Connector not loaded: ${connector}`); return h(input); }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/connectors/hot-reload.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/connectors/registry.ts apps/server/src/connectors/hot-reload.test.ts && git commit -m "feat(server-connectors): add hot unload reload lifecycle"
```

## Phase 6: Agent Core

### Task 49: Planner with Vercel AI SDK streamText

**Files:**
- Create: `apps/server/src/agent/planner.ts`
- Test: `apps/server/src/agent/planner.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildPlannerInput } from './planner.js';

describe('planner input', () => {
  it('injects tools and flow prompt', () => {
    const input = buildPlannerInput('hello', 'flow prompt', { 'github.create_issue': {} });
    expect(input.system).toContain('flow prompt');
    expect(Object.keys(input.tools)).toContain('github.create_issue');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/agent/planner.test.ts`
Expected: FAIL with missing buildPlannerInput.

**Step 3: Write minimal implementation**

```ts
import { streamText } from 'ai';
import { ollama } from '@ai-sdk/ollama';

export function buildPlannerInput(userPrompt: string, flowPrompt: string, tools: Record<string, unknown>) {
  return {
    model: ollama('llama3.1'),
    system: `You are Automate orchestration planner. ${flowPrompt}`,
    prompt: userPrompt,
    tools,
  };
}

export function plan(userPrompt: string, flowPrompt: string, tools: Record<string, unknown>) {
  return streamText(buildPlannerInput(userPrompt, flowPrompt, tools));
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/agent/planner.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/planner.ts apps/server/src/agent/planner.test.ts && git commit -m "feat(agent): add planner streamText wrapper"
```

### Task 50: Executor Tool Dispatch

**Files:**
- Create: `apps/server/src/agent/executor.ts`
- Test: `apps/server/src/agent/executor.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { executeToolCall } from './executor.js';

describe('executor', () => {
  it('dispatches call to connector registry', async () => {
    const result = await executeToolCall(
      { dispatch: async () => ({ content: [{ type: 'text', text: 'ok' }] }) },
      { toolName: 'github.create_issue', input: { title: 'x' } },
    );
    expect(result.content[0].text).toBe('ok');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/agent/executor.test.ts`
Expected: FAIL with missing executeToolCall.

**Step 3: Write minimal implementation**

```ts
interface Registry {
  dispatch(toolName: string, input: unknown): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

export async function executeToolCall(
  registry: Registry,
  call: { toolName: string; input: unknown },
) {
  return registry.dispatch(call.toolName, call.input);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/agent/executor.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/executor.ts apps/server/src/agent/executor.test.ts && git commit -m "feat(agent): add tool executor dispatcher"
```

### Task 51: Memory Repository - Conversations

**Files:**
- Create: `apps/server/src/agent/memory.ts`
- Test: `apps/server/src/agent/memory-conversations.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createMemoryRepository } from './memory.js';

describe('memory conversations', () => {
  it('stores and lists conversations', async () => {
    const repo = createMemoryRepository();
    await repo.saveConversation({ id: 'c1', title: 't1' });
    const list = await repo.listConversations();
    expect(list[0].id).toBe('c1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/agent/memory-conversations.test.ts`
Expected: FAIL with missing createMemoryRepository.

**Step 3: Write minimal implementation**

```ts
interface ConversationRow { id: string; title: string | null; }
interface MessageRow { id: string; conversationId: string; role: string; content: string; }

export function createMemoryRepository() {
  const conversations: ConversationRow[] = [];
  const messages: MessageRow[] = [];
  return {
    async saveConversation(c: ConversationRow) { conversations.push(c); },
    async listConversations() { return conversations; },
    async saveMessage(m: MessageRow) { messages.push(m); },
    async listMessages(conversationId: string) { return messages.filter((m) => m.conversationId === conversationId); },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/agent/memory-conversations.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/memory.ts apps/server/src/agent/memory-conversations.test.ts && git commit -m "feat(agent): add conversation memory repository"
```

### Task 52: Memory Repository - Messages

**Files:**
- Modify: `apps/server/src/agent/memory.ts`
- Test: `apps/server/src/agent/memory-messages.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createMemoryRepository } from './memory.js';

describe('memory messages', () => {
  it('persists and filters by conversation', async () => {
    const repo = createMemoryRepository();
    await repo.saveMessage({ id: 'm1', conversationId: 'c1', role: 'user', content: 'hi' });
    await repo.saveMessage({ id: 'm2', conversationId: 'c2', role: 'user', content: 'yo' });
    const c1 = await repo.listMessages('c1');
    expect(c1).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/agent/memory-messages.test.ts`
Expected: FAIL if listMessages not implemented.

**Step 3: Write minimal implementation**

```ts
// ensure createMemoryRepository includes:
async saveMessage(m: { id: string; conversationId: string; role: string; content: string }) { messages.push(m); },
async listMessages(conversationId: string) { return messages.filter((m) => m.conversationId === conversationId); },
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/agent/memory-messages.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/memory.ts apps/server/src/agent/memory-messages.test.ts && git commit -m "feat(agent): add message memory persistence"
```

### Task 53: Chat SSE Route

**Files:**
- Create: `apps/server/src/routes/chat.ts`
- Test: `apps/server/src/routes/chat.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { toSseEvent } from './chat.js';

describe('toSseEvent', () => {
  it('formats data event frame', () => {
    expect(toSseEvent({ type: 'text-delta', text: 'Hi' })).toContain('data:');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/routes/chat.test.ts`
Expected: FAIL with missing toSseEvent.

**Step 3: Write minimal implementation**

```ts
import type { FastifyInstance } from 'fastify';

export function toSseEvent(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function chatRoutes(app: FastifyInstance) {
  app.post('/api/chat', async (_request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(toSseEvent({ type: 'text-delta', text: 'Automate ready' }));
    reply.raw.end();
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/routes/chat.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/routes/chat.ts apps/server/src/routes/chat.test.ts && git commit -m "feat(server-routes): add chat sse endpoint"
```

### Task 54: EventHub WS Bridge (ReporterBridge Pattern)

**Files:**
- Create: `apps/server/src/services/event-hub.ts`
- Test: `apps/server/src/services/event-hub.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { EventHub } from './event-hub.js';

describe('EventHub', () => {
  it('broadcasts typed events to subscribers', () => {
    const hub = new EventHub();
    const events: unknown[] = [];
    hub.subscribe((event) => events.push(event));
    hub.broadcast({ type: 'connector:status', payload: { name: 'github', status: 'up' } });
    expect(events).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/services/event-hub.test.ts`
Expected: FAIL with missing EventHub.

**Step 3: Write minimal implementation**

```ts
export interface HubEvent {
  type: string;
  payload: Record<string, unknown>;
}

export class EventHub {
  private listeners = new Set<(event: HubEvent) => void>();

  subscribe(listener: (event: HubEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  broadcast(event: HubEvent) {
    for (const listener of this.listeners) listener(event);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/services/event-hub.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/services/event-hub.ts apps/server/src/services/event-hub.test.ts && git commit -m "feat(server): add event hub websocket broadcast core"
```

### Task 55: Execution Log Persistence Hook

**Files:**
- Create: `apps/server/src/agent/logging.ts`
- Test: `apps/server/src/agent/logging.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildExecutionLogRow } from './logging.js';

describe('buildExecutionLogRow', () => {
  it('captures tool name input output and status', () => {
    const row = buildExecutionLogRow('c1', 'github.create_issue', { a: 1 }, { ok: true }, 'success', 40, null);
    expect(row.toolName).toBe('github.create_issue');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/agent/logging.test.ts`
Expected: FAIL with missing buildExecutionLogRow.

**Step 3: Write minimal implementation**

```ts
export function buildExecutionLogRow(
  conversationId: string,
  toolName: string,
  input: unknown,
  output: unknown,
  status: 'running' | 'success' | 'error' | 'timeout',
  durationMs: number,
  errorMessage: string | null,
) {
  return {
    id: crypto.randomUUID(),
    conversationId,
    toolName,
    input: JSON.stringify(input),
    output: output === null ? null : JSON.stringify(output),
    status,
    durationMs,
    errorMessage,
    createdAt: new Date().toISOString(),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/agent/logging.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/logging.ts apps/server/src/agent/logging.test.ts && git commit -m "feat(agent): add execution log row builder"
```

### Task 56: Agent Orchestrator Loop

**Files:**
- Create: `apps/server/src/agent/orchestrator.ts`
- Test: `apps/server/src/agent/orchestrator.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { runAgentOnce } from './orchestrator.js';

describe('runAgentOnce', () => {
  it('returns streamed response handle', async () => {
    const result = await runAgentOnce({
      planner: async () => ({ textStream: ['hi'] }),
      executor: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      toolCalls: [],
    });
    expect(result).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/agent/orchestrator.test.ts`
Expected: FAIL with missing runAgentOnce.

**Step 3: Write minimal implementation**

```ts
export async function runAgentOnce(deps: {
  planner: () => Promise<{ textStream: Iterable<string> }>;
  executor: (call: unknown) => Promise<unknown>;
  toolCalls: unknown[];
}) {
  const planResult = await deps.planner();
  for (const call of deps.toolCalls) {
    await deps.executor(call);
  }
  return planResult;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/agent/orchestrator.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/orchestrator.ts apps/server/src/agent/orchestrator.test.ts && git commit -m "feat(agent): add minimal orchestrator loop"
```

## Phase 7: Frontend

### Task 57: Vite + Router Bootstrap

**Files:**
- Create: `apps/web/src/router.tsx`
- Test: `apps/web/src/router.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { appRoutes } from './router.js';

describe('router', () => {
  it('contains root chat route', () => {
    expect(appRoutes.some((r) => r.path === '/')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/web test apps/web/src/router.test.tsx`
Expected: FAIL with missing appRoutes.

**Step 3: Write minimal implementation**

```tsx
export const appRoutes = [
  { path: '/' },
  { path: '/chat/$conversationId' },
  { path: '/settings/connectors' },
  { path: '/settings/model' },
  { path: '/settings/vault' },
  { path: '/sql' },
];
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/web test apps/web/src/router.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/router.tsx apps/web/src/router.test.tsx && git commit -m "feat(web): add route definitions"
```

### Task 58: AI Elements Conversation Wrapper

**Files:**
- Create: `apps/web/src/components/chat/chat-shell.tsx`
- Test: `apps/web/src/components/chat/chat-shell.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ChatShell } from './chat-shell.js';

describe('ChatShell', () => {
  it('renders prompt input placeholder', () => {
    const html = renderToString(<ChatShell messages={[]} onSubmit={() => {}} />);
    expect(html).toContain('Ask Automate');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/web test apps/web/src/components/chat/chat-shell.test.tsx`
Expected: FAIL with missing ChatShell.

**Step 3: Write minimal implementation**

```tsx
import { Conversation, Message, PromptInput } from '@vercel/ai-elements';

export function ChatShell({
  messages,
  onSubmit,
}: {
  messages: Array<{ id: string; role: 'user' | 'assistant'; text: string }>;
  onSubmit: (value: string) => void;
}) {
  return (
    <Conversation>
      {messages.map((m) => (
        <Message key={m.id} role={m.role}>
          {m.text}
        </Message>
      ))}
      <PromptInput placeholder="Ask Automate" onSubmit={onSubmit} />
    </Conversation>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/web test apps/web/src/components/chat/chat-shell.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/chat/chat-shell.tsx apps/web/src/components/chat/chat-shell.test.tsx && git commit -m "feat(web-chat): add ai elements conversation wrapper"
```

### Task 59: Tool Invocation Renderer

**Files:**
- Create: `apps/web/src/components/chat/tool-part.tsx`
- Test: `apps/web/src/components/chat/tool-part.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ToolPart } from './tool-part.js';

describe('ToolPart', () => {
  it('renders tool name and state', () => {
    const html = renderToString(<ToolPart name="github.create_issue" state="call" />);
    expect(html).toContain('github.create_issue');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/web test apps/web/src/components/chat/tool-part.test.tsx`
Expected: FAIL with missing ToolPart.

**Step 3: Write minimal implementation**

```tsx
import { Tool } from '@vercel/ai-elements';

export function ToolPart({ name, state }: { name: string; state: 'partial-call' | 'call' | 'result' }) {
  return (
    <Tool>
      <div>{name}</div>
      <div>{state}</div>
    </Tool>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/web test apps/web/src/components/chat/tool-part.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/chat/tool-part.tsx apps/web/src/components/chat/tool-part.test.tsx && git commit -m "feat(web-chat): add tool invocation renderer"
```

### Task 60: useChat() Integration Hook

**Files:**
- Create: `apps/web/src/hooks/use-automate-chat.ts`
- Test: `apps/web/src/hooks/use-automate-chat.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { chatApiPath } from './use-automate-chat.js';

describe('chat hook config', () => {
  it('targets /api/chat endpoint', () => {
    expect(chatApiPath).toBe('/api/chat');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/web test apps/web/src/hooks/use-automate-chat.test.ts`
Expected: FAIL with missing chatApiPath.

**Step 3: Write minimal implementation**

```ts
import { useChat } from '@ai-sdk/react';

export const chatApiPath = '/api/chat';

export function useAutomateChat() {
  return useChat({ api: chatApiPath });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/web test apps/web/src/hooks/use-automate-chat.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/hooks/use-automate-chat.ts apps/web/src/hooks/use-automate-chat.test.ts && git commit -m "feat(web-chat): wire useChat to fastify sse endpoint"
```

### Task 61: Conversation Sidebar Store

**Files:**
- Create: `apps/web/src/stores/conversation-store.ts`
- Test: `apps/web/src/stores/conversation-store.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createConversationStore } from './conversation-store.js';

describe('conversation store', () => {
  it('sets active conversation id', () => {
    const store = createConversationStore();
    store.setActive('c1');
    expect(store.getState().activeConversationId).toBe('c1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/web test apps/web/src/stores/conversation-store.test.ts`
Expected: FAIL with missing createConversationStore.

**Step 3: Write minimal implementation**

```ts
import { createStore } from 'zustand/vanilla';

interface ConversationState {
  activeConversationId: string | null;
  setActive: (id: string) => void;
}

export function createConversationStore() {
  return createStore<ConversationState>((set) => ({
    activeConversationId: null,
    setActive: (id) => set({ activeConversationId: id }),
  }));
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/web test apps/web/src/stores/conversation-store.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/stores/conversation-store.ts apps/web/src/stores/conversation-store.test.ts && git commit -m "feat(web-state): add conversation zustand store"
```

### Task 62: Connectors Settings View

**Files:**
- Create: `apps/web/src/routes/settings.connectors.tsx`
- Test: `apps/web/src/routes/settings.connectors.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ConnectorsSettingsPage } from './settings.connectors.js';

describe('ConnectorsSettingsPage', () => {
  it('renders connectors heading', () => {
    expect(renderToString(<ConnectorsSettingsPage />)).toContain('Connector Settings');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/web test apps/web/src/routes/settings.connectors.test.tsx`
Expected: FAIL with missing ConnectorsSettingsPage.

**Step 3: Write minimal implementation**

```tsx
export function ConnectorsSettingsPage() {
  return (
    <section>
      <h1>Connector Settings</h1>
      <p>Enable connectors and bind vault credentials.</p>
    </section>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/web test apps/web/src/routes/settings.connectors.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/routes/settings.connectors.tsx apps/web/src/routes/settings.connectors.test.tsx && git commit -m "feat(web-settings): add connectors settings page"
```

### Task 63: Model Settings View

**Files:**
- Create: `apps/web/src/routes/settings.model.tsx`
- Test: `apps/web/src/routes/settings.model.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ModelSettingsPage } from './settings.model.js';

describe('ModelSettingsPage', () => {
  it('shows ollama endpoint field label', () => {
    expect(renderToString(<ModelSettingsPage />)).toContain('Ollama Endpoint');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/web test apps/web/src/routes/settings.model.test.tsx`
Expected: FAIL with missing ModelSettingsPage.

**Step 3: Write minimal implementation**

```tsx
export function ModelSettingsPage() {
  return (
    <section>
      <h1>Model Settings</h1>
      <label htmlFor="endpoint">Ollama Endpoint</label>
      <input id="endpoint" defaultValue="http://localhost:11434" />
    </section>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/web test apps/web/src/routes/settings.model.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/routes/settings.model.tsx apps/web/src/routes/settings.model.test.tsx && git commit -m "feat(web-settings): add model settings page"
```

### Task 64: Vault Settings View

**Files:**
- Create: `apps/web/src/routes/settings.vault.tsx`
- Test: `apps/web/src/routes/settings.vault.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { VaultSettingsPage } from './settings.vault.js';

describe('VaultSettingsPage', () => {
  it('contains unlock vault action', () => {
    expect(renderToString(<VaultSettingsPage />)).toContain('Unlock Vault');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/web test apps/web/src/routes/settings.vault.test.tsx`
Expected: FAIL with missing VaultSettingsPage.

**Step 3: Write minimal implementation**

```tsx
export function VaultSettingsPage() {
  return (
    <section>
      <h1>Vault Settings</h1>
      <button type="button">Unlock Vault</button>
    </section>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/web test apps/web/src/routes/settings.vault.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/routes/settings.vault.tsx apps/web/src/routes/settings.vault.test.tsx && git commit -m "feat(web-settings): add vault settings page"
```

### Task 65: Text-to-SQL Browser View

**Files:**
- Create: `apps/web/src/routes/sql.tsx`
- Test: `apps/web/src/routes/sql.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SqlBrowserPage } from './sql.js';

describe('SqlBrowserPage', () => {
  it('shows natural language query input', () => {
    expect(renderToString(<SqlBrowserPage />)).toContain('Ask database in natural language');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/web test apps/web/src/routes/sql.test.tsx`
Expected: FAIL with missing SqlBrowserPage.

**Step 3: Write minimal implementation**

```tsx
export function SqlBrowserPage() {
  return (
    <section>
      <h1>Text-to-SQL Browser</h1>
      <textarea placeholder="Ask database in natural language" />
      <pre>Generated SQL will appear here</pre>
    </section>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/web test apps/web/src/routes/sql.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/routes/sql.tsx apps/web/src/routes/sql.test.tsx && git commit -m "feat(web-sql): add text-to-sql browser page"
```

### Task 66: Chat Page Wiring

**Files:**
- Create: `apps/web/src/routes/index.tsx`
- Test: `apps/web/src/routes/index.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ChatPage } from './index.js';

describe('ChatPage', () => {
  it('renders Automate chat heading', () => {
    expect(renderToString(<ChatPage />)).toContain('Automate Chat');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/web test apps/web/src/routes/index.test.tsx`
Expected: FAIL with missing ChatPage.

**Step 3: Write minimal implementation**

```tsx
import { useAutomateChat } from '../hooks/use-automate-chat.js';
import { ChatShell } from '../components/chat/chat-shell.js';

export function ChatPage() {
  const { messages, append } = useAutomateChat();
  return (
    <section>
      <h1>Automate Chat</h1>
      <ChatShell
        messages={messages.map((m) => ({ id: m.id, role: m.role as 'user' | 'assistant', text: m.parts.map((p) => ('text' in p ? p.text : '')).join('') }))}
        onSubmit={(value) => append({ role: 'user', content: value })}
      />
    </section>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/web test apps/web/src/routes/index.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/routes/index.tsx apps/web/src/routes/index.test.tsx && git commit -m "feat(web-chat): wire chat route to useChat and ai elements"
```

## Phase 8: Desktop + Docker

### Task 67: Dockerfile for Server + Web

**Files:**
- Create: `Dockerfile`
- Test: `Dockerfile`

**Step 1: Create file with exact contents**

```dockerfile
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .eslintrc.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm build

EXPOSE 3000
CMD ["pnpm", "--filter", "@automate/server", "dev"]
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `docker build -t automate:latest .`
Expected: image builds successfully.

**Step 3: Commit**

```bash
git add Dockerfile && git commit -m "chore(docker): add automate container image"
```

### Task 68: Docker Compose with Ollama Sidecar

**Files:**
- Create: `docker-compose.yml`
- Test: `docker-compose.yml`

**Step 1: Create file with exact contents**

```yaml
services:
  automate:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./connectors:/app/connectors
    environment:
      - OLLAMA_HOST=http://ollama:11434
    depends_on:
      - ollama

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama

volumes:
  ollama-data:
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `docker compose config`
Expected: compose file validates with no errors.

**Step 3: Commit**

```bash
git add docker-compose.yml && git commit -m "chore(docker): add ollama sidecar compose stack"
```

### Task 69: Tauri Sidecar Mapping

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Test: `apps/desktop/src-tauri/tauri.conf.json`

**Step 1: Create file with exact contents**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Automate",
  "version": "0.1.0",
  "identifier": "com.automate.app",
  "build": { "frontendDist": "../web/dist", "beforeDevCommand": "pnpm --filter @automate/web dev", "beforeBuildCommand": "pnpm --filter @automate/web build" },
  "app": { "windows": [{ "title": "Automate", "width": 1280, "height": 900 }] },
  "bundle": { "active": true, "targets": "all" }
}
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm --filter @automate/desktop build`
Expected: tauri config loads and build starts.

**Step 3: Commit**

```bash
git add apps/desktop/src-tauri/tauri.conf.json && git commit -m "chore(desktop): configure tauri build and webview linkage"
```

### Task 70: Air-gapped Deployment Doc

**Files:**
- Create: `docs/air-gapped.md`
- Test: `docs/air-gapped.md`

**Step 1: Create file with exact contents**

```markdown
# Air-Gapped Build

1. Mirror npm dependencies into internal registry.
2. Build Docker image with offline npm cache baked in.
3. Pre-pull Ollama models: `ollama pull llama3.1` and export model cache.
4. Bundle `data/` and `vault.db` on encrypted storage.
5. Disable telemetry in all runtime configs.
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm build`
Expected: docs addition does not break build.

**Step 3: Commit**

```bash
git add docs/air-gapped.md && git commit -m "docs: add air-gapped deployment guide"
```

## Cross-Phase Completion Tasks (to reach full implementation scope)

### Task 71: Server Entry Wiring

**Files:**
- Modify: `apps/server/src/index.ts`
- Test: `apps/server/src/index.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildServer } from './index.js';

describe('server wiring', () => {
  it('registers /health route', async () => {
    const app = await buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/index.test.ts`
Expected: FAIL if buildServer missing.

**Step 3: Write minimal implementation**

```ts
import Fastify from 'fastify';
import { chatRoutes } from './routes/chat.js';

export async function buildServer() {
  const app = Fastify();
  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(chatRoutes);
  return app;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/index.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/index.ts apps/server/src/index.test.ts && git commit -m "feat(server): wire health and chat routes"
```

### Task 72: SQL Safety Regex (Dashboard Reuse)

**Files:**
- Create: `packages/connectors/sql-browser/src/safety.ts`
- Test: `packages/connectors/sql-browser/src/safety.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_KEYWORDS, validateSQL } from './safety.js';

describe('sql safety', () => {
  it('rejects DDL and DML statements', () => {
    expect(FORBIDDEN_KEYWORDS.test('DROP TABLE users')).toBe(true);
    expect(validateSQL('SELECT * FROM runs').valid).toBe(true);
    expect(validateSQL('DELETE FROM runs').valid).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test packages/connectors/sql-browser/src/safety.test.ts`
Expected: FAIL with missing exports.

**Step 3: Write minimal implementation**

```ts
export const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i;

export function validateSQL(sql: string): { valid: boolean; reason?: string } {
  const trimmed = sql.trim();
  if (!trimmed) return { valid: false, reason: 'Empty SQL query' };
  if (FORBIDDEN_KEYWORDS.test(trimmed)) return { valid: false, reason: 'Forbidden keyword detected — only SELECT queries allowed' };
  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) return { valid: false, reason: 'Query must start with SELECT' };
  return { valid: true };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test packages/connectors/sql-browser/src/safety.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/sql-browser/src/safety.ts packages/connectors/sql-browser/src/safety.test.ts && git commit -m "feat(connector-sql): add dashboard safety guards"
```

### Task 73: AI Provider Config Endpoint (Dashboard Pattern)

**Files:**
- Create: `apps/server/src/routes/model-config.ts`
- Test: `apps/server/src/routes/model-config.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { maskApiKey } from './model-config.js';

describe('maskApiKey', () => {
  it('keeps only prefix and suffix', () => {
    expect(maskApiKey('abcdefgh1234')).toBe('abcdefgh...1234');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/routes/model-config.test.ts`
Expected: FAIL with missing maskApiKey.

**Step 3: Write minimal implementation**

```ts
import type { FastifyInstance } from 'fastify';

export function maskApiKey(apiKey: string) {
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

export async function modelConfigRoutes(app: FastifyInstance) {
  app.get('/api/model-config', async () => ({ provider: 'ollama', model: 'llama3.1', endpoint: 'http://localhost:11434' }));
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/routes/model-config.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/routes/model-config.ts apps/server/src/routes/model-config.test.ts && git commit -m "feat(server-routes): add model config route utilities"
```

### Task 74: Process Spawn Helper for Connector Workers (Runner Pattern)

**Files:**
- Create: `apps/server/src/connectors/worker-spawn.ts`
- Test: `apps/server/src/connectors/worker-spawn.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildSpawnCommand } from './worker-spawn.js';

describe('buildSpawnCommand', () => {
  it('builds node connector entry command', () => {
    const cmd = buildSpawnCommand('packages/connectors/github/dist/index.js');
    expect(cmd.args[0]).toContain('packages/connectors/github/dist/index.js');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/connectors/worker-spawn.test.ts`
Expected: FAIL with missing buildSpawnCommand.

**Step 3: Write minimal implementation**

```ts
export function buildSpawnCommand(entryPath: string) {
  return { command: process.execPath, args: [entryPath], options: { stdio: 'pipe' as const } };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/connectors/worker-spawn.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/connectors/worker-spawn.ts apps/server/src/connectors/worker-spawn.test.ts && git commit -m "feat(server-connectors): add worker spawn command builder"
```

### Task 75: Connector Health WS Event Bridge

**Files:**
- Create: `apps/server/src/services/connector-health.ts`
- Test: `apps/server/src/services/connector-health.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildConnectorHealthEvent } from './connector-health.js';

describe('buildConnectorHealthEvent', () => {
  it('returns typed connector status event', () => {
    expect(buildConnectorHealthEvent('github', 'up').type).toBe('connector:status');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/services/connector-health.test.ts`
Expected: FAIL with missing buildConnectorHealthEvent.

**Step 3: Write minimal implementation**

```ts
export function buildConnectorHealthEvent(name: string, status: 'up' | 'down') {
  return {
    type: 'connector:status',
    payload: { name, status, at: new Date().toISOString() },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/services/connector-health.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/services/connector-health.ts apps/server/src/services/connector-health.test.ts && git commit -m "feat(server-events): add connector health event payload builder"
```

### Task 76: Flow Template Prompt Injection

**Files:**
- Create: `apps/server/src/agent/flow-prompt.ts`
- Test: `apps/server/src/agent/flow-prompt.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './flow-prompt.js';

describe('buildSystemPrompt', () => {
  it('injects flow template system prompt before user message', () => {
    const prompt = buildSystemPrompt('Use jira then slack', 'Please triage');
    expect(prompt).toContain('Use jira then slack');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/agent/flow-prompt.test.ts`
Expected: FAIL with missing buildSystemPrompt.

**Step 3: Write minimal implementation**

```ts
export function buildSystemPrompt(flowSystemPrompt: string, userMessage: string) {
  return [
    'You are Automate QA orchestration agent.',
    flowSystemPrompt,
    `User request: ${userMessage}`,
  ].join('\n\n');
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/agent/flow-prompt.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/agent/flow-prompt.ts apps/server/src/agent/flow-prompt.test.ts && git commit -m "feat(agent): add flow template prompt injector"
```

### Task 77: Frontend Conversation Sidebar Component

**Files:**
- Create: `apps/web/src/components/chat/conversation-sidebar.tsx`
- Test: `apps/web/src/components/chat/conversation-sidebar.test.tsx`

**Step 1: Write the failing test**

```tsx
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { ConversationSidebar } from './conversation-sidebar.js';

describe('ConversationSidebar', () => {
  it('renders list of conversation titles', () => {
    const html = renderToString(<ConversationSidebar items={[{ id: 'c1', title: 'Regression Gate' }]} onSelect={() => {}} />);
    expect(html).toContain('Regression Gate');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/web test apps/web/src/components/chat/conversation-sidebar.test.tsx`
Expected: FAIL with missing component.

**Step 3: Write minimal implementation**

```tsx
export function ConversationSidebar({ items, onSelect }: { items: Array<{ id: string; title: string | null }>; onSelect: (id: string) => void }) {
  return (
    <aside>
      <h2>Conversations</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onSelect(item.id)}>{item.title ?? 'Untitled'}</button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/web test apps/web/src/components/chat/conversation-sidebar.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/components/chat/conversation-sidebar.tsx apps/web/src/components/chat/conversation-sidebar.test.tsx && git commit -m "feat(web-chat): add conversation sidebar component"
```

### Task 78: MCP Tool Name Validation in Server

**Files:**
- Create: `apps/server/src/connectors/tool-name.ts`
- Test: `apps/server/src/connectors/tool-name.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { isValidToolName } from './tool-name.js';

describe('isValidToolName', () => {
  it('accepts connector.tool and rejects invalid forms', () => {
    expect(isValidToolName('github.create_issue')).toBe(true);
    expect(isValidToolName('create_issue')).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @automate/server test apps/server/src/connectors/tool-name.test.ts`
Expected: FAIL with missing isValidToolName.

**Step 3: Write minimal implementation**

```ts
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*$/;

export function isValidToolName(toolName: string) {
  return TOOL_NAME_PATTERN.test(toolName);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @automate/server test apps/server/src/connectors/tool-name.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/server/src/connectors/tool-name.ts apps/server/src/connectors/tool-name.test.ts && git commit -m "feat(server-connectors): validate namespaced tool names"
```

### Task 79: Workspace-wide Build Verification

**Files:**
- Modify: `package.json`
- Test: `package.json`

**Step 1: Create file with exact contents**

```json
{
  "scripts": {
    "verify": "pnpm build && pnpm test && pnpm typecheck && pnpm lint"
  }
}
```

**Step 2: Verify (pnpm install / pnpm build)**

Run: `pnpm verify`
Expected: all workspace checks pass.

**Step 3: Commit**

```bash
git add package.json && git commit -m "chore: add final verification script"
```

### Task 80: Final Integration Smoke Command

**Files:**
- Create: `scripts/smoke-automate.ts`
- Test: `scripts/smoke-automate.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { smokeChecklist } from './smoke-automate.js';

describe('smokeChecklist', () => {
  it('includes server web and ollama checks', () => {
    expect(smokeChecklist).toContain('server /health');
    expect(smokeChecklist).toContain('web /');
    expect(smokeChecklist).toContain('ollama /api/tags');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test scripts/smoke-automate.ts`
Expected: FAIL with missing smokeChecklist.

**Step 3: Write minimal implementation**

```ts
export const smokeChecklist = [
  'server /health',
  'web /',
  'ollama /api/tags',
  'connectors registry load',
  'chat stream first token <2s',
];

if (process.argv.includes('--print')) {
  for (const line of smokeChecklist) {
    console.log(line);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test scripts/smoke-automate.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/smoke-automate.ts && git commit -m "test: add final automate smoke checklist script"
```

---

Plan complete and saved to `docs/plans/2026-03-12-automate-implementation-plan.md`. Two execution options:

1. Subagent-Driven (this session) - I dispatch fresh subagent per task, review between tasks, fast iteration

2. Parallel Session (separate) - Open new session with executing-plans, batch execution with checkpoints

Which approach?
