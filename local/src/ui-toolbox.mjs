/**
 * The toolbox page: what the catalog holds, and what it suggests for one repository, with the
 * evidence for each suggestion. Nothing here installs anything; "Review the install" goes to
 * the runner's preview, where the exact command is shown and must be confirmed.
 */
import { esc, layout } from './ui.mjs';

/** @param {any} licence */
export function licenceCell(licence) {
  if (licence.status !== 'verified')
    return '<strong>Licence unverified</strong>: no licence file has been read for this entry.';
  return `${esc(licence.identifier)}, read from <a href="${esc(
    licence.source,
  )}" rel="noreferrer">the licence file</a> on ${esc(licence.verified)}. Scope: ${esc(
    licence.scope,
  )}.`;
}

/** @param {any} entry */
function list(items) {
  return items.length === 0
    ? '<span class="muted">none</span>'
    : `<ul>${items.map((/** @type {string} */ i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

/**
 * @param {any} recommendation
 * @param {{ repositoryId: string, request: any | null }} context
 */
function recommendationCard(recommendation, context) {
  const r = recommendation;
  const review =
    context.request === null
      ? `<p class="muted">${esc(r.installNote)}</p>`
      : `<form method="post" action="/ui/runs/preview">
<input type="hidden" name="repositoryId" value="${esc(context.repositoryId)}">
<input type="hidden" name="argv" value="${esc(context.request.argv.join('\n'))}">
<input type="hidden" name="cwd" value="${esc(context.request.cwd)}">
<input type="hidden" name="deadlineSeconds" value="${esc(context.request.deadlineSeconds)}">
<p class="muted">${esc(r.installNote)}</p>
<button type="submit">Review the install</button> <span class="muted">Nothing is installed until you confirm the exact command.</span>
</form>`;
  return `<section class="card" aria-labelledby="rec-${esc(r.id)}">
<h3 id="rec-${esc(r.id)}">${esc(r.title)}</h3>
<p>${esc(r.whyRelevant)}</p>
<table><caption>About this suggestion</caption><tbody>
<tr><th scope="row">Evidence</th><td>${list(r.evidence)}</td></tr>
<tr><th scope="row">Expected benefit</th><td>${esc(r.expectedBenefit)}</td></tr>
<tr><th scope="row">Cost and upkeep</th><td>${esc(r.cost)}</td></tr>
<tr><th scope="row">Needs</th><td>${list(r.compatibility)}</td></tr>
<tr><th scope="row">Limits</th><td>${list(r.limitations)}</td></tr>
<tr><th scope="row">Alternatives</th><td>${list(r.alternatives)}</td></tr>
<tr><th scope="row">Files the install changes</th><td>${list(r.filesThatChange)}</td></tr>
<tr><th scope="row">Then you change</th><td>${esc(r.configurationChange)}</td></tr>
<tr><th scope="row">How to check it worked</th><td>${esc(r.verify)}</td></tr>
<tr><th scope="row">How to undo</th><td>${esc(r.rollback)}</td></tr>
<tr><th scope="row">Licence</th><td>${licenceCell(r.licence)}</td></tr>
<tr><th scope="row">Documentation</th><td>${r.docs
    .map(
      (/** @type {any} */ d) =>
        `<a href="${esc(d.url)}" rel="noreferrer">${esc(d.title)}</a> (read ${esc(d.accessed)})`,
    )
    .join('<br>')}</td></tr>
</tbody></table>
${review}
</section>`;
}

/**
 * @param {{ repositories: Array<{ id: string, root_path: string }>, view: any | null,
 *   catalog: { catalog: any, errors: string[] }, requests: Record<string, any> }} data
 */
export function toolboxPage(data) {
  const { catalog, view } = data;
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
      ? '<p>Add a repository first; suggestions come from what its scan found.</p>'
      : `<form method="get" action="/toolbox"><label for="repository">Repository</label><select id="repository" name="repository">${options}</select><p></p><button type="submit">Show suggestions</button></form>`;
  let suggestions = '';
  if (catalog.catalog === null) {
    suggestions = `<div class="banner bad" role="alert"><strong>The catalog was refused.</strong> Nothing is suggested from a catalog that fails its checks.<ul>${catalog.errors
      .map((e) => `<li>${esc(e)}</li>`)
      .join('')}</ul></div>`;
  } else if (view !== null) {
    suggestions =
      view.scan === null
        ? '<p class="muted">This repository has not been scanned yet.</p>'
        : view.recommendations.length === 0
          ? '<p>No suggestions from this scan. That is not a statement that nothing could be improved; it means no catalog rule matched what the scan found.</p>'
          : view.recommendations
              .map((r) =>
                recommendationCard(r, {
                  repositoryId: view.repository.id,
                  request: data.requests[r.id] ?? null,
                }),
              )
              .join('');
    if (view.suppressed.length > 0) {
      suggestions += `<h3>Not suggested</h3><ul>${view.suppressed
        .map(
          (s) =>
            `<li><code>${esc(s.toolId)}</code> in ${esc(s.projectPath)}: ${esc(s.reason)}</li>`,
        )
        .join('')}</ul>`;
    }
  }
  const tools =
    catalog.catalog === null
      ? ''
      : `<h2>The catalog</h2><p class="muted">${esc(
          catalog.catalog.tools.length,
        )} entries, updated ${esc(
          catalog.catalog.updated,
        )}. It is data shipped with this version; it is not fetched from anywhere.</p><table><caption>Catalog entries</caption><thead><tr><th scope="col">Tool</th><th scope="col">Category</th><th scope="col">Licence</th></tr></thead><tbody>${catalog.catalog.tools
          .map(
            (/** @type {any} */ t) =>
              `<tr><td>${esc(t.name)}</td><td>${esc(t.category)}</td><td>${licenceCell(
                t.licence,
              )}</td></tr>`,
          )
          .join('')}</tbody></table>`;
  return layout({
    title: 'Toolbox',
    body: `<h1>Toolbox</h1>
<p>Suggestions are based on what a scan found in your repository, and each shows its evidence. A tool being absent is not evidence of a problem.</p>
${chooser}<h2>Suggestions</h2>${suggestions}${tools}`,
  });
}
