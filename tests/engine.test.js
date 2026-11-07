// Moonlit Knight — engine unit tests (Stage 1).
// Run: node --test tests/engine.test.js
// Tests never depend on shuffle order: hands/decks are set directly on the
// state, and seeded RNG is used where a draw is involved.

import test from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, STARTER_DECK, getCard } from '../src/cards.js';
import { MONSTERS } from '../src/monsters.js';
import {
  CONFIG, createGame, playCard, endTurn, isGameOver,
  dealDamageToPlayer, dealDamageToEnemy,
} from '../src/engine.js';

const TEN_STRIKES = Array(10).fill('basic-strike');

function game(monsterId = 'thorn-wolf', deck = TEN_STRIKES) {
  return createGame(monsterId, deck, { seed: 42 });
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
// Data sanity
// ---------------------------------------------------------------------------

test('card data: 36 cards, all types present, ids unique', () => {
  assert.equal(CARDS.length, 36);
  const ids = new Set(CARDS.map((c) => c.id));
  assert.equal(ids.size, 36);
  for (const type of ['Attack', 'Action', 'Spell', 'Mana', 'Equipment', 'Counter']) {
    assert.ok(CARDS.some((c) => c.type === type), `missing type ${type}`);
  }
  assert.equal(getCard('heavy-cleave').name, 'Heavy Cleave');
  assert.equal(getCard('nope'), null);
});

test('starter deck: 8 cards with the specified composition', () => {
  assert.equal(STARTER_DECK.length, 8);
  const count = (id) => STARTER_DECK.filter((x) => x === id).length;
  assert.equal(count('basic-strike'), 4);
  assert.equal(count('iron-thorn'), 1);
  assert.equal(count('wardens-shield'), 1);
  assert.equal(count('piercing-thrust'), 1);
  assert.equal(count('second-wind'), 1);
});

test('monster data: 6 monsters with the specified HP', () => {
  assert.equal(MONSTERS.length, 6);
  const hp = Object.fromEntries(MONSTERS.map((m) => [m.id, m.hp]));
  assert.deepEqual(hp, {
    'thorn-wolf': 20, 'rat-king': 33, 'hollow-stag': 28,
    'mire-wisp': 25, 'mire-crocodile': 60, 'grave-witch': 100,
  });
  for (const m of MONSTERS) assert.ok(m.attacks.length >= 2, `${m.id} needs attacks`);
});

test('config values match the brief', () => {
  assert.deepEqual(CONFIG, {
    playerStartHp: 30, playerStartMana: 2, actionCap: 2,
    drawPerTurn: 5, startGold: 23, equipSlotsStart: 1,
  });
});

// ---------------------------------------------------------------------------
// Costs and resources
// ---------------------------------------------------------------------------

test('Action cost enforced: 2 Action per turn, third Action card rejected', () => {
  const s = game();
  s.player.deck = [];
  s.player.discard = [];
  setHand(s, ['second-wind', 'second-wind', 'second-wind']);
  assert.equal(playCard(s, 0).ok, true);
  assert.equal(s.player.action, 1);
  assert.equal(playCard(s, 0).ok, true);
  assert.equal(s.player.action, 0);
  const r = playCard(s, 0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-action');
  assert.equal(s.player.action, 0);
  // The two played Second Winds are accounted for: one sits in the
  // discard pile, the other was reshuffled back and drawn by the 2nd play.
  assert.equal(s.player.hand.length + s.player.discard.length + s.player.deck.length, 3);
});

test('Mana cost enforced: Steel Rain (6 Mana) rejected at 2 Mana', () => {
  const s = game();
  setHand(s, ['steel-rain']);
  const r = playCard(s, 0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-mana');
  assert.equal(s.player.hand.length, 1);
  assert.equal(s.player.mana, 2);
});

test('Mana does not regenerate at turn start; Mana cards are the only source', () => {
  const s = game();
  setHand(s, ['mana-crystal']);
  assert.equal(playFirst(s, 'mana-crystal').ok, true);
  assert.equal(s.player.mana, 6);
  endTurn(s);
  assert.equal(s.player.mana, 6); // still 6 after a full round
  assert.equal(s.phase, 'player');
});

test('Rally Cry refunds its own Action (net 0) and draws a card', () => {
  const s = game();
  setHand(s, ['rally-cry']);
  assert.equal(playFirst(s, 'rally-cry').ok, true);
  assert.equal(s.player.action, 2);
});

test('Second Wind draws 2 cards', () => {
  const s = game();
  setHand(s, ['second-wind']);
  assert.equal(playFirst(s, 'second-wind').ok, true);
  assert.equal(s.player.hand.length, 2); // -1 played, +2 drawn
});

// ---------------------------------------------------------------------------
// Damage and Armor
// ---------------------------------------------------------------------------

test('Armor absorption: 5 Armor soaks 5 of a 7-damage Bite', () => {
  const s = game();
  s.player.armor = 5;
  endTurn(s); // Thorn Wolf Bite 4 + 3 (first-attack bonus) = 7
  assert.equal(s.player.hp, 28);
  assert.equal(s.player.armor, 0);
});

test('Piercing bypass: Mire Wisp Drain (5 piercing) ignores Armor', () => {
  const s = game('mire-wisp');
  s.player.armor = 10;
  s.enemy.attackIndex = 1; // force Drain (piercing) instead of Wail
  endTurn(s);
  assert.equal(s.player.hp, 25);
  assert.equal(s.player.armor, 10);
});

test('Piercing Thrust deals damage equal to your Armor', () => {
  const s = game();
  s.player.armor = 6;
  setHand(s, ['piercing-thrust']);
  assert.equal(playFirst(s, 'piercing-thrust').ok, true);
  assert.equal(s.enemy.hp, 14);
});

test('Shield Bash deals half your Armor (rounded down)', () => {
  const s = game();
  s.player.armor = 7;
  setHand(s, ['shield-bash']);
  assert.equal(playFirst(s, 'shield-bash').ok, true);
  assert.equal(s.enemy.hp, 17); // floor(7/2) = 3
});

test('Final Verdict executes: 20 damage when the enemy is below half HP', () => {
  const s = game();
  s.enemy.hp = 9; // below half of 20
  setHand(s, ['final-verdict']);
  assert.equal(playFirst(s, 'final-verdict').ok, true);
  assert.equal(isGameOver(s), 'won');
});

test('Vengeful Strike deals 10 only after losing HP this turn', () => {
  const s = game();
  setHand(s, ['vengeful-strike']);
  assert.equal(playFirst(s, 'vengeful-strike').ok, true);
  assert.equal(s.enemy.hp, 15); // 5 damage, no HP lost yet
  // Now lose HP on our own turn, then strike again.
  dealDamageToPlayer(s, 3, {});
  setHand(s, ['vengeful-strike']);
  assert.equal(playFirst(s, 'vengeful-strike').ok, true);
  assert.equal(s.enemy.hp, 5); // 10 damage
});

// ---------------------------------------------------------------------------
// Turn structure
// ---------------------------------------------------------------------------

test('draw-5 rule: opening hand is exactly 5 cards', () => {
  const s = game();
  assert.equal(s.player.hand.length, 5);
  assert.equal(s.player.deck.length, 5);
  assert.equal(s.turn, 1);
  assert.equal(s.phase, 'player');
});

test('end-of-turn discard reshuffle: discard returns to deck, discard empties', () => {
  const s = game('thorn-wolf', [...STARTER_DECK]);
  // Opening hand is 5 of the 8 starter cards; play one, leaving 4 in hand.
  assert.equal(playCard(s, 0).ok, true);
  assert.equal(s.player.discard.length, 1);
  endTurn(s);
  assert.equal(s.player.discard.length, 0);
  assert.equal(s.player.hand.length, 5);
  // All 8 cards are conserved: 5 in hand, 3 left in the deck.
  assert.equal(s.player.hand.length + s.player.deck.length, 8);
  assert.equal(s.player.deck.length, 3);
});

test('hand returns to deck at turn start (no cards lost across turns)', () => {
  const s = game('thorn-wolf', Array(8).fill('basic-strike'));
  setHand(s, ['iron-thorn', 'iron-thorn', 'iron-thorn', 'iron-thorn', 'iron-thorn']);
  endTurn(s);
  // 3 strikes were left in the deck + 5 thorns from the hand = 8 cards;
  // 5 drawn for the new hand, 3 left in the deck, none discarded.
  assert.equal(s.player.hand.length, 5);
  assert.equal(s.player.deck.length, 3);
  assert.equal(s.player.discard.length, 0);
  const thorns = [...s.player.hand, ...s.player.deck].filter((c) => c === 'iron-thorn').length;
  assert.equal(thorns, 5);
});

// ---------------------------------------------------------------------------
// Equipment and Counters
// ---------------------------------------------------------------------------

test('equipment slot limit: second Equipment rejected with no-slot', () => {
  const s = game();
  assert.equal(s.player.equipSlots, 1);
  setHand(s, ['wardens-shield', 'bulwark-shield']);
  assert.equal(playFirst(s, 'wardens-shield').ok, true);
  assert.deepEqual(s.player.equipment, ['wardens-shield']);
  const r = playFirst(s, 'bulwark-shield');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-slot');
  assert.equal(s.player.hand.length, 1);
});

test('Equipment stays in play across turns (never returns to deck)', () => {
  const s = game();
  setHand(s, ['wardens-shield']);
  assert.equal(playFirst(s, 'wardens-shield').ok, true);
  endTurn(s);
  assert.deepEqual(s.player.equipment, ['wardens-shield']);
  assert.ok(!s.player.hand.includes('wardens-shield'));
  assert.ok(!s.player.deck.includes('wardens-shield'));
  assert.ok(!s.player.discard.includes('wardens-shield'));
});

test('War Banner: Attack cards deal +1 damage', () => {
  const s = game();
  setHand(s, ['war-banner', 'basic-strike']);
  assert.equal(playFirst(s, 'war-banner').ok, true);
  assert.equal(s.player.attackBonus, 1);
  assert.equal(playFirst(s, 'basic-strike').ok, true);
  assert.equal(s.enemy.hp, 16); // 3 + 1
});

test('Sharpen Blade: next Attack +6, then the bonus is spent', () => {
  const s = game();
  setHand(s, ['sharpen-blade', 'basic-strike', 'basic-strike']);
  assert.equal(playFirst(s, 'sharpen-blade').ok, true);
  assert.equal(playFirst(s, 'basic-strike').ok, true);
  assert.equal(s.enemy.hp, 11); // 3 + 6
  assert.equal(playFirst(s, 'basic-strike').ok, true);
  assert.equal(s.enemy.hp, 8); // plain 3
});

test("Warden's Shield: each Attack played gains 2 Armor", () => {
  const s = game();
  setHand(s, ['wardens-shield', 'basic-strike']);
  assert.equal(playFirst(s, 'wardens-shield').ok, true);
  assert.equal(playFirst(s, 'basic-strike').ok, true);
  assert.equal(s.player.armor, 2);
});

test('Spike Barrier: each Armor gain deals 2 damage to the enemy', () => {
  const s = game();
  s.player.equipment = ['spike-barrier'];
  setHand(s, ['iron-thorn']); // 9 damage + gain 3 Armor
  assert.equal(playFirst(s, 'iron-thorn').ok, true);
  assert.equal(s.enemy.hp, 9); // 20 - 9 - 2
});

test('Duel Dagger: every 2nd Attack this turn deals 1 extra damage', () => {
  const s = game();
  s.player.equipment = ['duel-dagger'];
  setHand(s, ['basic-strike', 'basic-strike', 'basic-strike']);
  playFirst(s, 'basic-strike');
  assert.equal(s.enemy.hp, 17); // 3
  playFirst(s, 'basic-strike');
  assert.equal(s.enemy.hp, 13); // 3 + 1
  playFirst(s, 'basic-strike');
  assert.equal(s.enemy.hp, 10); // 3
});

test('Chainmail Vest: gain 2 Armor after taking damage', () => {
  const s = game();
  s.player.equipment = ['chainmail-vest'];
  endTurn(s); // Bite 7
  assert.equal(s.player.hp, 23);
  assert.equal(s.player.armor, 2);
});

test('Blood Oath Blade: damage on your own turn doubles the next damage', () => {
  const s = game();
  s.player.equipment = ['blood-oath-blade'];
  dealDamageToPlayer(s, 3, {}); // phase is 'player'
  assert.equal(s.player.doubleNextDamage, true);
  setHand(s, ['basic-strike']);
  assert.equal(playFirst(s, 'basic-strike').ok, true);
  assert.equal(s.enemy.hp, 14); // 3 x 2
  assert.equal(s.player.doubleNextDamage, false);
});

test('Parry: negates the enemy attack and deals 3 damage back', () => {
  const s = game();
  s.player.counters = ['parry'];
  endTurn(s);
  assert.equal(s.player.hp, 30); // no damage taken
  assert.equal(s.enemy.hp, 17); // 3 reflected
  assert.ok(s.log.some((l) => l.includes('Parry')));
});

test('Thorn Guard: enemy damage is reflected for 2', () => {
  const s = game();
  s.player.counters = ['thorn-guard'];
  endTurn(s); // Bite 7
  assert.equal(s.player.hp, 23);
  assert.equal(s.enemy.hp, 18); // 20 - 2
});

test("Guardian's Oath: gains Armor and heals, capped at max HP", () => {
  const s = game();
  s.player.hp = 20;
  s.player.mana = 5;
  setHand(s, ['guardians-oath']);
  assert.equal(playFirst(s, 'guardians-oath').ok, true);
  assert.equal(s.player.hp, 26);
  assert.equal(s.player.armor, 6);
  assert.equal(s.player.mana, 0);
});

// ---------------------------------------------------------------------------
// Monster specials (all 6)
// ---------------------------------------------------------------------------

test('Thorn Wolf: first attack each turn deals +3 (Bite 4 -> 7)', () => {
  const s = game('thorn-wolf');
  endTurn(s);
  assert.equal(s.player.hp, 23);
});

test("Rat King: player loses 1 Action at the start of the turn", () => {
  const s = game('rat-king');
  assert.equal(s.player.action, 1); // refilled to 2, then -1
  endTurn(s);
  assert.equal(s.player.action, 1);
});

test('Hollow Stag: taking damage makes its next attack +1 (Gore 5 -> 6)', () => {
  const s = game('hollow-stag');
  setHand(s, ['basic-strike']);
  assert.equal(playFirst(s, 'basic-strike').ok, true);
  assert.equal(s.enemy.nextAttackBonus, 1);
  endTurn(s);
  assert.equal(s.player.hp, 24); // 30 - 6
  assert.equal(s.enemy.nextAttackBonus, 0);
});

test('Mire Wisp: the first card played is exiled, not discarded', () => {
  const s = game('mire-wisp');
  setHand(s, ['basic-strike', 'basic-strike']);
  assert.equal(playFirst(s, 'basic-strike').ok, true);
  assert.deepEqual(s.player.exiled, ['basic-strike']);
  assert.equal(s.player.discard.length, 0);
  assert.equal(playFirst(s, 'basic-strike').ok, true);
  assert.equal(s.player.discard.length, 1); // second card discards normally
});

test("Mire Crocodile: every OTHER enemy turn discards the player's hand", () => {
  const s = game('mire-crocodile');
  endTurn(s); // enemy turn 1: no discard
  assert.ok(!s.log.some((l) => l.includes('Crocodile snaps')));
  endTurn(s); // enemy turn 2: discard
  assert.ok(s.log.some((l) => l.includes('Crocodile snaps')));
  assert.equal(s.phase, 'player');
});

test('Grave Witch: heals 2 HP at the start of its turn', () => {
  const s = game('grave-witch');
  dealDamageToEnemy(s, 12, {});
  assert.equal(s.enemy.hp, 88);
  endTurn(s);
  assert.equal(s.enemy.hp, 90);
});

// ---------------------------------------------------------------------------
// Phoenix Crest, win, lose
// ---------------------------------------------------------------------------

test('Phoenix Crest: first lethal damage revives you at 10 HP and consumes the crest', () => {
  const s = game('thorn-wolf');
  s.player.hp = 5;
  s.player.equipment = ['phoenix-crest'];
  endTurn(s); // Bite 7 is lethal
  assert.equal(s.player.hp, 10);
  assert.equal(s.player.phoenixUsed, true);
  assert.deepEqual(s.player.equipment, []);
  assert.equal(s.phase, 'player');
  assert.ok(s.log.some((l) => l.includes('Phoenix Crest')));
});

test('Phoenix Crest only works once: a second lethal hit ends the game', () => {
  const s = game('thorn-wolf');
  s.player.hp = 5;
  s.player.equipment = ['phoenix-crest'];
  endTurn(s); // revived at 10
  assert.equal(s.player.hp, 10);
  endTurn(s); // Claw 6 + 3 = 9... not lethal; force a lethal hit instead
  // After two turns the wolf cycles Bite(7)/Claw(9); hp 10 - 9 = 1, still alive.
  // Deal the lethal blow directly to prove the crest is spent.
  dealDamageToPlayer(s, 50, {});
  assert.equal(isGameOver(s), 'lost');
  assert.equal(s.phase, 'lost');
});

test('win condition: reducing the enemy to 0 HP wins the fight', () => {
  const s = game();
  setHand(s, ['heavy-cleave', 'heavy-cleave']);
  assert.equal(playFirst(s, 'heavy-cleave').ok, true);
  assert.equal(s.phase, 'player');
  assert.equal(playFirst(s, 'heavy-cleave').ok, true);
  assert.equal(isGameOver(s), 'won');
  assert.equal(s.phase, 'won');
  assert.equal(playCard(s, 0).ok, false); // no more plays after winning
});

test('lose condition: dropping to 0 HP loses the fight', () => {
  const s = game();
  s.player.hp = 1;
  endTurn(s); // Bite 7
  assert.equal(isGameOver(s), 'lost');
  assert.equal(s.phase, 'lost');
});

test('unknown monster id throws', () => {
  assert.throws(() => createGame('no-such-monster'), /Unknown monster/);
});
