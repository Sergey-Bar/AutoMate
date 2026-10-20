/**
 * Pages for the runner (docs/local/ux-spec.md, runs). Pure functions from data to HTML,
 * built on the same helpers as the other pages.
 *
 * Nothing here refreshes by itself: an automatic refresh cannot be turned off without a
 * script, and the page policy forbids scripts. A running run shows a refresh link instead.
 */
import { redactPersonal } from './redact.mjs';
import { esc, layout, statusBadge } from './ui.mjs';

/** @type {Record<string, [string, string]>} run state to [badge status, label] */
const STATE_BADGE = {
  running: ['partial', 'running'],
  succeeded: ['passed', 'succeeded'],
  failed: ['failed', 'failed'],
  'timed-out': ['timedOut', 'timed out'],
  cancelled: ['aborted', 'cancelled'],
  'output-limit': ['aborted', 'stopped at the output limit'],
  crashed: ['unknown', 'interrupted'],
  refused: ['failed', 'refused, nothing was run'],
  'launch-failed': ['errored', 'could not be started'],
};

/** @param {string} state */
export function stateBadge(state) {
  const [status, label] = STATE_BADGE[state] ?? ['unknown', state];
  return statusBadge(status, label);
}

/**
 * @param {string} text
 * @param {string[]} roots
 */
const shown = (text, roots) => esc(redactPersonal(text, { roots }));

/**
 * @param {{ repositories: Array<{ id: string, root_path: string }>, runs: any[],
 *   activeId: string | null, notice: string, message?: string,
 *   prefill?: { repositoryId?: string, argv?: string[], cwd?: string, deadlineSeconds?: number,
 *     artifactPaths?: string[], passThrough?: string[], needsValues?: string[], retryOf?: string } }} data
 */
export function runsPage(data) {
  const roots = data.repositories.map((r) => r.root_path);
  const prefill = data.prefill ?? {};
  const rows = data.runs
    .map(
      (run) =>
        `<tr><td><a href="/runs/${esc(run.id)}">${esc(run.startedAt)}</a></td><td>${stateBadge(
          run.state,
        )}</td><td><code>${shown(run.argv.join(' '), roots)}</code></td></tr>`,
    )
    .join('');
  const list =
    data.runs.length === 0
      ? '<p class="muted">Nothing has been run yet.</p>'
      : `<table><caption>Runs, newest first</caption><thead><tr><th scope="col">Started</th><th scope="col">Result</th><th scope="col">Command</th></tr></thead><tbody>${rows}</tbody></table>`;
  const options = data.repositories
    .map(
      (r) =>
        `<option value="${esc(r.id)}"${r.id === prefill.repositoryId ? ' selected' : ''}>${shown(
          r.root_path,
          [],
        )}</option>`,
    )
    .join('');
  const form =
    data.repositories.length === 0
      ? '<p>Add a repository first; a command runs inside one.</p>'
      : `<form method="post" action="/ui/runs/preview">
${prefill.retryOf ? `<input type="hidden" name="retryOf" value="${esc(prefill.retryOf)}">` : ''}
<label for="repositoryId">Repository</label><select id="repositoryId" name="repositoryId">${options}</select>
<label for="argv">Command, one argument per line</label>
<textarea id="argv" name="argv" rows="4" required aria-describedby="argv-help">${esc(
          (prefill.argv ?? []).join('\n'),
        )}</textarea>
<p id="argv-help" class="muted">The first line is the program, the rest are its arguments. No shell reads this: a character such as &amp; or | is just text. A blank line in the middle is an empty argument.</p>
<label for="cwd">Folder to run in, inside the repository</label>
<input id="cwd" name="cwd" type="text" value="${esc(prefill.cwd ?? '.')}" autocomplete="off">
<label for="deadline">Deadline in seconds (required)</label>
<input id="deadline" name="deadlineSeconds" type="text" inputmode="numeric" value="${esc(
          prefill.deadlineSeconds ?? 600,
        )}" autocomplete="off" required>
<label for="artifacts">Report files this command should produce, one path per line (optional)</label>
<textarea id="artifacts" name="artifactPaths" rows="2">${esc(
          (prefill.artifactPaths ?? []).join('\n'),
        )}</textarea>
<label for="passthrough">Environment variables to pass through by name, one per line (optional)</label>
<textarea id="passthrough" name="passThrough" rows="2">${esc(
          (prefill.passThrough ?? []).join('\n'),
        )}</textarea>
<label for="env">Environment variables to set, NAME=value, one per line (optional)</label>
<textarea id="env" name="env" rows="2" aria-describedby="env-help"></textarea>
<p id="env-help" class="muted">${
          prefill.needsValues?.length
            ? `Values are not kept between runs. Enter again: <code>${esc(
                prefill.needsValues.join(', '),
              )}</code>. `
            : ''
        }Values of names that look like secrets are hidden from output.</p>
<label for="secrets">Other values to hide from output, one per line (optional)</label>
<textarea id="secrets" name="secrets" rows="2"></textarea>
<p></p><button type="submit">Preview what would run</button>
</form>`;
  return layout({
    title: 'Runs',
    body: `<h1>Runs</h1>
<div class="banner" role="note"><strong>Not isolated.</strong> ${esc(data.notice)}</div>
${data.message ? `<div class="banner bad" role="alert">${esc(data.message)}</div>` : ''}
${
  data.activeId
    ? `<div class="banner" role="status">A run is in progress: <a href="/runs/${esc(
        data.activeId,
      )}">open it</a>. Only one run at a time.</div>`
    : ''
}
<h2>Run a command</h2>${form}
<h2>History</h2>${list}`,
  });
}

/**
 * What would run, and the single button that agrees to exactly that.
 *
 * @param {{ plan: any, consentDigest: string, roots: string[] }} data
 */
export function previewPage(data) {
  const { plan, roots } = data;
  const rows = [
    [
      'Program',
      `<code>${shown(plan.resolvedExecutable, roots)}</code>${
        plan.viaCmdShim ? ' (through cmd.exe, because it is a .cmd or .bat file)' : ''
      }`,
    ],
    [
      'Arguments',
      plan.argv.slice(1).length
        ? `<ol>${plan.argv
            .slice(1)
            .map((/** @type {string} */ a) => `<li><code>${shown(a, roots)}</code></li>`)
            .join('')}</ol>`
        : '<span class="muted">none</span>',
    ],
    ['Folder', `<code>${shown(plan.cwd, roots)}</code>`],
    ['Deadline', `${esc(plan.deadlineSeconds)} seconds`],
    [
      'Variables set',
      plan.explicitEnvNames.length
        ? plan.explicitEnvNames
            .map((/** @type {string} */ n) => `<code>${esc(n)}</code>`)
            .join(', ') + ' <span class="muted">(values not shown)</span>'
        : '<span class="muted">none</span>',
    ],
    [
      'Variables passed through',
      plan.passThroughNames.length
        ? plan.passThroughNames
            .map((/** @type {string} */ n) => `<code>${esc(n)}</code>`)
            .join(', ')
        : '<span class="muted">none</span>',
    ],
    [
      'Reports expected',
      plan.artifactPaths.length
        ? plan.artifactPaths.map((/** @type {string} */ p) => `<code>${esc(p)}</code>`).join('<br>')
        : '<span class="muted">none declared</span>',
    ],
    ['Ending processes', esc(plan.platformNote)],
  ];
  return layout({
    title: 'Confirm the run',
    body: `<h1>Confirm what will run</h1>
<div class="banner bad" role="alert"><strong>Not isolated.</strong> ${esc(plan.notice)}</div>
<table><caption>The exact request</caption><tbody>${rows
      .map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`)
      .join('')}</tbody></table>
<p class="muted">Starting runs exactly this. If anything differs from what is shown here, the start is refused.</p>
<form method="post" action="/ui/runs"><input type="hidden" name="consentDigest" value="${esc(
      data.consentDigest,
    )}"><button type="submit">Run this command</button> <a href="/runs">Cancel</a></form>`,
  });
}

/**
 * @param {{ run: any, stdout: any, stderr: any, roots: string[], repositories: Array<{ id: string }> }} data
 */
export function runPage(data) {
  const { run, roots } = data;
  const collection = run.collection;
  const collectionTable =
    collection === null || collection.reports.length === 0
      ? `<p class="muted">${
          collection === null ? 'Not collected yet.' : 'This run declared no report files.'
        }</p>`
      : `<table><caption>Reports this run was expected to produce (${esc(
          collection.status,
        )})</caption><thead><tr><th scope="col">Path</th><th scope="col">What happened</th></tr></thead><tbody>${collection.reports
          .map(
            (/** @type {any} */ r) =>
              `<tr><td><code>${esc(r.path)}</code></td><td>${
                r.sha256
                  ? `<a href="/reports/${esc(r.sha256)}">${esc(r.outcome)}</a>`
                  : esc(r.outcome)
              }</td></tr>`,
          )
          .join('')}</tbody></table>`;
  /** @param {string} label @param {any} out */
  const stream = (label, out) =>
    `<h2>${label}</h2>${
      out.withheld
        ? '<p class="banner bad" role="alert">This output was withheld because it could not be redacted safely.</p>'
        : `<pre tabindex="0" aria-label="${label}">${esc(out.text)}</pre>${
            out.truncated ? '<p class="muted">Only the end of the output is shown.</p>' : ''
          }`
    }`;
  const termination = run.termination ? JSON.parse(run.termination) : null;
  const names = run.envNames ?? {};
  return layout({
    title: 'Run',
    body: `<h1>Run ${esc(run.id)}</h1>
<p>${stateBadge(run.state)}${run.reason ? ` — ${esc(run.reason)}` : ''}</p>
${
  run.state === 'running'
    ? `<div class="banner" role="status">This run is in progress. <a href="/runs/${esc(
        run.id,
      )}">Refresh</a> to see more output.</div><form method="post" action="/ui/runs/${esc(
        run.id,
      )}/cancel"><button type="submit">Cancel this run</button></form>`
    : ''
}
<table><caption>Details</caption><tbody>
<tr><th scope="row">Command</th><td><code>${shown(run.argv.join(' '), roots)}</code></td></tr>
<tr><th scope="row">Folder</th><td><code>${shown(run.cwd, roots)}</code></td></tr>
<tr><th scope="row">Started</th><td>${esc(run.startedAt)}</td></tr>
<tr><th scope="row">Finished</th><td>${
      run.finishedAt ? esc(run.finishedAt) : '<span class="muted">not yet</span>'
    }</td></tr>
<tr><th scope="row">Exit code</th><td>${
      run.exitCode === null ? '<span class="muted">none</span>' : esc(run.exitCode)
    }</td></tr>
<tr><th scope="row">Deadline</th><td>${esc(Math.round(run.deadlineMs / 1000))} s</td></tr>
<tr><th scope="row">Variables</th><td>${
      [...(names.explicit ?? []), ...(names.passThrough ?? [])]
        .map((/** @type {string} */ n) => `<code>${esc(n)}</code>`)
        .join(', ') || '<span class="muted">none beyond the defaults</span>'
    }</td></tr>
${
  termination
    ? `<tr><th scope="row">Ending the processes</th><td>${esc(termination.method)}; ${
        termination.rootGone
          ? 'the process that was started is confirmed gone'
          : '<strong>the process that was started could not be confirmed gone</strong>'
      } (${esc(termination.elapsedMs)} ms)</td></tr>`
    : ''
}
${
  run.retryOf
    ? `<tr><th scope="row">Repeats</th><td><a href="/runs/${esc(run.retryOf)}">${esc(
        run.retryOf,
      )}</a></td></tr>`
    : ''
}
</tbody></table>
<h2>Reports</h2>${collectionTable}
<p class="muted">Output is redacted after the run. Pattern-based redaction is best effort and misses secrets it does not recognise.</p>
${stream('Standard output', data.stdout)}${stream('Standard error', data.stderr)}
${
  run.state === 'running'
    ? ''
    : `<p><a href="/runs?retry=${esc(
        run.id,
      )}">Repeat this run</a> (asks for a new preview and consent)</p>`
}
<p><a href="/runs">All runs</a></p>`,
  });
}
