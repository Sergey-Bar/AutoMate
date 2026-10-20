/**
 * Server-rendered pages (docs/local/ux-spec.md).
 *
 * Pure functions from data to HTML. Every value that came from a repository or a report goes
 * through `esc`; there is no client framework and no remote resource. Status is always a word
 * and a shape, never colour alone.
 *
 * This is deliberately not the React component library: that needs installed dependencies and
 * a build, which the environment this was written in did not have. The pages are plain enough
 * to be replaced by it without changing the engine.
 */
import { redactPersonal } from './redact.mjs';

/** @param {unknown} value */
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#14161a;--muted:#555b66;--line:#c9ced6;--card:#f5f6f8;--accent:#0b5fff;--bad:#a4001e;--warn:#8a5a00;--ok:#0a6b3a}
@media (prefers-color-scheme:dark){:root{--bg:#101215;--fg:#eceef2;--muted:#a3a9b5;--line:#343a44;--card:#181b20;--accent:#7aa7ff;--bad:#ff8097;--warn:#ffcc66;--ok:#6fdc9a}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg)}
a{color:var(--accent)}a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.skip{position:absolute;left:-999px}.skip:focus{left:8px;top:8px;background:var(--bg);padding:8px;z-index:2}
header{border-bottom:1px solid var(--line);padding:8px 24px}nav ul{display:flex;gap:16px;list-style:none;margin:0;padding:0}
main{max-width:1100px;margin:0 auto;padding:24px}h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.15rem;margin:28px 0 8px}
.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px}.card h2{margin-top:0}
.banner{border:2px solid var(--warn);border-radius:8px;padding:12px;margin:16px 0}.banner.bad{border-color:var(--bad)}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
caption{text-align:left;font-weight:600;padding:4px 0}.num{font-variant-numeric:tabular-nums;text-align:right}
.status{font-weight:600}.s-failed,.s-errored,.s-timedOut,.s-infraError,.s-rejected{color:var(--bad)}.s-unknown,.s-partial,.s-aborted,.s-notRun{color:var(--warn)}.s-passed,.s-complete{color:var(--ok)}
code,pre{font-family:ui-monospace,Consolas,monospace;font-size:.9em}pre{overflow:auto;background:var(--card);padding:8px;border-radius:6px}
label{display:block;font-weight:600;margin:12px 0 4px}input[type=text]{width:100%;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
button,.button{padding:8px 14px;border:1px solid var(--accent);background:var(--accent);color:var(--bg);border-radius:6px;font:inherit;cursor:pointer}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

/** The shape that accompanies each status word, so colour is never the only signal. */
const SHAPE = {
  passed: '●',
  complete: '●',
  failed: '✖',
  errored: '✖',
  timedOut: '✖',
  infraError: '✖',
  rejected: '✖',
  unknown: '?',
  partial: '◐',
  aborted: '■',
  notRun: '○',
  skipped: '–',
  noTests: '○',
  noneExecuted: '○',
};

/**
 * @param {string} status
 * @param {string} [label]
 */
export function statusBadge(status, label) {
  return `<span class="status s-${esc(status)}"><span aria-hidden="true">${esc(
    SHAPE[status] ?? '·',
  )}</span> ${esc(label ?? status)}</span>`;
}

/**
 * @param {{ title: string, body: string, nav?: boolean, script?: string, csp?: string }} page
 */
export function layout(page) {
  const nav =
    page.nav === false
      ? ''
      : `<header><nav aria-label="Primary"><ul>
<li><a href="/">Repositories</a></li>
<li><a href="/runs">Runs</a></li>
<li><a href="/toolbox">Toolbox</a></li>
<li><a href="/findings">Findings</a></li>
</ul></nav></header>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title)} — AUTOMATE (local)</title><style>${CSS}</style></head>
<body><a class="skip" href="#main">Skip to content</a>${nav}
<main id="main" tabindex="-1">${page.body}</main>${page.script ?? ''}</body></html>`;
}

/** The only page served before a session exists. Reads the token from the URL fragment. */
export const BOOTSTRAP_SCRIPT_SOURCE = `const t=new URLSearchParams(location.hash.slice(1)).get('t');
if(t){fetch('/api/v1/session',{method:'POST',headers:{Authorization:'Bearer '+t}}).then(r=>{if(r.ok){history.replaceState(null,'','/');location.reload();}else{document.getElementById('msg').textContent='The token was not accepted. Start AUTOMATE again and open the address it prints.';}});}`;

export function bootstrapPage() {
  return layout({
    title: 'Opening',
    nav: false,
    body: `<h1>AUTOMATE (local)</h1><p id="msg" role="status">Opening your session. If nothing happens, open the address that was printed when AUTOMATE started; it contains a one-time token after the # sign.</p><noscript><p>This page needs JavaScript once, to hand the token to the server.</p></noscript>`,
    script: `<script>${BOOTSTRAP_SCRIPT_SOURCE}</script>`,
  });
}

/** @param {{ message?: string }} [state] */
export function onboardingPage(state = {}) {
  return layout({
    title: 'Choose a repository',
    body: `<h1>Choose a repository</h1>
<p>AUTOMATE (local) finds the test tools and reports in a folder on this computer and shows what they say. It <strong>only reads</strong> the folder: nothing is run and nothing is written to it.</p>
${state.message ? `<div class="banner bad" role="alert">${esc(state.message)}</div>` : ''}
<form method="post" action="/ui/repositories">
<label for="path">Folder path</label>
<input id="path" name="path" type="text" autocomplete="off" required aria-describedby="path-help">
<p id="path-help" class="muted">For example the root of a project. A filesystem root is refused.</p>
<button type="submit">Scan this folder</button>
</form>`,
  });
}

/** @param {Array<{ id: string, root_path: string, last_scan_at: string | null }>} repositories */
export function repositoriesPage(repositories) {
  if (repositories.length === 0) return onboardingPage();
  const rows = repositories
    .map(
      (r) =>
        `<tr><td><a href="/repositories/${esc(r.id)}"><code>${esc(
          r.root_path,
        )}</code></a></td><td>${
          r.last_scan_at ? esc(r.last_scan_at) : '<span class="muted">not scanned</span>'
        }</td></tr>`,
    )
    .join('');
  return layout({
    title: 'Repositories',
    body: `<h1>Repositories</h1><table><caption>Registered repositories</caption><thead><tr><th scope="col">Folder</th><th scope="col">Last scanned</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Add another</h2><form method="post" action="/ui/repositories"><label for="path">Folder path</label><input id="path" name="path" type="text" autocomplete="off" required><p></p><button type="submit">Scan this folder</button></form>`,
  });
}

/** @param {number | null} ms */
function age(ms) {
  if (ms === null) return 'no file time';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${String(hours)} h ago` : `${String(Math.round(hours / 24))} days ago`;
}

/**
 * A rate with its denominator, or the reason it is missing.
 *
 * @param {any} k
 * @param {string} label
 */
function rateCell(k, label) {
  if (k.value === null)
    return `<tr><th scope="row">${esc(label)}</th><td colspan="2"><strong>Missing</strong>: ${esc(
      k.missing,
    )}</td></tr>`;
  const excluded = [
    k.unknown ? `${String(k.unknown)} unknown` : '',
    k.nonProduct ? `${String(k.nonProduct)} not a product outcome` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return `<tr><th scope="row">${esc(label)}</th><td class="num">${(k.value * 100).toFixed(
    1,
  )}%</td><td>${String(k.numerator)} of ${String(k.denominator)} product attempts${
    excluded ? `; excluded: ${esc(excluded)}` : ''
  }${
    k.confidence === 'low'
      ? '; <strong>low confidence</strong> (some reports are not complete)'
      : ''
  }</td></tr>`;
}

/** @param {any} dash the engine's dashboard */
export function dashboardPage(dash) {
  const { repository, scan, kpis } = dash;
  const partial = scan && scan.status !== 'complete';
  const banners = [];
  if (partial) {
    banners.push(
      `<div class="banner" role="status"><strong>This scan is ${esc(scan.status)}.</strong> ${
        scan.summary.limitsHit.length
          ? `Limit reached: ${esc(scan.summary.limitsHit.join(', '))}. `
          : ''
      }The figures below cover only what was read.</div>`,
    );
  }
  const notComplete =
    kpis.completeness.partial + kpis.completeness.unknown + kpis.completeness.rejected;
  if (notComplete > 0) {
    banners.push(
      `<div class="banner" role="status"><strong>${String(notComplete)} report${
        notComplete === 1 ? ' is' : 's are'
      } not complete.</strong> The numbers cover only the readable parts; see the list of reports.</div>`,
    );
  }

  const noReports = kpis.testsFound.value === null && kpis.coverageByType.value === null;
  const empty = noReports
    ? `<div class="card"><h2>No test results found</h2><p>${
        kpis.reportsFound.found === 0
          ? 'No report files were found in this folder.'
          : 'Report files were found, but none could be read; see the list below.'
      } Nothing is shown as zero because nothing was measured.</p></div>`
    : '';

  const outcomes = kpis.testsByOutcome.value
    ? `<table><caption>Tests by outcome (K-02)</caption><thead><tr><th scope="col">Outcome</th><th scope="col" class="num">Tests</th></tr></thead><tbody>${Object.entries(
        kpis.testsByOutcome.value,
      )
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `<tr><td>${statusBadge(k)}</td><td class="num">${String(n)}</td></tr>`)
        .join('')}</tbody><tfoot><tr><th scope="row">Total</th><td class="num">${String(
        kpis.testsByOutcome.total,
      )}</td></tr></tfoot></table>`
    : `<p><strong>Tests by outcome: missing</strong> (${esc(kpis.testsByOutcome.missing)}).</p>`;

  const coverage = kpis.coverageByType.value
    ? `<table><caption>Coverage (K-08)</caption><thead><tr><th scope="col">Type</th><th scope="col" class="num">Hit / found</th><th scope="col" class="num">Percent</th></tr></thead><tbody>${[
        'lines',
        'functions',
        'branches',
      ]
        .map((type) => {
          const c = kpis.coverageByType.value[type];
          return c.value === null
            ? `<tr><th scope="row">${type}</th><td colspan="2"><strong>Not reported</strong></td></tr>`
            : `<tr><th scope="row">${type}</th><td class="num">${String(c.hit)} / ${String(
                c.found,
              )}</td><td class="num">${
                c.percent === null
                  ? '<strong>n/a</strong> (nothing found)'
                  : `${String(c.percent)}%`
              }</td></tr>`;
        })
        .join('')}</tbody></table>`
    : `<p><strong>Coverage: missing</strong> (${esc(kpis.coverageByType.missing)}).</p>`;

  const durations =
    kpis.durationP50.value === null
      ? '<tr><th scope="row">Duration</th><td colspan="2"><strong>Missing</strong>: no attempt has a valid duration</td></tr>'
      : `<tr><th scope="row">Duration median / 95th percentile</th><td class="num">${String(
          kpis.durationP50.value,
        )} ms / ${String(kpis.durationP95.value)} ms</td><td>${String(
          kpis.durationP50.attempts,
        )} attempts with a duration</td></tr>`;

  const reports = dash.items
    .map((item) => {
      const result = item.result;
      const status =
        result.kind === 'run'
          ? result.runStatus
          : result.kind === 'rejected'
            ? 'rejected'
            : result.completeness;
      const warn = result.warnings.length
        ? ` <span class="muted">${esc(result.warnings.join(', '))}</span>`
        : '';
      return `<tr><td><a href="/reports/${esc(item.sha256)}"><code>${esc(
        item.sha256.slice(0, 12),
      )}</code></a></td><td>${esc(result.format)}</td><td>${statusBadge(status)}${
        result.kind === 'rejected' ? ` ${esc(result.rejection)}` : ''
      }</td><td>${statusBadge(result.completeness)}${warn}</td><td>${age(
        kpis.freshness.find((f) => f.id === item.id)?.ageMs ?? null,
      )}</td></tr>`;
    })
    .join('');

  const tools = kpis.toolsDetected.value?.length
    ? `<ul>${kpis.toolsDetected.value
        .map(
          (t) =>
            `<li><strong>${esc(t.tool)}</strong> in <code>${esc(
              t.project,
            )}</code> — confidence ${String(
              t.confidence,
            )} (detector's own, not a gate); evidence: ${t.evidence
              .map((e) => `<code>${esc(e)}</code>`)
              .join(', ')}</li>`,
        )
        .join('')}</ul>`
    : `<p>${kpis.toolsDetected.note ? 'Nothing recognised in this folder.' : 'Not scanned.'}</p>`;

  const disagreements = dash.reconciliation.disagreements.length
    ? `<table><caption>Reports that disagree (K-13)</caption><thead><tr><th scope="col">Test</th><th scope="col">Sources</th></tr></thead><tbody>${dash.reconciliation.disagreements
        .map(
          (d) =>
            `<tr><td><code>${esc(d.testKey)}</code></td><td>${d.sources
              .map((s) => `${esc(s.format)}: ${statusBadge(s.outcome)}`)
              .join('; ')} — no winner chosen</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p>No two reports of the same execution disagree.</p>';

  return layout({
    title: repository.root_path,
    body: `<h1>Dashboard</h1><p class="muted"><code>${esc(
      repository.root_path,
    )}</code> — scanned ${esc(scan ? scan.finished_at : 'never')}${
      repository.commit_ref
        ? ` at commit <code>${esc(repository.commit_ref.slice(0, 12))}</code>`
        : ''
    }</p>
${banners.join('')}${empty}
<div class="grid">
<section class="card" aria-labelledby="h-tests"><h2 id="h-tests">Results</h2>${outcomes}
<table><caption>Rates (K-03, K-04, K-05, K-06, K-07)</caption><tbody>${rateCell(
      kpis.firstPassRate,
      'First-pass rate',
    )}${rateCell(kpis.executionFailureRate, 'Failure rate')}${rateCell(
      kpis.retryRecoveredRate,
      'Retry-recovered rate',
    )}${durations}</tbody></table>
<p class="muted">A pass rate is not a quality score. A retry-recovered rate counts only retries a report records; it is not a flakiness measure.</p></section>
<section class="card" aria-labelledby="h-cov"><h2 id="h-cov">Coverage</h2>${coverage}</section>
<section class="card" aria-labelledby="h-rep"><h2 id="h-rep">Reports</h2>
<p>Found ${String(kpis.reportsFound.found)}; read ${String(
      kpis.reportsFound.read,
    )}; rejected ${String(kpis.reportsFound.rejected)}; extra copies ${String(
      kpis.reportsFound.duplicates,
    )}; unreadable ${String(kpis.reportsFound.unread)} (K-11). Newest report ${esc(
      kpis.newestReportMs === null ? 'has no file time' : age(kpis.newestReportMs),
    )}; oldest ${esc(
      kpis.oldestReportMs === null ? 'has no file time' : age(kpis.oldestReportMs),
    )} (K-09).</p></section>
<section class="card" aria-labelledby="h-tools"><h2 id="h-tools">Test tools detected (K-12)</h2>${tools}</section>
</div>
<h2>Disagreements</h2>${disagreements}
<h2>All reports</h2>${
      reports
        ? `<table><caption>Reports read, with completeness</caption><thead><tr><th scope="col">Report</th><th scope="col">Format</th><th scope="col">Result</th><th scope="col">Completeness</th><th scope="col">File age</th></tr></thead><tbody>${reports}</tbody></table>`
        : '<p>None.</p>'
    }
<form method="post" action="/ui/repositories"><input type="hidden" name="path" value="${esc(
      repository.root_path,
    )}"><button type="submit">Rescan</button></form>
<h2>Import a CI artifact archive</h2>
<form method="post" action="/ui/imports"><input type="hidden" name="repositoryId" value="${esc(
      repository.id,
    )}">
<label for="archive">Path of a .zip file on this computer</label><input id="archive" name="path" type="text" autocomplete="off" required aria-describedby="archive-help">
<p id="archive-help" class="muted">Reports inside it are read in memory; nothing in the archive is written to disk or run.</p>
<button type="submit">Import reports</button></form>`,
  });
}

const WARNING_WORDS = {
  'doctype-ignored': 'A document type declaration was present and was skipped without being read.',
  'entity-undefined':
    'The report refers to an entity this reader does not define; it was left as text and the report is not well-formed.',
  'xml-malformed': 'The document is not well-formed.',
  'xml-truncated': 'The document ended inside an element; the last test is unknown.',
  'invalid-encoding-bytes': 'Some bytes were not valid in the declared encoding and were replaced.',
  'declared-count-mismatch':
    'Counts the report declares disagree with the tests it contains. The tests were counted.',
  'duplicate-identity':
    'Several tests share one identity with no retry evidence; they are kept separate.',
  'skipped-and-failed': 'A test is marked both skipped and failed; it is counted as failed.',
  'path-absolute': 'A file name was absolute and could not be made relative to the repository.',
  'path-unsafe': 'A file name tried to leave the repository and was not stored.',
  'duration-invalid': 'A duration was not a valid non-negative number.',
  'message-truncated': 'A failure message was cut at the size limit.',
  'test-limit-reached':
    'The test count limit stopped reading; the results present are not all of them.',
  'unknown-status':
    'The report used a status this model has no mapping for; it is shown as unknown.',
  'null-entry': 'A suite or test entry was empty, typically a worker that never reported.',
  'run-level-errors': 'The report carries errors that belong to the run rather than to a test.',
  'lcov-bad-line': 'A coverage line could not be read.',
  'lcov-truncated': 'A coverage record never closed.',
  'lcov-count-mismatch': 'Declared coverage totals disagree with the detail; the detail was used.',
  'metric-not-reported-by-all-files': 'A total covers only the files that report that metric.',
  'cobertura-bad-line': 'A coverage line could not be read.',
  'cobertura-class-without-filename': 'A class named no file, so it was left out.',
  'cobertura-count-mismatch':
    'Declared coverage totals disagree with the detail; the detail was used.',
  'cobertura-no-classes': 'The report lists no classes.',
};

/**
 * @param {any} detail from `engine.report`
 * @param {{ roots?: string[] }} [options] repository roots, so paths in messages are redacted
 */
export function reportPage(detail, options = {}) {
  const scrub = (text) => redactPersonal(text, { roots: options.roots ?? [] });
  const { artifact, locations, result } = detail;
  const warnings = (result?.warnings ?? [])
    .map(
      (w) =>
        `<li><code>${esc(w)}</code> — ${esc(
          WARNING_WORDS[w] ?? 'See the data contracts document.',
        )}</li>`,
    )
    .join('');
  let body;
  if (result === null)
    body =
      '<div class="banner bad" role="alert">The stored copy has no readable result. It cannot be trusted.</div>';
  else if (result.kind === 'rejected')
    body = `<div class="banner bad" role="alert"><strong>Rejected:</strong> ${esc(
      result.rejection,
    )}. Nothing was read from this file.</div>`;
  else if (result.kind === 'run') {
    body =
      result.tests.length === 0
        ? '<p><strong>This report contains no tests.</strong></p>'
        : `<table><caption>Results</caption><thead><tr><th scope="col">Test</th><th scope="col">Outcome</th><th scope="col" class="num">Attempts</th><th scope="col">File</th><th scope="col">Message</th></tr></thead><tbody>${result.tests
            .map(
              (t) =>
                `<tr><td>${esc(t.name)}${
                  t.project ? ` <span class="muted">[${esc(t.project)}]</span>` : ''
                }</td><td>${statusBadge(t.outcome)}${
                  t.flakiness === 'observed'
                    ? ' <span class="muted">(passed after a retry)</span>'
                    : ''
                }</td><td class="num">${String(t.attempts.length)}</td><td>${
                  t.file ? `<code>${esc(t.file)}</code>` : '<span class="muted">none</span>'
                }</td><td>${esc(
                  scrub(t.attempts.find((a) => a.message)?.message ?? '').slice(0, 200),
                )}</td></tr>`,
            )
            .join('')}</tbody></table>`;
  } else {
    body = `<table><caption>Coverage totals</caption><tbody>${['lines', 'functions', 'branches']
      .map((type) => {
        const t = result.totals[type];
        return t === null
          ? `<tr><th scope="row">${type}</th><td><strong>Not reported</strong></td></tr>`
          : `<tr><th scope="row">${type}</th><td>${String(t.hit)} / ${String(t.found)} — ${
              t.percent === null ? 'n/a' : `${String(t.percent)}%`
            }</td></tr>`;
      })
      .join('')}</tbody></table>`;
  }
  return layout({
    title: `Report ${artifact.id.slice(0, 12)}`,
    body: `<h1>Report <code>${esc(artifact.id.slice(0, 12))}</code></h1>
<dl><dt>Format</dt><dd>${esc(artifact.format)}</dd><dt>Size</dt><dd>${String(
      artifact.byte_size,
    )} bytes</dd>
<dt>Completeness</dt><dd>${result ? statusBadge(result.completeness) : statusBadge('unknown')}</dd>
<dt>Found at</dt><dd><ul>${locations
      .map((l) => `<li><code>${esc(l.path)}</code></li>`)
      .join('')}</ul></dd></dl>
<p><a class="button" href="/api/v1/reports/${esc(
      artifact.id,
    )}/raw" download>Download the original file</a></p>
${warnings ? `<h2>Warnings</h2><ul>${warnings}</ul>` : ''}${body}`,
  });
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
export function errorPage(status, code, message) {
  return layout({
    title: `Error ${String(status)}`,
    body: `<h1>${String(status)} <code>${esc(code)}</code></h1><p>${esc(
      message,
    )}</p><p><a href="/">Back to repositories</a></p>`,
  });
}
