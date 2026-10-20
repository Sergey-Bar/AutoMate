/**
 * A small, bounded, non-validating XML reader for the spike.
 *
 * **What it proves and what it does not.** It shows that the model can be fed from XML
 * under hostile-input rules: no DTD processing, no entity expansion, no network and no file
 * access, hard limits on size, depth and element count. It is NOT the parser the product
 * would use, and nothing here shows how `saxes` (used by `packages/reporter`) behaves on the
 * same input. That is recorded as unverified in `docs/local/feasibility.md`.
 *
 * **Policy decisions, all proposals:**
 *
 * - A `<!DOCTYPE>` is skipped without being interpreted and a warning is recorded. Refusing
 *   the document would lose a report that is otherwise readable; interpreting it is where
 *   entity expansion and external entities come from.
 * - Only the five predefined entities and numeric character references are decoded. Any
 *   other `&name;` stays as literal text, is reported, and marks the document as not
 *   well-formed, so a report that depended on a custom entity is never presented as complete.
 * - The module imports nothing from the filesystem or network, which a test asserts.
 */

import { TextDecoder } from 'node:util';

/** @typedef {{ name: string, attrs: Record<string, string>, children: XmlElement[],
 *   text: string, textTruncated: boolean, incomplete: boolean }} XmlElement */
/** @typedef {{ maxBytes: number, maxDepth: number, maxElements: number, maxTextChars: number }} XmlLimits */

/** @type {XmlLimits} */
export const DEFAULT_XML_LIMITS = {
  maxBytes: 64 * 1024 * 1024,
  maxDepth: 256,
  maxElements: 2_000_000,
  maxTextChars: 65_536,
};

const ENCODINGS = new Map([
  ['utf-8', 'utf-8'],
  ['utf8', 'utf-8'],
  ['us-ascii', 'windows-1252'],
  ['ascii', 'windows-1252'],
  ['iso-8859-1', 'windows-1252'],
  ['latin1', 'windows-1252'],
  ['windows-1252', 'windows-1252'],
]);

const PREDEFINED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * @param {number} code
 * @returns {boolean} whether the code point is allowed in XML 1.0
 */
function isXmlChar(code) {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/**
 * Decodes bytes to text, honouring a BOM or the declared encoding.
 *
 * @param {Uint8Array} bytes
 * @returns {{ text: string, warnings: string[] } | { rejection: string }}
 */
function decode(bytes) {
  /** @type {string[]} */
  const warnings = [];
  let label = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) label = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = 'utf-16be';
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) label = 'utf-8';
  else {
    const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 200));
    const declared = /^\s*<\?xml[^>]*\sencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
    if (declared !== null) {
      const mapped = ENCODINGS.get((declared[1] ?? '').toLowerCase());
      if (mapped === undefined) return { rejection: 'unsupported-encoding' };
      label = mapped;
    }
  }
  const text = new TextDecoder(label, { fatal: false }).decode(bytes);
  if (text.includes('\ufffd')) warnings.push('invalid-encoding-bytes');
  return { text, warnings };
}

/**
 * Decodes entities in a text or attribute run.
 *
 * @param {string} raw
 * @param {{ warnings: Set<string>, state: { malformed: boolean } }} context
 * @returns {string}
 */
function decodeEntities(raw, context) {
  if (!raw.includes('&')) return raw;
  // A bare ampersand that starts no reference is not well-formed. Checked on the raw text,
  // because after decoding a legitimate `&amp;` is indistinguishable from a bare one.
  if (/&(?!#x[0-9a-fA-F]+;|#[0-9]+;|[A-Za-z_][\w.-]*;)/.test(raw)) {
    context.warnings.add('xml-malformed');
    context.state.malformed = true;
  }
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_][\w.-]*);/g, (whole, body) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1));
      if (Number.isFinite(code) && isXmlChar(code)) return String.fromCodePoint(code);
      context.warnings.add('char-reference-invalid');
      context.state.malformed = true;
      return '\ufffd';
    }
    if (Object.hasOwn(PREDEFINED, body)) {
      return PREDEFINED[/** @type {keyof typeof PREDEFINED} */ (body)];
    }
    context.warnings.add('entity-undefined');
    context.state.malformed = true;
    return whole;
  });
}

/**
 * The index just past a DOCTYPE declaration starting at `start`, or -1 when it never ends.
 * The internal subset is skipped by bracket depth and quote state; nothing in it is read.
 *
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
function skipDoctype(text, start) {
  let depth = 0;
  /** @type {string | null} */
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '[') depth += 1;
    else if (char === ']') depth -= 1;
    else if (char === '>' && depth <= 0) return index + 1;
  }
  return -1;
}

/**
 * Parses the attributes of a start tag body (the text between the name and `>`).
 *
 * @param {string} body
 * @param {{ warnings: Set<string>, state: { malformed: boolean } }} context
 * @returns {Record<string, string>}
 */
function parseAttributes(body, context) {
  /** @type {Record<string, string>} */
  const attrs = Object.create(null);
  const pattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (const match of body.matchAll(pattern)) {
    const name = match[1] ?? '';
    attrs[name] = decodeEntities(match[3] ?? match[4] ?? '', context);
  }
  // Anything left once the well-formed attributes are removed is not an attribute.
  if (body.replace(pattern, '').replace(/[\s/]/g, '') !== '') {
    context.warnings.add('xml-malformed');
    context.state.malformed = true;
  }
  return attrs;
}

/**
 * The index of the `>` that ends a tag starting at `start`, ignoring `>` inside quotes, or
 * -1 when the input ends first.
 *
 * @param {string} text
 * @param {number} start
 * @returns {number}
 */
function tagEnd(text, start) {
  /** @type {string | null} */
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return index;
  }
  return -1;
}

/**
 * @param {Uint8Array} bytes
 * @param {Partial<XmlLimits>} [overrides]
 * @returns {{ rejection: string } | { rejection: null, root: XmlElement, warnings: Set<string>,
 *   malformed: boolean, truncated: boolean }}
 */
export function parseXml(bytes, overrides = {}) {
  const limits = { ...DEFAULT_XML_LIMITS, ...overrides };
  if (bytes.length === 0) return { rejection: 'empty-input' };
  if (bytes.length > limits.maxBytes) return { rejection: 'too-large' };
  const decoded = decode(bytes);
  if ('rejection' in decoded) return { rejection: decoded.rejection };
  const text = decoded.text.replace(/^\ufeff/, '');
  if (!/^\s*</.test(text)) return { rejection: 'not-xml' };

  const context = { warnings: new Set(decoded.warnings), state: { malformed: false } };
  /** @type {XmlElement[]} */
  const stack = [];
  /** @type {XmlElement | null} */
  let root = null;
  let elements = 0;
  let truncated = false;
  let index = 0;

  /** @param {string} chunk */
  const addText = (chunk) => {
    const top = stack.at(-1);
    if (top === undefined) return;
    if (top.text.length + chunk.length > limits.maxTextChars) {
      top.text += chunk.slice(0, Math.max(0, limits.maxTextChars - top.text.length));
      top.textTruncated = true;
    } else top.text += chunk;
  };

  while (index < text.length) {
    const lt = text.indexOf('<', index);
    if (lt === -1) {
      addText(decodeEntities(text.slice(index), context));
      break;
    }
    if (lt > index) addText(decodeEntities(text.slice(index, lt), context));
    index = lt;

    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      if (end === -1) {
        truncated = true;
        break;
      }
      index = end + 3;
    } else if (text.startsWith('<![CDATA[', index)) {
      const end = text.indexOf(']]>', index + 9);
      if (end === -1) {
        addText(text.slice(index + 9));
        truncated = true;
        break;
      }
      addText(text.slice(index + 9, end));
      index = end + 3;
    } else if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index + 2);
      if (end === -1) {
        truncated = true;
        break;
      }
      index = end + 2;
    } else if (text.startsWith('<!DOCTYPE', index)) {
      const end = skipDoctype(text, index);
      context.warnings.add('doctype-ignored');
      if (end === -1) {
        truncated = true;
        break;
      }
      index = end;
    } else if (text.startsWith('</', index)) {
      const end = tagEnd(text, index);
      if (end === -1) {
        truncated = true;
        break;
      }
      const name = text.slice(index + 2, end).trim();
      const position = stack.map((element) => element.name).lastIndexOf(name);
      if (position === -1) {
        context.warnings.add('xml-malformed');
        context.state.malformed = true;
      } else {
        if (position !== stack.length - 1) {
          context.warnings.add('xml-malformed');
          context.state.malformed = true;
        }
        stack.length = position;
      }
      index = end + 1;
    } else {
      const end = tagEnd(text, index);
      if (end === -1) {
        truncated = true;
        break;
      }
      const selfClosing = text[end - 1] === '/';
      const inner = text.slice(index + 1, selfClosing ? end - 1 : end);
      const nameMatch = /^[^\s/>]+/.exec(inner);
      if (nameMatch === null) {
        context.warnings.add('xml-malformed');
        context.state.malformed = true;
        index = end + 1;
        continue;
      }
      elements += 1;
      if (elements > limits.maxElements) return { rejection: 'too-large' };
      /** @type {XmlElement} */
      const element = {
        name: nameMatch[0],
        attrs: parseAttributes(inner.slice(nameMatch[0].length), context),
        children: [],
        text: '',
        textTruncated: false,
        incomplete: false,
      };
      const parent = stack.at(-1);
      if (parent !== undefined) parent.children.push(element);
      else if (root === null) root = element;
      else {
        context.warnings.add('xml-malformed');
        context.state.malformed = true;
      }
      if (!selfClosing) {
        stack.push(element);
        if (stack.length > limits.maxDepth) return { rejection: 'too-deep' };
      }
      index = end + 1;
    }
  }

  if (root === null) return { rejection: 'not-xml' };
  if (stack.length > 0) truncated = true;
  for (const open of stack) open.incomplete = true;
  if (truncated) context.warnings.add('xml-truncated');
  return {
    rejection: null,
    root,
    warnings: context.warnings,
    malformed: context.state.malformed,
    truncated,
  };
}
