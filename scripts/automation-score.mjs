#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_REPORT_PATH = '.artifacts/automation-playwright-report.json';
const DEFAULT_TARGET_SEC_PER_TEST = 8;
const DEFAULT_FAIL_UNDER = 75;

function parseArgs(argv) {
  const args = {
    run: false,
    project: 'vertical-slice',
    reportPath: DEFAULT_REPORT_PATH,
    fromReport: null,
    json: false,
    failUnder: DEFAULT_FAIL_UNDER,
    requireZeroFailures: true,
    targetSecPerTest: Number(process.env['AUTOMATION_SCORE_TARGET_SEC_PER_TEST'] ?? DEFAULT_TARGET_SEC_PER_TEST),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--run') {
      args.run = true;
      continue;
    }

    if (token === '--json') {
      args.json = true;
      continue;
    }

    if (token === '--no-require-zero-failures') {
      args.requireZeroFailures = false;
      continue;
    }

    if (token === '--project' && argv[i + 1]) {
      args.project = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === '--report-path' && argv[i + 1]) {
      args.reportPath = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === '--from-report' && argv[i + 1]) {
      args.fromReport = argv[i + 1];
      i += 1;
      continue;
    }

    if (token === '--fail-under' && argv[i + 1]) {
      args.failUnder = Number(argv[i + 1]);
      i += 1;
      continue;
    }

    if (token === '--target-sec-per-test' && argv[i + 1]) {
      args.targetSecPerTest = Number(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function readJson(path) {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function gradeForScore(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function computeScore(report, targetSecPerTest) {
  const stats = report?.stats ?? {};

  const expected = safeNumber(stats.expected);
  const unexpected = safeNumber(stats.unexpected);
  const flaky = safeNumber(stats.flaky);
  const skipped = safeNumber(stats.skipped);
  const durationMs = safeNumber(stats.duration);

  const executed = expected + unexpected + flaky;
  const total = executed + skipped;

  if (executed === 0) {
    return {
      score: 0,
      grade: 'F',
      metrics: {
        expected,
        unexpected,
        flaky,
        skipped,
        total,
        executed,
        durationMs,
        durationSec: 0,
        durationSecPerTest: 0,
        passRate: 0,
        flakyRate: 0,
        skipRate: 0,
      },
      components: {
        pass: 0,
        flaky: 0,
        skip: 0,
        speed: 0,
      },
      reasons: ['No executed tests in report'],
    };
  }

  const durationSec = durationMs / 1000;
  const durationSecPerTest = durationSec / executed;

  const passRate = clamp01(expected / executed);
  const flakyRate = clamp01(flaky / executed);
  const skipRate = total > 0 ? clamp01(skipped / total) : 0;

  const passScore = passRate * 65;
  const flakyScore = (1 - flakyRate) * 15;
  const skipScore = (1 - skipRate) * 10;

  const speedRatio = clamp01(targetSecPerTest / Math.max(durationSecPerTest, 0.001));
  const speedScore = speedRatio * 10;

  let score = Math.round(passScore + flakyScore + skipScore + speedScore);
  const reasons = [];

  if (unexpected > 0) {
    score = Math.min(score, 59);
    reasons.push('Unexpected test failures cap score at 59');
  }

  if (flaky > 0) {
    reasons.push('Flaky tests reduce reliability score');
  }

  if (skipped > 0) {
    reasons.push('Skipped tests reduce confidence score');
  }

  return {
    score,
    grade: gradeForScore(score),
    metrics: {
      expected,
      unexpected,
      flaky,
      skipped,
      total,
      executed,
      durationMs,
      durationSec,
      durationSecPerTest,
      passRate,
      flakyRate,
      skipRate,
    },
    components: {
      pass: Number(passScore.toFixed(2)),
      flaky: Number(flakyScore.toFixed(2)),
      skip: Number(skipScore.toFixed(2)),
      speed: Number(speedScore.toFixed(2)),
    },
    reasons,
  };
}

function runPlaywrightAndPersistReport(project, reportPath) {
  const command = `pnpm --dir e2e/integration exec playwright test --project=${project} --reporter=json`;

  const result = spawnSync(command, {
    shell: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, result.stdout ?? '', 'utf8');

  return {
    exitCode: result.status ?? 1,
    stderr: result.stderr ?? '',
  };
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function printTextSummary(summary, args, sourceReportPath) {
  const { score, grade, metrics, components, reasons } = summary;

  console.log('Automation Test Score');
  console.log('=====================');
  console.log(`Score: ${score}/100 (${grade})`);
  console.log(`Report: ${sourceReportPath}`);
  console.log('');
  console.log('Metrics');
  console.log(`- Expected: ${metrics.expected}`);
  console.log(`- Unexpected: ${metrics.unexpected}`);
  console.log(`- Flaky: ${metrics.flaky}`);
  console.log(`- Skipped: ${metrics.skipped}`);
  console.log(`- Duration: ${metrics.durationSec.toFixed(2)}s`);
  console.log(`- Duration per executed test: ${metrics.durationSecPerTest.toFixed(2)}s`);
  console.log(`- Pass rate: ${formatPercent(metrics.passRate)}`);
  console.log(`- Flaky rate: ${formatPercent(metrics.flakyRate)}`);
  console.log(`- Skip rate: ${formatPercent(metrics.skipRate)}`);
  console.log('');
  console.log('Score Components');
  console.log(`- Pass quality (max 65): ${components.pass}`);
  console.log(`- Flakiness penalty (max 15): ${components.flaky}`);
  console.log(`- Coverage confidence via skipped tests (max 10): ${components.skip}`);
  console.log(`- Speed target (max 10): ${components.speed} (target ${args.targetSecPerTest}s/test)`);

  if (reasons.length > 0) {
    console.log('');
    console.log('Notes');
    for (const reason of reasons) {
      console.log(`- ${reason}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let sourceReportPath = args.fromReport ? resolve(args.fromReport) : resolve(args.reportPath);

  if (args.run) {
    const runResult = runPlaywrightAndPersistReport(args.project, sourceReportPath);

    if (runResult.stderr.trim().length > 0 && !args.json) {
      console.error(runResult.stderr.trim());
    }
  }

  const report = readJson(sourceReportPath);
  const summary = computeScore(report, args.targetSecPerTest);

  const output = {
    score: summary.score,
    grade: summary.grade,
    failUnder: args.failUnder,
    requireZeroFailures: args.requireZeroFailures,
    targetSecPerTest: args.targetSecPerTest,
    metrics: summary.metrics,
    components: summary.components,
    reasons: summary.reasons,
    passedGate: summary.score >= args.failUnder && (!args.requireZeroFailures || summary.metrics.unexpected === 0),
  };

  if (args.json) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    printTextSummary(summary, args, sourceReportPath);
    console.log('');
    console.log(`Gate: ${output.passedGate ? 'PASS' : 'FAIL'} (fail-under=${args.failUnder}, require-zero-failures=${args.requireZeroFailures})`);
  }

  if (!output.passedGate) {
    process.exitCode = 1;
  }
}

main();