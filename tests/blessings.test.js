// Moonlit Knight — blessings + smithy upgrades + run entry opts (Stage 3).
// Run: node --test tests/blessings.test.js
// Same conventions as tests/engine.test.js: hands/decks are set directly on
// the state, seeded RNG where a draw is involved.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, playCard } from '../src/engine.js';

const TEN_STRIKES = Array(10).fill('basic-strike');

function game(monsterId = 'thorn-wolf', deck = TEN_STRIKES, opts = {}) {
  return createGame(monsterId, deck, { seed: 42, ...opts });
}

function setHand(state, ids) {
  state.player.hand = [...ids];
}

function playFirst(state, id) {
  const i = state.player.hand.indexOf(id);
  assert.notEqual(i, -1, `${id} should be in hand`);
  return playCard(state, i);
}

// ---------------------------------------------------------------------------
// Run entry opts: mid-run fights enter with the run's HP / slots / gold
// ---------------------------------------------------------------------------

test('run entry opts: startHp, maxHp, actionCap, equipSlots, gold are honoured', () => {
  const s = game('thorn-wolf', TEN_STRIKES, {
    startHp: 12, maxHp: 40, actionCap: 3, equipSlots: 2, gold: 50,
  });
  assert.equal(s.player.hp, 12);
  assert.equal(s.player.maxHp, 40);
  assert.equal(s.player.action, 3);
  assert.equal(s.player.actionCap, 3);
  assert.equal(s.player.equipSlots, 2);
  assert.equal(s.player.gold, 50);
});

test('run entry opts: blessings and upgrades are stored on the player', () => {
  const s = game('thorn-wolf', TEN_STRIKES, {
    blessings: ['mini-rake', 'ember-artillery'],
    upgrades: { 'basic-strike': 2 },
  });
  assert.deepEqual(s.player.blessings, ['mini-rake', 'ember-artillery']);
  assert.deepEqual(s.player.upgrades, { 'basic-strike': 2 });
});

test('run entry opts: defaults are unchanged without opts', () => {
  const s = game();
  assert.equal(s.player.hp, 30);
  assert.equal(s.player.maxHp, 30);
  assert.equal(s.player.actionCap, 2);
  assert.equal(s.player.equipSlots, 1);
  assert.equal(s.player.gold, 23);
  assert.deepEqual(s.player.blessings, []);
  assert.deepEqual(s.player.upgrades, {});
});

// ---------------------------------------------------------------------------
// Blessings
// ---------------------------------------------------------------------------

test('Mini Rake: all Armor gained is doubled (Iron Thorn 3 -> 6)', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { blessings: ['mini-rake'] });
  setHand(s, ['iron-thorn']);
  assert.equal(playFirst(s, 'iron-thorn').ok, true);
  assert.equal(s.player.armor, 6);
  assert.equal(s.enemy.hp, 11); // damage is not doubled, only Armor
});

test('Mini Rake: Bulwark Stance gains 12 Armor instead of 6', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { blessings: ['mini-rake'] });
  setHand(s, ['bulwark-stance']);
  assert.equal(playFirst(s, 'bulwark-stance').ok, true);
  assert.equal(s.player.armor, 12);
});

test('Mini Rake: without the blessing, Armor is not doubled', () => {
  const s = game();
  setHand(s, ['iron-thorn']);
  assert.equal(playFirst(s, 'iron-thorn').ok, true);
  assert.equal(s.player.armor, 3);
});

test('Battle Trumpet: Basic Strike deals +2 damage (3 -> 5)', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { blessings: ['battle-trumpet'] });
  setHand(s, ['basic-strike']);
  assert.equal(playFirst(s, 'basic-strike').ok, true);
  assert.equal(s.enemy.hp, 15);
});

test('Battle Trumpet: other Attack cards are unaffected', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { blessings: ['battle-trumpet'] });
  setHand(s, ['heavy-cleave']);
  assert.equal(playFirst(s, 'heavy-cleave').ok, true);
  assert.equal(s.enemy.hp, 8); // still 12, not 14
});

test('Ember Artillery: equipping deals 6 fire damage to the enemy', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { blessings: ['ember-artillery'] });
  setHand(s, ['wardens-shield']);
  assert.equal(playFirst(s, 'wardens-shield').ok, true);
  assert.equal(s.enemy.hp, 14);
  assert.deepEqual(s.player.equipment, ['wardens-shield']);
});

test('Ember Artillery: non-Equipment cards do not trigger it', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { blessings: ['ember-artillery'] });
  setHand(s, ['basic-strike']);
  assert.equal(playFirst(s, 'basic-strike').ok, true);
  assert.equal(s.enemy.hp, 17); // plain 3, no +6
});

// ---------------------------------------------------------------------------
// Smithy upgrades
// ---------------------------------------------------------------------------

test('upgrade: Attack card deals +3 damage per upgrade', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { upgrades: { 'basic-strike': 1 } });
  setHand(s, ['basic-strike']);
  assert.equal(playFirst(s, 'basic-strike').ok, true);
  assert.equal(s.enemy.hp, 14); // 3 + 3

  const s2 = game('thorn-wolf', TEN_STRIKES, { upgrades: { 'basic-strike': 2 } });
  setHand(s2, ['basic-strike']);
  assert.equal(playFirst(s2, 'basic-strike').ok, true);
  assert.equal(s2.enemy.hp, 11); // 3 + 6
});

test('upgrade: Iron Thorn gains +3 damage AND +3 Armor', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { upgrades: { 'iron-thorn': 1 } });
  setHand(s, ['iron-thorn']);
  assert.equal(playFirst(s, 'iron-thorn').ok, true);
  assert.equal(s.enemy.hp, 8); // 9 + 3
  assert.equal(s.player.armor, 6); // 3 + 3
});

test('upgrade: Riposte gains +3 damage AND +3 Armor', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { upgrades: { riposte: 1 } });
  setHand(s, ['riposte']);
  assert.equal(playFirst(s, 'riposte').ok, true);
  assert.equal(s.enemy.hp, 13); // 4 + 3
  assert.equal(s.player.armor, 7); // 4 + 3
});

test('upgrade: draw card draws +1 per upgrade (Second Wind draws 3)', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { upgrades: { 'second-wind': 1 } });
  setHand(s, ['second-wind']);
  assert.equal(playFirst(s, 'second-wind').ok, true);
  assert.equal(s.player.hand.length, 3); // -1 played, +3 drawn
});

test('upgrade: non-Attack damage card deals +1 per upgrade (Steel Rain 8 -> 9)', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { upgrades: { 'steel-rain': 1 } });
  s.player.mana = 6;
  setHand(s, ['steel-rain']);
  assert.equal(playFirst(s, 'steel-rain').ok, true);
  assert.equal(s.enemy.hp, 11);
});

test('upgrade: other card gains +2 Armor per upgrade (Mana Crystal)', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { upgrades: { 'mana-crystal': 1 } });
  setHand(s, ['mana-crystal']);
  assert.equal(playFirst(s, 'mana-crystal').ok, true);
  assert.equal(s.player.mana, 6);
  assert.equal(s.player.armor, 2);
});

test('upgrade: Bulwark Stance gains +3 Armor AND draws +1', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { upgrades: { 'bulwark-stance': 1 } });
  setHand(s, ['bulwark-stance']);
  assert.equal(playFirst(s, 'bulwark-stance').ok, true);
  assert.equal(s.player.armor, 9); // 6 + 3
  assert.equal(s.player.hand.length, 2); // -1 played, +2 drawn
});

test('upgrade: unupgraded cards are unaffected', () => {
  const s = game('thorn-wolf', TEN_STRIKES, { upgrades: { 'basic-strike': 1 } });
  setHand(s, ['heavy-cleave']);
  assert.equal(playFirst(s, 'heavy-cleave').ok, true);
  assert.equal(s.enemy.hp, 8); // plain 12
});
