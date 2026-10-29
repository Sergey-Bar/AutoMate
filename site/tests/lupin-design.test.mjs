import { URL } from 'node:url';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^\uFEFF/, '');
const css = read('../.vitepress/theme/lupin.css');
function luminance(hex) {
  const rgb = hex
    .match(/[a-f\d]{2}/gi)
    .map((x) => parseInt(x, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
test('Lupin text, links, and action labels meet AA in both themes', () => {
  const blocks = [
    ...css.matchAll(/--lupin-canvas:\s*(#[a-f\d]+);([\s\S]*?)--lupin-on-accent:\s*(#[a-f\d]+);/gi),
  ];
  assert.equal(blocks.length, 2);
  for (const block of blocks) {
    const tokens = Object.fromEntries(
      [...block[0].matchAll(/--lupin-([\w-]+):\s*(#[a-f\d]+);/gi)].map((m) => [m[1], m[2]]),
    );
    for (const surface of ['canvas', 'surface'])
      for (const text of ['text', 'muted', 'accent'])
        assert.ok(contrast(tokens[surface], tokens[text]) >= 4.5, `${text} on ${surface}`);
    assert.ok(contrast(tokens.accent, tokens['on-accent']) >= 4.5);
  }
});
test('self-hosted font files match their recorded provenance', () => {
  const manifest = JSON.parse(read('../public/fonts/manifest.json'));
  assert.match(manifest.revision, /^[a-f0-9]{40}$/);
  assert.equal(manifest.fonts.length, 2);
  assert.match(read('../public/fonts/OFL.txt'), /SIL OPEN FONT LICENSE/i);
  for (const font of manifest.fonts) {
    const bytes = readFileSync(new URL(`../public/fonts/${font.file}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), font.sha256);
  }
});
