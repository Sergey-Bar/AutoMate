import process from 'node:process';

type ScenarioRunner = () => Promise<void>;

interface ScenarioDefinition {
  name: string;
  thresholdMs: number;
  run: ScenarioRunner;
}

interface ScenarioSummary {
  name: string;
  thresholdMs: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  result: 'PASS' | 'FAIL';
  error?: string;
}

const baseUrl = normalizeBaseUrl(process.env.PERF_BASE_URL ?? 'http://localhost');
const iterations = parsePositiveInteger(process.env.PERF_ITERATIONS ?? '100', 100);
const serviceSecret = process.env.AUTOMATE_SERVICE_SECRET ?? 'test-secret';
const requestTimeoutMs = 10_000;

async function main(): Promise<void> {
  const scenarios: ScenarioDefinition[] = [
    {
      name: 'Health via nginx',
      thresholdMs: 100,
      run: async () => {
        await assertOk(await timedFetch('/ai/health', { method: 'GET' }));
      },
    },
    {
      name: 'Trigger latency',
      thresholdMs: 500,
      run: async () => {
        await assertOk(
          await timedFetch('/dashboard/api/service/trigger-run', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Service-Auth': `Bearer ${serviceSecret}`,
            },
            body: JSON.stringify({
              specCode: 'test("perf-smoke", async () => {});',
              specFileName: 'test.spec.ts',
            }),
          }),
        );
      },
    },
    {
      name: 'Callback latency',
      thresholdMs: 200,
      run: async () => {
        await assertOk(
          await timedFetch('/ai/api/service/run-callback', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Service-Auth': `Bearer ${serviceSecret}`,
            },
            body: JSON.stringify({
              runId: 'perf-test',
              status: 'passed',
              total: 1,
              passed: 1,
              failed: 0,
            }),
          }),
        );
      },
    },
    {
      name: 'Auth validation',
      thresholdMs: 150,
      run: async () => {
        await assertOk(
          await timedFetch('/ai/api/health', {
            method: 'GET',
            headers: {
              Cookie: 'automate_dashboard_session=perf-smoke; automate_session=perf-smoke',
            },
          }),
        );
      },
    },
  ];

  const summaries: ScenarioSummary[] = [];

  for (const scenario of scenarios) {
    const summary = await runScenario(scenario);
    summaries.push(summary);
  }

  printTable(summaries);

  process.exitCode = summaries.every((summary) => summary.result === 'PASS') ? 0 : 1;
}

async function runScenario(scenario: ScenarioDefinition): Promise<ScenarioSummary> {
  try {
    const times = await measure(scenario.name, scenario.run, iterations);
    const p50 = percentile(times, 50);
    const p95 = percentile(times, 95);
    const p99 = percentile(times, 99);
    const passed = p95 < scenario.thresholdMs;

    return {
      name: scenario.name,
      thresholdMs: scenario.thresholdMs,
      p50,
      p95,
      p99,
      result: passed ? 'PASS' : 'FAIL',
    };
  } catch (error) {
    return {
      name: scenario.name,
      thresholdMs: scenario.thresholdMs,
      p50: null,
      p95: null,
      p99: null,
      result: 'FAIL',
      error: toErrorMessage(error),
    };
  }
}

async function measure(name: string, fn: () => Promise<void>, count: number): Promise<number[]> {
  void name;
  const times: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  return times.sort((left, right) => left - right);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }

  const idx = Math.ceil((sorted.length * p) / 100) - 1;
  return sorted[Math.max(0, idx)];
}

async function timedFetch(pathname: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    return await fetch(new URL(pathname, baseUrl), {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(`request failed for ${pathname}: ${toErrorMessage(error)}`);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }

  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }

  const suffix = body ? `: ${body.slice(0, 200)}` : '';
  throw new Error(`HTTP ${response.status} ${response.statusText}${suffix}`);
}

function printTable(rows: ScenarioSummary[]): void {
  const headers = ['Scenario', 'p50', 'p95', 'p99', 'Threshold', 'Result'];
  const dataRows = rows.map((row) => [
    row.name,
    formatLatency(row.p50),
    formatLatency(row.p95),
    formatLatency(row.p99),
    `<${row.thresholdMs}ms`,
    row.result,
  ]);

  const widths = headers.map((header, index) => {
    const cells = dataRows.map((row) => row[index]);
    return Math.max(header.length, ...cells.map((cell) => cell.length));
  });

  const top = border('┌', '┬', '┐', widths);
  const middle = border('├', '┼', '┤', widths);
  const bottom = border('└', '┴', '┘', widths);

  console.log(top);
  console.log(formatRow(headers, widths, true));
  console.log(middle);

  for (const row of dataRows) {
    console.log(formatRow(row, widths));
  }

  console.log(bottom);

  for (const row of rows) {
    if (row.error) {
      console.log(`${row.name}: FAIL (${row.error})`);
    }
  }
}

function border(left: string, mid: string, right: string, widths: number[]): string {
  return `${left}${widths.map((width) => '─'.repeat(width + 2)).join(mid)}${right}`;
}

function formatRow(values: string[], widths: number[], header = false): string {
  return `│${values
    .map((value, index) => {
      const width = widths[index];
      if (index === 0) {
        return ` ${value.padEnd(width)} `;
      }

      return ` ${value.padStart(width)} `;
    })
    .join('│')}│`;
}

function formatLatency(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return 'N/A';
  }

  return `${Math.round(value)}ms`;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function parsePositiveInteger(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

void main();
