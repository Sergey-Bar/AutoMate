import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import test from 'node:test';
import { bespokeJourneyPages, pageJourneys } from '../../site/.vitepress/theme/page-journeys.ts';

const site = fileURLToPath(new URL('../../site/', import.meta.url));

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || ['node_modules', 'dist'].includes(entry.name)) return [];
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(filename);
    return entry.name.endsWith('.md') ? [path.relative(site, filename).replaceAll('\\', '/')] : [];
  });
}

test('every documentation page has a visual introduction or a bespoke guided experience', () => {
  assert.deepEqual(
    new Set([...Object.keys(pageJourneys), ...bespokeJourneyPages]),
    new Set(markdownFiles(site)),
  );
});

test('each page introduction names an audience, a goal, three explained steps and a takeaway', () => {
  for (const [filename, journey] of Object.entries(pageJourneys)) {
    assert.ok(journey.audience && journey.goal && journey.takeaway, filename);
    assert.equal(journey.stages.length, 3, filename);
    assert.equal(new Set(journey.stages.map(([title]) => title)).size, 3, filename);
    for (const [title, explanation] of journey.stages) assert.ok(title && explanation, filename);
  }
});
