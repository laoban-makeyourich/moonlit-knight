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

test('short landscape screens: compressed layout rules exist (v0.8)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // The middle band (equip row / HUD / notice) uses fixed bottom offsets
  // tuned for desktop; below 640px it must compress instead of landing
  // on top of the enemy portrait.
  assert.ok(html.includes('@media (max-height: 640px)'), 'short-screen media query exists');
  assert.ok(html.includes('.hud{bottom:99px'), 'HUD re-anchored just above the hand');
  assert.ok(html.includes('.equip-row{left:44px'), 'equipment moves to a left-edge column');
  assert.ok(html.includes('.combat-notice{bottom:141px'), 'notice tucks between enemy and HUD');
  assert.ok(html.includes('#hero{width:min(300px, 62vw, 34vh)'), 'title hero shrinks on short screens');
  assert.ok(html.includes('#title-screen .foot{display:none'), 'title footer hidden on short screens');
  assert.ok(html.includes('#card-preview{width:min(210px, 42vw, 44vh)'), 'preview fits short screens');
});

test('version label hides during gameplay (was covered by End Turn)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('#game-screen:not(.hidden) ~ #version{display:none;}'));
});
