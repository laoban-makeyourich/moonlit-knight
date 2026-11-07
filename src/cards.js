// Moonlit Knight — card data (Stage 1).
// All 36 cards. Art lives in assets/cards/<id>.jpg. Costs are in the card's
// own resource: Attack = free, Action = Action points, Spell = Mana,
// Mana/Equipment/Counter = free (Equipment is limited by equip slots instead).
// `effect` is the engine key the combat engine switches on; `text` is the
// player-facing wording printed on the card.

export const CARDS = [
  // ---- Attack (cost 0 — free) ----
  { id: 'basic-strike', name: 'Basic Strike', type: 'Attack', cost: 0, stars: 1,
    text: 'Deal 3 damage.', effect: 'damage-3' },
  { id: 'iron-thorn', name: 'Iron Thorn', type: 'Attack', cost: 0, stars: 2,
    text: 'Deal 9 damage. Gain 3 Armor.', effect: 'damage-9-gain-armor-3' },
  { id: 'piercing-thrust', name: 'Piercing Thrust', type: 'Attack', cost: 0, stars: 2,
    text: 'Deal damage equal to your Armor.', effect: 'damage-equal-armor' },
  { id: 'final-verdict', name: 'Final Verdict', type: 'Attack', cost: 0, stars: 2,
    text: 'Deal 2 damage. If the enemy has less than half HP, deal 20 damage instead.',
    effect: 'damage-2-or-20-if-enemy-low' },
  { id: 'arsenal-strike', name: 'Arsenal Strike', type: 'Attack', cost: 0, stars: 2,
    text: 'Deal 2 damage for each Equipment you have.', effect: 'damage-2-per-equipment' },
  { id: 'ember-slash', name: 'Ember Slash', type: 'Attack', cost: 0, stars: 2,
    text: 'Deal 6 damage. If you have Armor, deal 9 damage instead.', effect: 'damage-6-or-9-if-armor' },
  { id: 'heavy-cleave', name: 'Heavy Cleave', type: 'Attack', cost: 0, stars: 2,
    text: 'Deal 12 damage.', effect: 'damage-12' },
  { id: 'riposte', name: 'Riposte', type: 'Attack', cost: 0, stars: 2,
    text: 'Deal 4 damage. Gain 4 Armor.', effect: 'damage-4-gain-armor-4' },
  { id: 'shield-bash', name: 'Shield Bash', type: 'Attack', cost: 0, stars: 2,
    text: 'Deal damage equal to half your Armor.', effect: 'damage-half-armor' },
  { id: 'vengeful-strike', name: 'Vengeful Strike', type: 'Attack', cost: 0, stars: 2,
    text: 'Deal 5 damage. If you lost HP this turn, deal 10 damage instead.',
    effect: 'damage-5-or-10-if-lost-hp' },
  { id: 'crimson-edge', name: 'Crimson Edge', type: 'Attack', cost: 0, stars: 2,
    text: 'Deal 7 damage. If the enemy has more HP than you, deal 11 damage instead.',
    effect: 'damage-7-or-11-if-enemy-more-hp' },

  // ---- Action (cost 1 Action point each) ----
  { id: 'second-wind', name: 'Second Wind', type: 'Action', cost: 1, stars: 1,
    text: 'Draw 2 cards.', effect: 'draw-2' },
  { id: 'bulwark-stance', name: 'Bulwark Stance', type: 'Action', cost: 1, stars: 2,
    text: 'Gain 6 Armor. Draw a card.', effect: 'gain-armor-6-draw-1' },
  { id: 'sharpen-blade', name: 'Sharpen Blade', type: 'Action', cost: 1, stars: 1,
    text: 'Your next Attack this turn deals +6 damage. Draw 1 card.',
    effect: 'next-attack-plus-6-draw-1' },
  { id: 'rally-cry', name: 'Rally Cry', type: 'Action', cost: 1, stars: 1,
    text: 'Gain 1 Action. Draw 1 card.', effect: 'gain-action-1-draw-1' },
  { id: 'war-cry', name: 'War Cry', type: 'Action', cost: 1, stars: 2,
    text: 'Gain 5 Armor. Draw 1 card.', effect: 'gain-armor-5-draw-1' },
  { id: 'battle-focus', name: 'Battle Focus', type: 'Action', cost: 1, stars: 2,
    text: 'Draw 2 cards. Your next Attack this turn deals +3 damage.',
    effect: 'draw-2-next-attack-plus-3' },
  { id: 'iron-resolve', name: 'Iron Resolve', type: 'Action', cost: 1, stars: 1,
    text: 'Gain 4 Armor. Draw 1 card.', effect: 'gain-armor-4-draw-1' },

  // ---- Spell (cost = Mana) ----
  { id: 'aegis-light', name: 'Aegis Light', type: 'Spell', cost: 4, stars: 2,
    text: 'Gain 10 Armor. Draw 1 card.', effect: 'gain-armor-10-draw-1' },
  { id: 'moonlit-guard', name: 'Moonlit Guard', type: 'Spell', cost: 5, stars: 2,
    text: 'Gain 12 Armor.', effect: 'gain-armor-12' },
  { id: 'iron-will', name: 'Iron Will', type: 'Spell', cost: 3, stars: 1,
    text: 'Gain 8 Armor.', effect: 'gain-armor-8' },
  { id: 'steel-rain', name: 'Steel Rain', type: 'Spell', cost: 6, stars: 2,
    text: 'Deal 8 damage.', effect: 'damage-8' },
  { id: 'guardians-oath', name: "Guardian's Oath", type: 'Spell', cost: 5, stars: 2,
    text: 'Gain 6 Armor. Heal 6 HP.', effect: 'gain-armor-6-heal-6' },

  // ---- Mana (cost 0 — free) ----
  { id: 'mana-crystal', name: 'Mana Crystal', type: 'Mana', cost: 0, stars: 1,
    text: 'Gain 4 Mana.', effect: 'gain-mana-4' },
  { id: 'deep-breath', name: 'Deep Breath', type: 'Mana', cost: 0, stars: 1,
    text: 'Gain 3 Mana. Draw 1 card.', effect: 'gain-mana-3-draw-1' },

  // ---- Equipment (cost 0 — limited by equip slots; stays in play for the fight) ----
  { id: 'wardens-shield', name: "Warden's Shield", type: 'Equipment', cost: 0, stars: 2,
    text: 'Whenever you play an Attack card, gain 2 Armor.', effect: 'on-attack-gain-armor-2' },
  { id: 'duel-dagger', name: 'Duel Dagger', type: 'Equipment', cost: 0, stars: 2,
    text: 'Each time you play 2 Attack cards, deal 1 damage.', effect: 'every-2nd-attack-deal-1' },
  { id: 'blood-oath-blade', name: 'Blood Oath Blade', type: 'Equipment', cost: 0, stars: 2,
    text: 'When you take damage on your turn, double the next damage you deal.',
    effect: 'on-damage-own-turn-double-next' },
  { id: 'spike-barrier', name: 'Spike Barrier', type: 'Equipment', cost: 0, stars: 2,
    text: 'Whenever you gain Armor, deal 2 damage to the enemy.', effect: 'on-armor-gain-deal-2' },
  { id: 'bulwark-shield', name: 'Bulwark Shield', type: 'Equipment', cost: 0, stars: 2,
    text: 'At the start of your turn, gain 3 Armor.', effect: 'on-turn-start-gain-armor-3' },
  { id: 'chainmail-vest', name: 'Chainmail Vest', type: 'Equipment', cost: 0, stars: 2,
    text: 'Whenever you take damage, gain 2 Armor.', effect: 'on-damage-gain-armor-2' },
  { id: 'war-banner', name: 'War Banner', type: 'Equipment', cost: 0, stars: 2,
    text: 'Your Attack cards deal +1 damage.', effect: 'attack-bonus-1' },
  { id: 'lucky-horseshoe', name: 'Lucky Horseshoe', type: 'Equipment', cost: 0, stars: 2,
    text: 'Whenever you play an Equipment card, gain 2 Armor.', effect: 'on-equipment-gain-armor-2' },
  { id: 'phoenix-crest', name: 'Phoenix Crest', type: 'Equipment', cost: 0, stars: 2,
    text: 'The first time you would die each battle, restore 10 HP instead.',
    effect: 'phoenix-revive-10' },

  // ---- Counter (cost 0 — sits in the counters row, triggers passively) ----
  { id: 'parry', name: 'Parry', type: 'Counter', cost: 0, stars: 2,
    text: 'When the enemy plays an Attack card, negate it and deal 3 damage.',
    effect: 'negate-enemy-attack-deal-3' },
  { id: 'thorn-guard', name: 'Thorn Guard', type: 'Counter', cost: 0, stars: 2,
    text: 'When the enemy deals damage to you, deal 2 damage back.', effect: 'reflect-2' },
];

// The 8-card deck every run starts with.
export const STARTER_DECK = [
  'basic-strike', 'basic-strike', 'basic-strike', 'basic-strike',
  'iron-thorn',
  'wardens-shield',
  'piercing-thrust',
  'second-wind',
];

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export function getCard(id) {
  return BY_ID.get(id) || null;
}
