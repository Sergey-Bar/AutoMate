import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { URL, fileURLToPath } from 'node:url';

const theme = fileURLToPath(new URL('../.vitepress/theme/', import.meta.url));

/**
 * A live region that is itself keyed is re-created on every change, and screen readers
 * announce changes inside an existing region, not a newly inserted one. So the region
 * stays and a child carries the key, as PageJourney.vue and GuideStoryboard.vue do.
 */
test('no aria-live region in the site theme is re-created by a :key', () => {
  const offenders = [];
  for (const name of readdirSync(theme).filter((file) => file.endsWith('.vue'))) {
    const source = readFileSync(`${theme}${name}`, 'utf8');
    for (const [tag] of source.matchAll(/<[a-z][^>]*>/gs)) {
      if (/\saria-live=/.test(tag) && /\s(?::key|v-bind:key|key)=/.test(tag)) {
        offenders.push(`${name}: ${tag.replace(/\s+/g, ' ')}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
