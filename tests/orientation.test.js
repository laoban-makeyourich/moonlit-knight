// Moonlit Knight — landscape lock helper test (v0.7).
// Run: node --test tests/orientation.test.js
// No DOM needed: tryLockLandscape takes its dependencies as arguments.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tryLockLandscape } from '../src/orientation.js';

const portraitCoarse = (q) => ({ matches: q.includes('portrait') || q.includes('coarse') });
const landscapeCoarse = (q) => ({ matches: q.includes('coarse') });
const portraitFine = (q) => ({ matches: q.includes('portrait') });

test('no orientation API: returns false, never throws', () => {
  assert.equal(tryLockLandscape({ screen: {}, matchMedia: portraitCoarse }), false);
  assert.equal(tryLockLandscape({}), false);
  assert.equal(tryLockLandscape(), false);
});

test('portrait + coarse pointer: locks to landscape', () => {
  let locked = null;
  const screen = { orientation: { lock: (o) => { locked = o; } } };
  assert.equal(tryLockLandscape({ screen, matchMedia: portraitCoarse, document: {} }), true);
  assert.equal(locked, 'landscape');
});

test('already landscape: does not lock', () => {
  let locked = null;
  const screen = { orientation: { lock: (o) => { locked = o; } } };
  assert.equal(tryLockLandscape({ screen, matchMedia: landscapeCoarse, document: {} }), false);
  assert.equal(locked, null);
});

test('desktop (fine pointer): does not lock', () => {
  let locked = null;
  const screen = { orientation: { lock: (o) => { locked = o; } } };
  assert.equal(tryLockLandscape({ screen, matchMedia: portraitFine, document: {} }), false);
  assert.equal(locked, null);
});

test('lock rejection is swallowed, still returns true (attempted)', () => {
  const screen = { orientation: { lock: () => { throw new Error('nope'); } } };
  assert.equal(tryLockLandscape({ screen, matchMedia: portraitCoarse, document: {} }), true);
});

test('rotate overlay: index.html has the portrait prompt and media query', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="rotate-overlay"'), 'rotate overlay element exists');
  assert.ok(html.includes('Xoay ngang'), 'overlay tells the player to rotate');
  assert.match(html, /@media\s*\(orientation:\s*portrait\)\s*\{[^}]*#rotate-overlay\s*\{\s*display:\s*flex/);
});
