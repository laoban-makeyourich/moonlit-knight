// Moonlit Knight — pure combat engine (Stage 1).
// NO DOM here: this module only manipulates plain state objects, so the
// Stage 2/3 UI can drive it and the node tests can run it headlessly.
//
// ENEMY AI (design choice, documented): the enemy plays exactly ONE attack
// per enemy turn, cycling through its attack deck in order. This keeps
// fights readable (one telegraphed hit per turn) and matches the "one
// attack per turn is fine" allowance in the Stage 1 brief.
//
// Turn order (endTurn): the enemy acts FIRST while the player still holds
// their hand (so Mire Crocodile's "discard the player's hand" is a real
// effect), then the leftover hand + discard pile shuffle back into the
// deck, then the new player turn starts (hand returns to deck — normally
// empty by then — shuffle, draw 5, refill Action).
//
// Armor: persists across turns within a fight (no reset at turn start).
// Mana: NEVER regenerates at turn start; only Mana cards add it.
// Damage bonuses (War Banner +1, Sharpen Blade / Battle Focus next-attack
// bonus, Blood Oath Blade double) apply to Attack cards; Blood Oath's
// double also applies to the next damage-dealing Spell (Steel Rain).
// "Takes damage" triggers (Chainmail Vest, Thorn Guard, Blood Oath Blade)
// fire whenever raw damage > 0, even if Armor absorbed all of it.

import { getCard, STARTER_DECK } from './cards.js?v=0.5';
import { getMonster } from './monsters.js?v=0.5';
import { mulberry32, shuffle } from './rng.js?v=0.5';

export const CONFIG = {
  playerStartHp: 30,
  playerStartMana: 2,
  actionCap: 2,
  drawPerTurn: 5,
  startGold: 23,
  equipSlotsStart: 1,
};

function log(state, msg) {
  state.log.push(msg);
}

// ---------------------------------------------------------------------------
// Run-scoped modifiers (Stage 3): blessings and smithy upgrades.
// Blessings persist for the whole run; upgrades are per-card (id -> count).
// ---------------------------------------------------------------------------

// Cards whose Armor gain is +3 per smithy upgrade.
const ARMOR_UPGRADE_CARDS = new Set([
  'iron-thorn', 'bulwark-stance', 'war-cry', 'iron-resolve', 'aegis-light',
  'moonlit-guard', 'iron-will', 'guardians-oath', 'riposte',
]);

// Cards that draw: +1 card drawn per smithy upgrade.
const DRAW_UPGRADE_CARDS = new Set([
  'second-wind', 'sharpen-blade', 'rally-cry', 'battle-focus', 'deep-breath',
  'bulwark-stance', 'war-cry', 'iron-resolve', 'aegis-light',
]);

function upgradeCount(state, cardId) {
  return (state.player.upgrades && state.player.upgrades[cardId]) || 0;
}

// ---------------------------------------------------------------------------
// Game setup
// ---------------------------------------------------------------------------

export function createGame(monsterId, deckIds = STARTER_DECK, opts = {}) {
  const monster = getMonster(monsterId);
  if (!monster) throw new Error(`Unknown monster: ${monsterId}`);
  const rng = opts.rng || (opts.seed !== undefined ? mulberry32(opts.seed) : Math.random);

  const state = {
    turn: 0,
    phase: 'player', // 'player' | 'enemy' | 'won' | 'lost'
    player: {
      // Run-scoped entry values (Stage 3): mid-run fights enter with the
      // run's current HP / Max HP / gold / slots; a fresh fight uses CONFIG.
      hp: opts.startHp !== undefined ? opts.startHp : CONFIG.playerStartHp,
      maxHp: opts.maxHp !== undefined ? opts.maxHp : CONFIG.playerStartHp,
      armor: 0,
      mana: CONFIG.playerStartMana,
      action: opts.actionCap !== undefined ? opts.actionCap : CONFIG.actionCap,
      actionCap: opts.actionCap !== undefined ? opts.actionCap : CONFIG.actionCap,
      gold: opts.gold !== undefined ? opts.gold : CONFIG.startGold,
      hand: [],
      deck: shuffle([...deckIds], rng),
      discard: [],
      exiled: [],
      equipment: [],
      counters: [],
      equipSlots: opts.equipSlots !== undefined ? opts.equipSlots : CONFIG.equipSlotsStart,
      blessings: [...(opts.blessings || [])],
      upgrades: { ...(opts.upgrades || {}) },
      attackBonus: 0, // War Banner: +1 to all Attacks while equipped
      nextAttackBonus: 0, // Sharpen Blade / Battle Focus: next Attack only
      doubleNextDamage: false, // Blood Oath Blade
      lostHpThisTurn: false, // Vengeful Strike
      attacksPlayedThisTurn: 0, // Duel Dagger
      phoenixUsed: false,
      exileNextCard: false, // Mire Wisp: next played card is exiled
    },
    enemy: {
      id: monster.id,
      name: monster.name,
      hp: monster.hp,
      maxHp: monster.hp,
      armor: 0,
      attackIndex: 0,
      nextAttackBonus: 0, // Hollow Stag: +1 per damage taken
      firstAttackDone: false, // Thorn Wolf: first attack each turn +3
      turnCount: 0, // Mire Crocodile: every other enemy turn
    },
    log: [],
  };
  // RNG is runtime plumbing, not game state: keep it off the enumerable
  // state so the UI can serialise/inspect state without hitting a function.
  Object.defineProperty(state, 'rng', { value: rng, enumerable: false });

  log(state, `${monster.name} appears! (${monster.hp} HP)`);
  startPlayerTurn(state);
  return state;
}

export function isGameOver(state) {
  if (state.phase === 'won') return 'won';
  if (state.phase === 'lost') return 'lost';
  if (state.enemy.hp <= 0) return 'won';
  if (state.player.hp <= 0) return 'lost';
  return null;
}

function checkGameOver(state) {
  const result = isGameOver(state);
  if (result) state.phase = result;
  return result;
}

// ---------------------------------------------------------------------------
// Damage — the single choke point so every trigger fires in one place
// ---------------------------------------------------------------------------

export function gainArmor(state, amount) {
  if (amount <= 0 || isGameOver(state)) return;
  // Mini Rake (blessing): all Armor gained is doubled.
  if (state.player.blessings.includes('mini-rake')) amount *= 2;
  state.player.armor += amount;
  log(state, `You gain ${amount} Armor.`);
  // Spike Barrier: whenever you gain Armor, deal 2 damage to the enemy.
  if (state.player.equipment.includes('spike-barrier')) {
    dealDamageToEnemy(state, 2, {});
  }
}

export function dealDamageToEnemy(state, amount, { piercing = false } = {}) {
  if (amount <= 0 || state.enemy.hp <= 0) return 0;
  let remaining = amount;
  if (!piercing && state.enemy.armor > 0) {
    const absorbed = Math.min(state.enemy.armor, remaining);
    state.enemy.armor -= absorbed;
    remaining -= absorbed;
  }
  if (remaining > 0) {
    state.enemy.hp = Math.max(0, state.enemy.hp - remaining);
    log(state, `${state.enemy.name} takes ${remaining} damage.`);
    // Hollow Stag: when it takes damage, its next attack deals +1 damage.
    if (state.enemy.id === 'hollow-stag') {
      state.enemy.nextAttackBonus += 1;
    }
  }
  checkGameOver(state);
  return remaining;
}

export function dealDamageToPlayer(state, amount, { piercing = false, fromEnemy = false } = {}) {
  if (amount <= 0 || state.player.hp <= 0) return 0;
  let remaining = amount;
  if (!piercing && state.player.armor > 0) {
    const absorbed = Math.min(state.player.armor, remaining);
    state.player.armor -= absorbed;
    remaining -= absorbed;
  }
  state.player.hp -= remaining;
  // Only real HP loss counts for Vengeful Strike (Armor absorbing the
  // whole hit is not "losing HP").
  if (remaining > 0) state.player.lostHpThisTurn = true;
  log(state, `You take ${remaining} damage.`);

  if (state.player.hp <= 0) {
    // Phoenix Crest: first lethal damage each battle restores you to 10 HP.
    if (state.player.equipment.includes('phoenix-crest') && !state.player.phoenixUsed) {
      state.player.phoenixUsed = true;
      state.player.hp = 10;
      state.player.equipment = state.player.equipment.filter((id) => id !== 'phoenix-crest');
      log(state, 'Phoenix Crest shatters — you rise again at 10 HP!');
    } else {
      state.player.hp = Math.max(0, state.player.hp);
    }
  }

  // Chainmail Vest: whenever you take damage, gain 2 Armor (after damage).
  if (state.player.equipment.includes('chainmail-vest')) {
    gainArmor(state, 2);
  }
  // Blood Oath Blade: damage taken on YOUR turn doubles the next damage.
  if (state.phase === 'player' && state.player.equipment.includes('blood-oath-blade')) {
    state.player.doubleNextDamage = true;
  }
  // Thorn Guard: enemy damage is reflected back for 2.
  if (fromEnemy && state.player.counters.includes('thorn-guard')) {
    dealDamageToEnemy(state, 2, {});
  }
  checkGameOver(state);
  return remaining;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function drawCards(state, n) {
  for (let i = 0; i < n; i += 1) {
    if (state.player.deck.length === 0) {
      if (state.player.discard.length === 0) break;
      state.player.deck = shuffle([...state.player.discard], state.rng);
      state.player.discard = [];
      log(state, 'Discard pile shuffled back into the deck.');
    }
    state.player.hand.push(state.player.deck.pop());
  }
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

export function startPlayerTurn(state) {
  if (isGameOver(state)) return;
  state.turn += 1;
  state.phase = 'player';

  // Hand returns to the deck, then shuffle and draw.
  if (state.player.hand.length > 0) {
    state.player.deck.push(...state.player.hand);
    state.player.hand = [];
  }
  shuffle(state.player.deck, state.rng);
  drawCards(state, CONFIG.drawPerTurn);

  // Action refills to cap; Mana does NOT regenerate.
  state.player.action = state.player.actionCap;
  // Rat King: at the start of the player's turn, lose 1 Action.
  if (state.enemy.id === 'rat-king') {
    state.player.action = Math.max(0, state.player.action - 1);
    log(state, 'Rat King steals 1 Action!');
  }
  state.player.lostHpThisTurn = false;
  state.player.nextAttackBonus = 0;
  state.player.attacksPlayedThisTurn = 0;
  state.player.doubleNextDamage = false;
  // Bulwark Shield: at the start of your turn, gain 3 Armor.
  if (state.player.equipment.includes('bulwark-shield')) {
    gainArmor(state, 3);
  }
  // Mire Wisp: exiles the first card the player plays this turn.
  state.player.exileNextCard = state.enemy.id === 'mire-wisp';
  if (state.player.exileNextCard) {
    log(state, 'Mire Wisp will exile the first card you play.');
  }
  log(state, `--- Turn ${state.turn}: Your Turn ---`);
}

function runEnemyTurn(state) {
  state.phase = 'enemy';
  const enemy = state.enemy;
  enemy.turnCount += 1;
  enemy.firstAttackDone = false;

  // Grave Witch: heals 2 HP at the start of its turn.
  if (enemy.id === 'grave-witch' && enemy.hp > 0) {
    const healed = Math.min(2, enemy.maxHp - enemy.hp);
    if (healed > 0) {
      enemy.hp += healed;
      log(state, `Grave Witch heals ${healed} HP.`);
    }
  }

  // Mire Crocodile: every other enemy turn, discards the player's hand.
  if (enemy.id === 'mire-crocodile' && enemy.turnCount % 2 === 0 && state.player.hand.length > 0) {
    state.player.discard.push(...state.player.hand);
    state.player.hand = [];
    log(state, 'Mire Crocodile snaps its jaws — your hand is discarded!');
  }

  // One attack, cycling the attack deck in order.
  const monster = getMonster(enemy.id);
  const attack = monster.attacks[enemy.attackIndex % monster.attacks.length];
  enemy.attackIndex += 1;

  let damage = attack.damage + enemy.nextAttackBonus;
  enemy.nextAttackBonus = 0;
  // Thorn Wolf: its first attack each turn deals +3 damage.
  if (enemy.id === 'thorn-wolf' && !enemy.firstAttackDone) {
    damage += 3;
    enemy.firstAttackDone = true;
  }

  // Parry: negate the enemy attack and deal 3 damage back.
  if (state.player.counters.includes('parry')) {
    log(state, `Parry! ${attack.name} is negated.`);
    dealDamageToEnemy(state, 3, {});
    return;
  }

  log(state, `${enemy.name} uses ${attack.name} (${damage} damage${attack.piercing ? ', piercing' : ''}).`);
  dealDamageToPlayer(state, damage, { piercing: attack.piercing, fromEnemy: true });
}

export function endTurn(state) {
  if (state.phase !== 'player') return { ok: false, reason: 'not-player-turn' };
  if (isGameOver(state)) return { ok: false, reason: 'game-over' };

  // Enemy acts while the player still holds their hand (Crocodile rule).
  runEnemyTurn(state);
  if (isGameOver(state)) return { ok: true };

  // End of turn: leftover hand joins the discard pile, then the whole
  // discard pile shuffles back into the deck.
  if (state.player.hand.length > 0) {
    state.player.discard.push(...state.player.hand);
    state.player.hand = [];
  }
  if (state.player.discard.length > 0) {
    state.player.deck.push(...state.player.discard);
    state.player.discard = [];
    shuffle(state.player.deck, state.rng);
    log(state, 'Discard pile shuffled back into the deck.');
  }

  startPlayerTurn(state);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Playing cards
// ---------------------------------------------------------------------------

function applyAttackDamage(state, card, base) {
  const p = state.player;
  let amount = base;
  if (card.type === 'Attack') {
    amount += p.attackBonus; // War Banner
    if (p.nextAttackBonus > 0) {
      amount += p.nextAttackBonus;
      p.nextAttackBonus = 0;
    }
    // Duel Dagger: every 2nd Attack played this turn deals 1 extra damage.
    if (p.equipment.includes('duel-dagger') && (p.attacksPlayedThisTurn + 1) % 2 === 0) {
      amount += 1;
    }
    // Battle Trumpet (blessing): Basic Strike deals +2 damage.
    if (card.id === 'basic-strike' && p.blessings.includes('battle-trumpet')) {
      amount += 2;
    }
    // Smithy upgrade: Attack cards deal +3 damage per upgrade.
    amount += 3 * upgradeCount(state, card.id);
  } else {
    // Smithy upgrade: other damage-dealing cards deal +1 per upgrade.
    amount += 1 * upgradeCount(state, card.id);
  }
  // Blood Oath Blade: double the next damage you deal.
  if (p.doubleNextDamage) {
    amount *= 2;
    p.doubleNextDamage = false;
  }
  return dealDamageToEnemy(state, amount, {});
}

function applyCardEffect(state, card) {
  const p = state.player;
  const e = state.enemy;
  const up = upgradeCount(state, card.id);
  // Smithy upgrade: armor-gain cards gain +3 Armor per upgrade, draw cards
  // draw +1 per upgrade. Damage bonuses live in applyAttackDamage.
  const armorBonus = ARMOR_UPGRADE_CARDS.has(card.id) ? 3 * up : 0;
  const drawBonus = DRAW_UPGRADE_CARDS.has(card.id) ? up : 0;
  const arm = (n) => n + armorBonus;
  const draw = (n) => drawCards(state, n + drawBonus);
  switch (card.effect) {
    // --- Attack damage ---
    case 'damage-3': applyAttackDamage(state, card, 3); break;
    case 'damage-9-gain-armor-3':
      applyAttackDamage(state, card, 9);
      gainArmor(state, arm(3));
      break;
    case 'damage-equal-armor': applyAttackDamage(state, card, p.armor); break;
    case 'damage-2-or-20-if-enemy-low':
      applyAttackDamage(state, card, e.hp < e.maxHp / 2 ? 20 : 2);
      break;
    case 'damage-2-per-equipment': applyAttackDamage(state, card, 2 * p.equipment.length); break;
    case 'damage-6-or-9-if-armor': applyAttackDamage(state, card, p.armor > 0 ? 9 : 6); break;
    case 'damage-12': applyAttackDamage(state, card, 12); break;
    case 'damage-4-gain-armor-4':
      applyAttackDamage(state, card, 4);
      gainArmor(state, arm(4));
      break;
    case 'damage-half-armor': applyAttackDamage(state, card, Math.floor(p.armor / 2)); break;
    case 'damage-5-or-10-if-lost-hp':
      applyAttackDamage(state, card, p.lostHpThisTurn ? 10 : 5);
      break;
    case 'damage-7-or-11-if-enemy-more-hp':
      applyAttackDamage(state, card, e.hp > p.hp ? 11 : 7);
      break;
    // --- Action ---
    case 'draw-2': draw(2); break;
    case 'gain-armor-6-draw-1': gainArmor(state, arm(6)); draw(1); break;
    case 'next-attack-plus-6-draw-1': p.nextAttackBonus += 6; draw(1); break;
    case 'gain-action-1-draw-1':
      p.action = Math.min(p.actionCap, p.action + 1);
      draw(1);
      break;
    case 'gain-armor-5-draw-1': gainArmor(state, arm(5)); draw(1); break;
    case 'draw-2-next-attack-plus-3': draw(2); p.nextAttackBonus += 3; break;
    case 'gain-armor-4-draw-1': gainArmor(state, arm(4)); draw(1); break;
    // --- Spell ---
    case 'gain-armor-10-draw-1': gainArmor(state, arm(10)); draw(1); break;
    case 'gain-armor-12': gainArmor(state, arm(12)); break;
    case 'gain-armor-8': gainArmor(state, arm(8)); break;
    case 'damage-8': applyAttackDamage(state, card, 8); break;
    case 'gain-armor-6-heal-6':
      gainArmor(state, arm(6));
      p.hp = Math.min(p.maxHp, p.hp + 6);
      break;
    // --- Mana ---
    case 'gain-mana-4':
      p.mana += 4;
      // Smithy upgrade: other cards (no damage / armor / draw) gain +2 Armor.
      if (up > 0) gainArmor(state, 2 * up);
      break;
    case 'gain-mana-3-draw-1': p.mana += 3; draw(1); break;
    // --- Equipment / Counter: no immediate effect; they sit in their row.
    default: break;
  }
}

export function playCard(state, handIndex) {
  if (isGameOver(state)) return { ok: false, reason: 'game-over' };
  if (state.phase !== 'player') return { ok: false, reason: 'not-player-turn' };
  if (handIndex < 0 || handIndex >= state.player.hand.length) {
    return { ok: false, reason: 'bad-index' };
  }
  const cardId = state.player.hand[handIndex];
  const card = getCard(cardId);
  if (!card) return { ok: false, reason: 'unknown-card' };

  const p = state.player;

  // --- Validate costs / slots before paying anything. ---
  if (card.type === 'Action' && p.action < card.cost) {
    return { ok: false, reason: 'no-action' };
  }
  if (card.type === 'Spell' && p.mana < card.cost) {
    return { ok: false, reason: 'no-mana' };
  }
  if (card.type === 'Equipment' && p.equipment.length >= p.equipSlots) {
    return { ok: false, reason: 'no-slot' };
  }

  // --- Pay. ---
  if (card.type === 'Action') p.action -= card.cost;
  if (card.type === 'Spell') p.mana -= card.cost;

  // --- Remove from hand. ---
  state.player.hand.splice(handIndex, 1);
  log(state, `You play ${card.name}.`);

  // --- Equipment / Counter go to their row and stay for the fight. ---
  if (card.type === 'Equipment') {
    p.equipment.push(card.id);
    if (card.effect === 'attack-bonus-1') p.attackBonus += 1; // War Banner
    // Lucky Horseshoe: whenever you play an Equipment card, gain 2 Armor.
    // (The horseshoe itself counts if it was already equipped.)
    if (p.equipment.includes('lucky-horseshoe')) gainArmor(state, 2);
    // Ember Artillery (blessing): equipping deals 6 fire damage.
    if (p.blessings.includes('ember-artillery')) {
      log(state, 'Ember Artillery erupts!');
      dealDamageToEnemy(state, 6, {});
    }
    // Smithy upgrade: other cards (no damage / armor / draw) gain +2 Armor.
    const up = upgradeCount(state, card.id);
    if (up > 0) gainArmor(state, 2 * up);
    return { ok: true };
  }
  if (card.type === 'Counter') {
    p.counters.push(card.id);
    return { ok: true };
  }

  // --- Apply the effect. ---
  applyCardEffect(state, card);

  if (card.type === 'Attack') {
    p.attacksPlayedThisTurn += 1;
    // Warden's Shield: whenever you play an Attack card, gain 2 Armor.
    if (p.equipment.includes('wardens-shield')) gainArmor(state, 2);
  }

  // --- Destination: exile (Mire Wisp) or discard. ---
  if (p.exileNextCard) {
    p.exileNextCard = false;
    p.exiled.push(card.id);
    log(state, `${card.name} is exiled by Mire Wisp!`);
  } else {
    p.discard.push(card.id);
  }

  checkGameOver(state);
  return { ok: true };
}
