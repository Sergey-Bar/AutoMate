/**
 * The toolbox (Phase 3): a data-only catalog, evidence-backed recommendations, and an
 * install PREVIEW that hands the actual installation to the runner's consent path.
 *
 * Rules from docs/local/toolbox-and-intelligence.md that this module enforces:
 *
 * - the catalog is data: an entry with an unknown field, executable-looking text, a non-https
 *   link or an unverifiable licence claim is rejected;
 * - a licence is "unverified" unless the entry cites the licence file and the date it was read;
 * - a recommendation without repository evidence is never produced;
 * - the absence of a tool is never worded as a quality problem;
 * - a tool that is already present, or equivalent to one that is, is not recommended, and
 *   the reason is kept so it can be shown;
 * - installation is never applied here: this module builds a request, and the runner's
 *   preview and consent decide whether it runs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

export const CATALOG_PATH = path.resolve(import.meta.dirname, '..', 'catalog', 'tools.json');

const RULES = new Set(['missing-coverage-report', 'missing-junit-report']);
const CATEGORIES = new Set(['coverage', 'reporting']);
const INSTALL_KINDS = new Set(['npm-package', 'pip-package']);
// Two flat patterns rather than one with an optional scope group: a quantifier inside an
// optional group is the shape `security/detect-unsafe-regex` refuses.
const NPM_UNSCOPED = /^[a-z0-9-~][a-z0-9-._~]*$/;
const NPM_SCOPED = /^@[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*$/;
const NPM_NAME = { test: (value) => NPM_UNSCOPED.test(value) || NPM_SCOPED.test(value) };
const PIP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Text that looks like it is meant to be run or rendered, not read. */
const EXECUTABLE_LOOKING = /`|\$\(|<script|javascript:|\bsudo\b|\|\s*(?:sh|bash)\b/i;

const ENTRY_FIELDS = new Set([
  'id',
  'name',
  'category',
  'purpose',
  'languages',
  'appliesTo',
  'rule',
  'equivalentPlugins',
  'install',
  'configurationChange',
  'verify',
  'licence',
  'requirements',
  'maintenance',
  'limitations',
  'alternatives',
  'docs',
]);
const TOP_FIELDS = new Set(['schema', 'updated', 'note', 'tools']);

/** Control characters other than tab, line feed and carriage return. @param {string} value */
function hasControlCharacter(value) {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
  }
  return false;
}

/**
 * @param {unknown} value
 * @param {string} where
 * @param {string[]} errors
 * @param {{ max?: number }} [limit]
 */
function text(value, where, errors, limit = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${where}: must be a non-empty string`);
    return;
  }
  if (value.length > (limit.max ?? 600)) errors.push(`${where}: too long`);
  if (hasControlCharacter(value)) errors.push(`${where}: contains control characters`);
  if (EXECUTABLE_LOOKING.test(value)) errors.push(`${where}: contains text that looks executable`);
}

/**
 * @param {unknown} value
 * @param {string} where
 * @param {string[]} errors
 */
function httpsUrl(value, where, errors) {
  text(value, where, errors, { max: 300 });
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') errors.push(`${where}: must be an https URL`);
      if (url.username !== '' || url.password !== '')
        errors.push(`${where}: must not carry credentials`);
    } catch {
      errors.push(`${where}: not a URL`);
    }
  }
}

/**
 * @param {unknown} value
 * @param {string} where
 * @param {string[]} allowed
 * @param {string[]} errors
 */
function onlyFields(value, where, allowed, errors) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${where}: must be an object`);
    return false;
  }
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) errors.push(`${where}: unknown field "${key}"`);
  return true;
}

/**
 * @param {unknown} data
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateCatalog(data) {
  /** @type {string[]} */
  const errors = [];
  if (!onlyFields(data, 'catalog', [...TOP_FIELDS], errors)) return { ok: false, errors };
  const catalog = /** @type {Record<string, any>} */ (data);
  if (catalog.schema !== 1) errors.push('catalog.schema: must be 1');
  if (typeof catalog.updated !== 'string' || !DATE.test(catalog.updated))
    errors.push('catalog.updated: must be a date');
  text(catalog.note, 'catalog.note', errors);
  if (!Array.isArray(catalog.tools) || catalog.tools.length === 0) {
    errors.push('catalog.tools: must be a non-empty list');
    return { ok: false, errors };
  }
  const ids = new Set();
  catalog.tools.forEach((/** @type {any} */ entry, /** @type {number} */ index) => {
    const where = `tools[${String(index)}]`;
    if (!onlyFields(entry, where, [...ENTRY_FIELDS], errors)) return;
    for (const field of ENTRY_FIELDS)
      if (!(field in entry)) errors.push(`${where}: missing "${field}"`);
    const label = typeof entry.id === 'string' ? entry.id : where;
    if (typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id))
      errors.push(`${where}.id: must be a lowercase slug`);
    else if (ids.has(entry.id)) errors.push(`${label}: duplicate id`);
    else ids.add(entry.id);
    for (const field of ['name', 'purpose', 'configurationChange', 'verify', 'maintenance'])
      text(entry[field], `${label}.${field}`, errors);
    if (!CATEGORIES.has(entry.category)) errors.push(`${label}.category: unknown`);
    if (!RULES.has(entry.rule)) errors.push(`${label}.rule: unknown rule`);
    for (const field of [
      'languages',
      'equivalentPlugins',
      'requirements',
      'limitations',
      'alternatives',
    ]) {
      if (!Array.isArray(entry[field])) errors.push(`${label}.${field}: must be a list`);
      else
        entry[field].forEach((/** @type {unknown} */ item, /** @type {number} */ i) =>
          text(item, `${label}.${field}[${String(i)}]`, errors),
        );
    }
    if (Array.isArray(entry.languages) && entry.languages.length === 0)
      errors.push(`${label}.languages: must not be empty`);
    if (Array.isArray(entry.equivalentPlugins) && entry.equivalentPlugins.length === 0)
      errors.push(`${label}.equivalentPlugins: must not be empty`);

    if (onlyFields(entry.appliesTo, `${label}.appliesTo`, ['testTool'], errors))
      text(entry.appliesTo.testTool, `${label}.appliesTo.testTool`, errors);

    if (onlyFields(entry.install, `${label}.install`, ['kind', 'package', 'dev'], errors)) {
      if (!INSTALL_KINDS.has(entry.install.kind)) errors.push(`${label}.install.kind: unknown`);
      const pattern = entry.install.kind === 'npm-package' ? NPM_NAME : PIP_NAME;
      if (typeof entry.install.package !== 'string' || !pattern.test(entry.install.package))
        errors.push(`${label}.install.package: not a valid package name`);
      if (typeof entry.install.dev !== 'boolean')
        errors.push(`${label}.install.dev: must be true or false`);
    }

    const licence = entry.licence;
    if (licence === null || typeof licence !== 'object') errors.push(`${label}.licence: required`);
    else if (licence.status === 'unverified') {
      onlyFields(licence, `${label}.licence`, ['status'], errors);
    } else if (licence.status === 'verified') {
      onlyFields(
        licence,
        `${label}.licence`,
        ['status', 'identifier', 'source', 'verified', 'scope'],
        errors,
      );
      text(licence.identifier, `${label}.licence.identifier`, errors, { max: 60 });
      httpsUrl(licence.source, `${label}.licence.source`, errors);
      if (typeof licence.verified !== 'string' || !DATE.test(licence.verified))
        errors.push(`${label}.licence.verified: must be a date`);
      text(licence.scope, `${label}.licence.scope`, errors);
    } else errors.push(`${label}.licence.status: must be "verified" or "unverified"`);

    if (!Array.isArray(entry.docs) || entry.docs.length === 0)
      errors.push(`${label}.docs: at least one documentation link`);
    else {
      entry.docs.forEach((/** @type {any} */ doc, /** @type {number} */ i) => {
        if (!onlyFields(doc, `${label}.docs[${String(i)}]`, ['title', 'url', 'accessed'], errors))
          return;
        text(doc.title, `${label}.docs[${String(i)}].title`, errors);
        httpsUrl(doc.url, `${label}.docs[${String(i)}].url`, errors);
        if (typeof doc.accessed !== 'string' || !DATE.test(doc.accessed))
          errors.push(`${label}.docs[${String(i)}].accessed: must be a date`);
      });
    }
  });
  return { ok: errors.length === 0, errors };
}

/**
 * Reads and validates the catalog. An invalid catalog is refused whole: a half-trusted
 * catalog is worse than none.
 *
 * @param {string} [file]
 * @returns {{ catalog: any, errors: string[] }}
 */
export function loadCatalog(file = CATALOG_PATH) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      catalog: null,
      errors: [`the catalog could not be read: ${String(/** @type {Error} */ (error).message)}`],
    };
  }
  const result = validateCatalog(data);
  return result.ok ? { catalog: data, errors: [] } : { catalog: null, errors: result.errors };
}

/** @param {any} project @param {string} subject */
const finding = (project, subject) =>
  project.findings.find((/** @type {any} */ f) => f.subject === subject);

/**
 * @param {string} projectPath
 * @param {string} reportPath
 */
const within = (projectPath, reportPath) =>
  projectPath === '.' || reportPath === projectPath || reportPath.startsWith(`${projectPath}/`);

/** @type {Record<string, (ctx: { project: any, reports: any[] }) => { missing: boolean, fact: string }>} */
const RULE_CHECKS = {
  'missing-coverage-report': ({ project, reports }) => {
    const inProject = reports.filter((r) => within(project.relativePath, r.path));
    const coverage = inProject.filter((r) => r.format === 'lcov' || r.format === 'cobertura-xml');
    return {
      missing: coverage.length === 0,
      fact: `The scan found ${String(inProject.length)} report file${
        inProject.length === 1 ? '' : 's'
      } in ${project.relativePath === '.' ? 'the repository' : project.relativePath} and ${
        coverage.length === 0
          ? 'none is a coverage report'
          : `${String(coverage.length)} coverage report${coverage.length === 1 ? '' : 's'}`
      }.`,
    };
  },
  'missing-junit-report': ({ project, reports }) => {
    const inProject = reports.filter((r) => within(project.relativePath, r.path));
    const junit = inProject.filter((r) => r.format === 'junit-xml');
    return {
      missing: junit.length === 0,
      fact: `The scan found ${String(inProject.length)} report file${
        inProject.length === 1 ? '' : 's'
      } in ${project.relativePath === '.' ? 'the repository' : project.relativePath} and ${
        junit.length === 0 ? 'none is JUnit XML' : `${String(junit.length)} JUnit XML`
      }.`,
    };
  },
};

/**
 * What the installer would change in the repository, from the package manager.
 *
 * @param {any} install
 * @param {string | null} packageManager
 */
function installDetails(install, packageManager, projectPath) {
  const prefix = projectPath === '.' ? '' : `${projectPath}/`;
  if (install.kind === 'pip-package') {
    return {
      supported: true,
      argv: ['python', '-m', 'pip', 'install', install.package],
      filesThatChange: [],
      note: 'This installs into the Python environment the python command resolves to. No file in the repository changes; add the package to your requirements file yourself.',
    };
  }
  const manager = packageManager ?? 'npm';
  if (manager === 'npm') {
    return {
      supported: true,
      argv: ['npm', 'install', '--save-dev', '--ignore-scripts', install.package],
      filesThatChange: [`${prefix}package.json`, `${prefix}package-lock.json`],
      note: 'Install scripts of the new package are not run (--ignore-scripts). A package that needs one will not be fully set up.',
    };
  }
  if (manager === 'pnpm') {
    return {
      supported: true,
      argv: ['pnpm', 'add', '--save-dev', '--ignore-scripts', install.package],
      filesThatChange: [`${prefix}package.json`, `${prefix}pnpm-lock.yaml`],
      note: 'Install scripts of the new package are not run (--ignore-scripts). A package that needs one will not be fully set up.',
    };
  }
  return {
    supported: false,
    argv: null,
    filesThatChange: [],
    note: `The package manager here (${manager}) is not one this version installs with. Add ${install.package} yourself with it.`,
  };
}

/**
 * Recommendations for a scan. Every recommendation carries the evidence that produced it; one
 * without evidence is not produced.
 *
 * @param {{ projects: any[], reports: any[], catalog: any }} input
 * @returns {{ recommendations: any[], suppressed: Array<{ toolId: string, projectPath: string, reason: string }> }}
 */
export function recommend({ projects, reports, catalog }) {
  const recommendations = [];
  /** @type {Array<{ toolId: string, projectPath: string, reason: string }>} */
  const suppressed = [];
  for (const project of projects) {
    for (const tool of catalog.tools) {
      const toolFinding = finding(project, `test-tool:${tool.appliesTo.testTool}`);
      if (toolFinding === undefined) continue;
      const present = tool.equivalentPlugins.find(
        (/** @type {string} */ plugin) => finding(project, `plugin:${plugin}`) !== undefined,
      );
      if (present !== undefined) {
        suppressed.push({
          toolId: tool.id,
          projectPath: project.relativePath,
          reason: `${present} is already a dependency here (${
            finding(project, `plugin:${present}`).evidence[0]
          }).`,
        });
        continue;
      }
      const check = RULE_CHECKS[tool.rule]?.({ project, reports });
      if (check === undefined || !check.missing) continue;
      const evidence = [...toolFinding.evidence, check.fact];
      if (toolFinding.evidence.length === 0) continue;
      const details = installDetails(tool.install, project.packageManager, project.relativePath);
      recommendations.push({
        id: `${tool.id}@${project.relativePath}`,
        toolId: tool.id,
        projectPath: project.relativePath,
        title: `Consider ${tool.name}`,
        whyRelevant: `${tool.appliesTo.testTool} is used in ${
          project.relativePath === '.' ? 'this repository' : project.relativePath
        }, and ${check.fact.charAt(0).toLowerCase()}${check.fact.slice(
          1,
        )} That can simply mean this is not set up here; it is not a sign that anything is wrong.`,
        evidence,
        expectedBenefit: tool.purpose,
        cost: tool.maintenance,
        compatibility: tool.requirements,
        limitations: tool.limitations,
        alternatives: tool.alternatives,
        configurationChange: tool.configurationChange,
        filesThatChange: details.filesThatChange,
        installNote: details.note,
        installSupported: details.supported,
        verify: tool.verify,
        rollback:
          tool.install.kind === 'pip-package'
            ? `Uninstall it with python -m pip uninstall ${tool.install.package}.`
            : `Restore package.json and the lockfile from version control, or remove the dependency with your package manager.`,
        licence: tool.licence,
        docs: tool.docs,
        confidence: Math.min(toolFinding.confidence, 0.9),
      });
    }
  }
  return { recommendations, suppressed };
}

/**
 * The runner request that would install a recommended tool. It is a REQUEST: the runner's
 * preview shows it exactly and nothing runs until the user agrees to that preview.
 *
 * @param {{ recommendation: any, repositoryId: string, catalog: any, projects: any[] }} input
 */
export function installRequest({ recommendation, repositoryId, catalog, projects }) {
  const tool = catalog.tools.find((/** @type {any} */ t) => t.id === recommendation.toolId);
  const project = projects.find((p) => p.relativePath === recommendation.projectPath);
  if (tool === undefined || project === undefined) return null;
  const details = installDetails(tool.install, project.packageManager, project.relativePath);
  if (!details.supported || details.argv === null) return null;
  return {
    repositoryId,
    argv: details.argv,
    cwd: project.relativePath,
    deadlineSeconds: 600,
    artifactPaths: [],
    passThrough: [],
    env: {},
  };
}
