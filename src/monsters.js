// Moonlit Knight — monster data (Stage 1).
// HP values are proposed design numbers (not yet playtested/confirmed).
// Each monster has a small attack deck; the engine plays ONE attack per
// enemy turn, cycling through the deck in order (see engine.js ENEMY_AI note).

export const MONSTERS = [
  { id: 'thorn-wolf', name: 'Thorn Wolf', hp: 20, boss: false,
    special: 'Its first attack each turn deals +3 damage.',
    attacks: [
      { name: 'Bite', damage: 4, piercing: false },
      { name: 'Claw', damage: 6, piercing: false },
    ] },
  { id: 'rat-king', name: 'Rat King', hp: 33, boss: false,
    special: "At the start of the player's turn, the player loses 1 Action.",
    attacks: [
      { name: 'Gnaw', damage: 4, piercing: false },
      { name: 'Swarm', damage: 5, piercing: false },
    ] },
  { id: 'hollow-stag', name: 'Hollow Stag', hp: 28, boss: false,
    special: 'When it takes damage, its next attack deals +1 damage.',
    attacks: [
      { name: 'Gore', damage: 5, piercing: false },
      { name: 'Trample', damage: 6, piercing: false },
    ] },
  { id: 'mire-wisp', name: 'Mire Wisp', hp: 25, boss: false,
    special: 'Exiles the first card the player plays next turn.',
    attacks: [
      { name: 'Wail', damage: 4, piercing: false },
      { name: 'Drain', damage: 5, piercing: true },
    ] },
  { id: 'mire-crocodile', name: 'Mire Crocodile', hp: 60, boss: true,
    special: "Every other turn, discards the player's hand.",
    attacks: [
      { name: 'Chomp', damage: 7, piercing: false },
      { name: 'Tail Slam', damage: 9, piercing: false },
    ] },
  { id: 'grave-witch', name: 'Grave Witch', hp: 100, boss: true,
    special: 'Heals 2 HP at the start of its turn.',
    attacks: [
      { name: 'Hex', damage: 6, piercing: false },
      { name: 'Curse', damage: 8, piercing: true },
    ] },
];

const BY_ID = new Map(MONSTERS.map((m) => [m.id, m]));

export function getMonster(id) {
  return BY_ID.get(id) || null;
}
