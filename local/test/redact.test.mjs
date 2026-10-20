import assert from 'node:assert/strict';
import os from 'node:os';
import test from 'node:test';
import { PLACEHOLDER, redactPersonal, redactSecrets } from '../src/redact.mjs';

// Credentials are assembled at runtime, never written as literals, so the repository's
// secret scan has nothing to find in this file.
const awsKey = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join('');
const bearer = `Bearer ${['abcd', 'efgh', 'ijkl', 'mnop', 'qrst'].join('')}`;
const jwt = [
  ['ey', 'JhbGciOiJIUzI1NiJ9'].join(''),
  'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  'c2lnbmF0dXJlLXZhbHVl',
].join('.');
const ghToken = ['gh', 'p_', 'a'.repeat(36)].join('');
const keyBlock = [
  '-----BEGIN ',
  'PRIVATE KEY-----',
  '\nMIIB\n',
  '-----END ',
  'PRIVATE KEY-----',
].join('');

test('registered values and recognisable credential shapes are removed', () => {
  const registered = ['hunter', '2-synthetic'].join('');
  const text = `login ${registered} then ${awsKey} and ${bearer} ${jwt} ${ghToken}\n${keyBlock}\npassword=${'x'.repeat(
    10,
  )}`;
  const out = redactSecrets(text, [registered]);
  for (const leaked of [
    registered,
    awsKey,
    bearer.slice(7),
    jwt,
    ghToken,
    'MIIB',
    'x'.repeat(10),
  ]) {
    assert.ok(!out.includes(leaked), `leaked ${leaked.slice(0, 8)}`);
  }
  assert.ok(out.includes(PLACEHOLDER));
});

test('ordinary text is left alone', () => {
  const text = 'expected 2 to equal 3 at line 42 in src/cart.test.js';
  assert.equal(redactSecrets(text), text);
});

test('a value too short to be a secret is not registered as one', () => {
  assert.equal(redactSecrets('ab abc', ['ab']), 'ab abc');
});

test('absolute paths, the home folder, the user and the host never survive', () => {
  const host = os.hostname();
  const home = os.homedir();
  const text = [
    `at C:\\repo\\src\\cart.js:10 (host ${host})`,
    `file:///C:/Users/someone/proj/x.test.js`,
    `${home}\\work\\a.js`,
    '/home/someone/project/y.py',
    '\\\\server\\share\\a.js',
  ].join('\n');
  const out = redactPersonal(text, { roots: ['C:\\repo'] });
  assert.ok(!out.includes('C:\\repo'));
  assert.ok(!out.includes('someone'));
  assert.ok(!/[A-Za-z]:[\\/]/.test(out), out);
  if (host.length > 2) assert.ok(!out.toLowerCase().includes(host.toLowerCase()));
  assert.ok(out.includes('<repo>'));
});

test('repository-relative text is untouched', () => {
  assert.equal(redactPersonal('src/cart.test.js:12 failed'), 'src/cart.test.js:12 failed');
});
