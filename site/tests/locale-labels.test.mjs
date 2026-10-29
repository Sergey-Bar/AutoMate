import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (name) =>
  readFileSync(new URL(`../.vitepress/theme/${name}`, import.meta.url), 'utf8');

/**
 * The theme and language controls are translated into English and Hebrew only. On the
 * other 21 locales, an English label under `lang="ar"` or `lang="ja"` is read with the
 * wrong voice, so the English text is marked `lang="en"` where it is not translated.
 */
test('untranslated control labels are marked English', () => {
  assert.match(read('ThemePicker.vue'), /:lang="lang === 'he' \? undefined : 'en'"/);
  const picker = read('LanguagePicker.vue');
  for (const element of ['language-trigger', 'language-close', 'language-grid']) {
    assert.match(
      picker,
      new RegExp(
        `class="${element}"[^>]*:lang="labelLang"|:lang="labelLang"[^>]*class="${element}"`,
        's',
      ),
      element,
    );
  }
  assert.match(picker, /<h2 id="language-title" :lang="labelLang">/);
  assert.match(read('LocalizedHome.vue'), /<figure lang="en" dir="ltr">/);
});

test('the language list marks the current language, not the current page', () => {
  // `aria-current="page"` on English would announce the English home as the page being
  // read on every English guide page.
  const picker = read('LanguagePicker.vue');
  assert.doesNotMatch(picker, /'page'/);
  assert.match(picker, /:aria-current="item\.lang === lang \? 'true' : undefined"/);
});
