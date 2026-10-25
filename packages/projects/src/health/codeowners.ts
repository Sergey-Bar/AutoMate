/**
 * GitHub's CODEOWNERS format, read to say who owns a finding's file.
 *
 * The rules GitHub documents and nothing more: one pattern and its owners per line, `#`
 * comments, the **last** matching line wins, and the patterns are gitignore-style — `*` stays
 * inside a segment, `**` crosses segments, a leading `/` anchors to the root, a trailing `/`
 * means everything beneath a directory, and a pattern with no slash matches at any depth.
 * A line with a pattern and no owners un-owns what it matches, which GitHub also documents.
 */
export interface OwnerRule {
  pattern: string;
  owners: readonly string[];
  matcher: RegExp;
}

/** Where GitHub looks, in the order it looks. */
export const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;

const MAX_RULES = 2000;

/** The regex for the glob token at `index`, and how many characters it consumed. */
function token(body: string, index: number): { source: string; length: number } {
  const character = body[index] as string;
  if (character === '*' && body[index + 1] === '*') {
    // `**/` is "any number of directories, including none"; a bare `**` is anything.
    return body[index + 2] === '/'
      ? { source: '(?:.*/)?', length: 3 }
      : { source: '.*', length: 2 };
  }
  if (character === '*') return { source: '[^/]*', length: 1 };
  if (character === '?') return { source: '[^/]', length: 1 };
  return { source: character.replace(/[.+^${}()|[\]\\]/gu, '\\$&'), length: 1 };
}

function globToRegExp(pattern: string): RegExp {
  const anchored = pattern.startsWith('/');
  const directory = pattern.endsWith('/');
  const body = pattern.slice(anchored ? 1 : 0, directory ? -1 : undefined);
  // No slash left in the middle: the pattern matches a name at any depth.
  const anyDepth = !anchored && !body.includes('/');
  let source = '';
  for (let index = 0; index < body.length;) {
    const next = token(body, index);
    source += next.source;
    index += next.length;
  }
  const prefix = anyDepth ? '(?:^|.*/)' : '^';
  // A file pattern also owns everything under a directory of that name, as in gitignore.
  return new RegExp(`${prefix}${source}${directory ? '/.*' : '(?:/.*)?'}$`, 'u');
}

export function parseCodeowners(text: string): OwnerRule[] {
  const rules: OwnerRule[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/\s+#.*$/u, '').trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    // A non-empty line always has a first field.
    const [pattern = '', ...owners] = line.split(/\s+/u);
    rules.push({ pattern, owners, matcher: globToRegExp(pattern) });
    if (rules.length >= MAX_RULES) break;
  }
  return rules;
}

/** The owners of a repository-relative path, joined, or `null` when nobody owns it. */
export function ownerOf(rules: readonly OwnerRule[], path: string | null): string | null {
  if (path === null) return null;
  const normalised = path.replace(/^\.?\//u, '');
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index] as OwnerRule;
    if (rule.matcher.test(normalised))
      return rule.owners.length === 0 ? null : rule.owners.join(' ');
  }
  return null;
}
