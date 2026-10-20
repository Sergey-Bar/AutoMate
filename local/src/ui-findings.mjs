/**
 * The findings page. Each finding shows the rule that made it, the evidence, how comparable
 * the reports were, how sure it is, and how to dismiss or verify it. Wording stays on the
 * side of "observed": nothing here names a cause.
 */
import { esc, layout } from './ui.mjs';

/** @param {string[]} items */
const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

/**
 * @param {any} f
 * @param {string} repositoryId
 */
function card(f, repositoryId) {
  const action = f.dismissed
    ? `<p class="muted">Dismissed ${esc(f.dismissal.at)} by ${esc(f.dismissal.by)}${
        f.dismissal.note ? `: ${esc(f.dismissal.note)}` : ''
      }.</p>
<form method="post" action="/ui/findings/restore"><input type="hidden" name="repositoryId" value="${esc(
        repositoryId,
      )}"><input type="hidden" name="fingerprint" value="${esc(
        f.fingerprint,
      )}"><button type="submit">Show this finding again</button></form>`
    : `<form method="post" action="/ui/findings/dismiss"><input type="hidden" name="repositoryId" value="${esc(
        repositoryId,
      )}"><input type="hidden" name="fingerprint" value="${esc(f.fingerprint)}">
<label for="note-${esc(f.id)}">Why dismiss it (kept with the dismissal)</label>
<input id="note-${esc(f.id)}" name="note" type="text" maxlength="500" autocomplete="off">
<p></p><button type="submit">Dismiss</button></form>`;
  return `<section class="card" aria-labelledby="f-${esc(f.id)}">
<h3 id="f-${esc(f.id)}">${esc(f.title)}</h3>
<table><caption>About this finding</caption><tbody>
<tr><th scope="row">Rule</th><td><code>${esc(f.rule)}</code></td></tr>
<tr><th scope="row">Confidence</th><td>${esc(f.confidence)}</td></tr>
<tr><th scope="row">Severity and priority</th><td>${esc(f.severity)}, ${esc(f.priority)}</td></tr>
<tr><th scope="row">Evidence</th><td>${list(f.evidence)}</td></tr>
<tr><th scope="row">Compared how</th><td>${esc(f.comparability)}</td></tr>
<tr><th scope="row">What it means</th><td>${esc(f.explanation)}</td></tr>
<tr><th scope="row">Suggested action</th><td>${esc(f.suggestedAction)}</td></tr>
<tr><th scope="row">How to check it is fixed</th><td>${esc(f.verify)}</td></tr>
<tr><th scope="row">False positives</th><td>${esc(f.falsePositives)}</td></tr>
</tbody></table>
${action}
</section>`;
}

/**
 * @param {{ repositories: Array<{ id: string, root_path: string }>, view: any | null,
 *   showDismissed: boolean, ai: { enabled: boolean, note: string } }} data
 */
export function findingsPage(data) {
  const { view } = data;
  const options = data.repositories
    .map(
      (r) =>
        `<option value="${esc(r.id)}"${
          view !== null && view.repository.id === r.id ? ' selected' : ''
        }>${esc(r.root_path)}</option>`,
    )
    .join('');
  const chooser =
    data.repositories.length === 0
      ? '<p>Add a repository first; findings come from comparing its scans.</p>'
      : `<form method="get" action="/findings"><label for="repository">Repository</label><select id="repository" name="repository">${options}</select>${
          data.showDismissed ? '<input type="hidden" name="dismissed" value="1">' : ''
        }<p></p><button type="submit">Show findings</button></form>`;
  let body = '';
  if (view !== null) {
    const t = view.thresholds;
    body = `<p class="muted">From ${esc(view.scans)} scan${
      view.scans === 1 ? '' : 's'
    }. A comparison is made only between reports at the same path, and a one-off scan cannot show a change. Held to: ${esc(
      `${t.repeatedFailureMin} failing reports in a row for "repeated", ${t.flakyMinExecutions} executions of one commit for "flaky", a duration change of at least ${t.durationMinDeltaMs} ms and ${t.durationRatio} times, ${t.staleDays} days for "stale", a coverage drop of ${t.coverageDropPoints} point`,
    )}. These numbers are proposals, not measurements.</p>
${
  view.findings.length === 0
    ? '<p>No findings from these scans. That does not mean nothing is wrong; it means no rule matched what was compared.</p>'
    : view.findings.map((f) => card(f, view.repository.id)).join('')
}
<p>${
      view.dismissedCount > 0
        ? data.showDismissed
          ? `<a href="/findings?repository=${esc(view.repository.id)}">Hide ${esc(
              view.dismissedCount,
            )} dismissed</a>`
          : `<a href="/findings?repository=${esc(view.repository.id)}&amp;dismissed=1">Show ${esc(
              view.dismissedCount,
            )} dismissed</a>`
        : '<span class="muted">Nothing is dismissed.</span>'
    }</p>`;
  }
  return layout({
    title: 'Findings',
    body: `<h1>Findings</h1>
<p>Findings are rule-based comparisons of stored reports. Each shows its evidence and says how sure it is. None names a cause.</p>
${chooser}${body}
<h2>AI assistance</h2>
<p>${data.ai.enabled ? 'On' : 'Off'}. ${esc(data.ai.note)} Findings above do not use it.</p>`,
  });
}
