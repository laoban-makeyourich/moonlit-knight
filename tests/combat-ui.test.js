// Moonlit Knight — combat UI smoke test (Stage 2).
// Run: node --test tests/combat-ui.test.js
//
// Headless DOM via jsdom, which is installed dev-only into /tmp/mk-test
// (NOT committed to the repo). If jsdom is missing, this file fails loudly
// with install instructions instead of faking a pass.
//
// Covers: mount + initial render, hand render, click-to-play through the
// real DOM handler, End Turn through the real button, playability rules,
// victory overlay (+ Fight Again), defeat overlay (+ Retry Battle), and
// exit-to-title. It does NOT cover real-browser layout, hover enlargement,
// or animation visuals — those need the parent's browser playtest.

import test from 'node:test';
import assert from 'node:assert/strict';

let JSDOM;
try {
  ({ JSDOM } = await import('/tmp/mk-test/node_modules/jsdom/lib/api.js'));
} catch {
  throw new Error(
    'jsdom is required for this smoke test. Install it dev-only with:\n'
    + '  mkdir -p /tmp/mk-test && cd /tmp/mk-test && npm init -y && npm install jsdom',
  );
}

// jsdom fixture: the two nodes combat-ui.js touches outside its own root.
const dom = new JSDOM(
  '<!DOCTYPE html><body>'
  + '<section id="title-screen"></section>'
  + '<section id="game-screen"><div id="banner"></div></section>'
  + '</body>',
  { url: 'http://localhost/' },
);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.MouseEvent = dom.window.MouseEvent;

const { startCombat, isPlayable } = await import('../src/combat-ui.js');

const TEN_STRIKES = Array(10).fill('basic-strike');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mount(opts = {}) {
  const container = document.getElementById('game-screen');
  let exited = false;
  const api = startCombat(container, {
    monsterId: opts.monsterId || 'thorn-wolf',
    deckIds: opts.deckIds || TEN_STRIKES,
    seed: 42,
    onExit: () => { exited = true; },
  });
  return { api, container, wasExited: () => exited };
}

const $ = (sel, root) => root.querySelector(sel);
const $$ = (sel, root) => [...root.querySelectorAll(sel)];

test('mount: enemy, HUD and a 5-card hand render', () => {
  const { api, container } = mount();
  try {
    assert.equal($('.enemy-name', container).textContent.includes('Thorn Wolf'), true);
    assert.equal($('.enemy-area .bar-text', container).textContent, '20 / 20');
    assert.equal($('.hud-hp .bar-text', container).textContent, '30 / 30');
    assert.equal($('.hud-mana .bar-text', container).textContent, '2 Mana');
    assert.equal($('.action-num', container).textContent, '2 / 2');
    assert.equal($('.gold-num', container).textContent, '23');
    assert.equal($$('.hand-card', container).length, 5);
    assert.equal($('.armor-badge', container).classList.contains('hidden'), true);
    assert.equal($$('.log-line', container).length > 0, true);
    assert.ok(api.state.phase === 'player');
  } finally {
    api.destroy();
  }
});

test('click-to-play: a strike damages the enemy and a floater appears', () => {
  const { api, container } = mount();
  try {
    const before = api.state.enemy.hp;
    $$('.hand-card', container)[0].click();
    assert.equal(api.state.enemy.hp, before - 3);
    assert.equal($$('.hand-card', container).length, 4);
    assert.equal($$('.floater.dmg', container).length >= 1, true);
    assert.equal($('.enemy-area .bar-text', container).textContent, '17 / 20');
  } finally {
    api.destroy();
  }
});

test('playability: Action needs Action, Spell needs Mana, Equipment needs a slot', () => {
  const { api } = mount();
  try {
    const s = api.state;
    assert.equal(isPlayable(s, { type: 'Action', cost: 1 }), true);
    s.player.action = 0;
    assert.equal(isPlayable(s, { type: 'Action', cost: 1 }), false);
    assert.equal(isPlayable(s, { type: 'Spell', cost: 3 }), false); // 2 Mana
    s.player.mana = 6;
    assert.equal(isPlayable(s, { type: 'Spell', cost: 6 }), true);
    assert.equal(isPlayable(s, { type: 'Equipment', cost: 0 }), true);
    s.player.equipment.push('war-banner');
    assert.equal(isPlayable(s, { type: 'Equipment', cost: 0 }), false); // 1 slot
    assert.equal(isPlayable(s, { type: 'Attack', cost: 0 }), true);
    s.phase = 'enemy';
    assert.equal(isPlayable(s, { type: 'Attack', cost: 0 }), false);
  } finally {
    api.destroy();
  }
});

test('End Turn: enemy attacks, new turn starts, hand refills to 5', async () => {
  const { api, container } = mount();
  try {
    $('.end-turn-btn', container).click();
    assert.equal(api.state.turn, 2);
    assert.equal(api.state.phase, 'player');
    // Thorn Wolf first attack each turn: Bite 4 + 3 = 7 damage, no armor.
    assert.equal(api.state.player.hp, 23);
    assert.equal($$('.hand-card', container).length, 5);
    assert.equal($('.hud-hp .bar-text', container).textContent, '23 / 30');
    assert.equal($$('.log-line', container).length, 5);
  } finally {
    api.destroy();
  }
});

test('victory overlay: Fight Again starts a fresh fight', async () => {
  const { api, container } = mount();
  try {
    api.state.enemy.hp = 3;
    api.playHandIndex(0); // Basic Strike: 3 damage -> enemy dead
    assert.equal(api.state.phase, 'won');
    await sleep(800); // overlay appears after a 650ms delay
    const overlay = $('.overlay', container);
    assert.equal(overlay.classList.contains('hidden'), false);
    assert.equal($('.overlay-title', container).textContent, 'Victory!');
    assert.match($('.overlay-line', container).textContent, /Gold:/);
    const [nextBtn, againBtn] = $$('.overlay-btns .btn', container);
    assert.equal(nextBtn.textContent, 'Next');
    assert.equal(againBtn.textContent, 'Fight Again');
    againBtn.click();
    await sleep(50);
    // A fresh combat root replaced the old one: full enemy HP, 5-card hand.
    assert.equal($('.enemy-area .bar-text', container).textContent, '20 / 20');
    assert.equal($$('.hand-card', container).length, 5);
  } finally {
    // The restarted combat has its own root; remove whatever is mounted.
    const root = container.querySelector('#combat-root');
    if (root) root.remove();
  }
});

test('victory overlay with onVictory: Continue calls onVictory, Title exits', async () => {
  const container = document.getElementById('game-screen');
  let exited = false;
  let victoryState = null;
  const api = startCombat(container, {
    monsterId: 'thorn-wolf',
    deckIds: TEN_STRIKES,
    seed: 42,
    onExit: () => { exited = true; },
    onVictory: (state) => { victoryState = state; },
  });
  try {
    api.state.enemy.hp = 3;
    api.playHandIndex(0); // Basic Strike: 3 damage -> enemy dead
    assert.equal(api.state.phase, 'won');
    await sleep(800);
    const overlay = $('.overlay', container);
    assert.equal(overlay.classList.contains('hidden'), false);
    assert.equal($('.overlay-title', container).textContent, 'Victory!');
    const [continueBtn, titleBtn] = $$('.overlay-btns .btn', container);
    assert.equal(continueBtn.textContent, 'Continue');
    assert.equal(titleBtn.textContent, 'Title');
    continueBtn.click();
    await sleep(50);
    assert.ok(victoryState, 'onVictory should have been called');
    assert.equal(victoryState.phase, 'won');
    assert.equal(exited, false); // Continue is not an exit
    // Title still exits.
    titleBtn.click();
    await sleep(50);
    assert.equal(exited, true);
    assert.equal(container.querySelector('#combat-root'), null);
  } finally {
    const root = container.querySelector('#combat-root');
    if (root) root.remove();
  }
});

test('defeat overlay with onRetry: Retry Battle calls onRetry instead of restarting', async () => {
  const container = document.getElementById('game-screen');
  let retried = false;
  const api = startCombat(container, {
    monsterId: 'thorn-wolf',
    deckIds: TEN_STRIKES,
    seed: 42,
    onExit: () => {},
    onRetry: () => { retried = true; },
  });
  try {
    api.state.player.hp = 1;
    $('.end-turn-btn', container).click(); // enemy hits for 7 -> dead
    assert.equal(api.state.phase, 'lost');
    await sleep(800);
    assert.equal($('.overlay-title', container).textContent, 'Defeated…');
    const [retryBtn] = $$('.overlay-btns .btn', container);
    assert.equal(retryBtn.textContent, 'Retry Battle');
    retryBtn.click();
    await sleep(50);
    assert.equal(retried, true);
    // No automatic restart: the same (lost) combat is still mounted.
    assert.equal(container.querySelector('#combat-root'), api.root);
    assert.equal(api.state.phase, 'lost');
  } finally {
    api.destroy();
  }
});

test('defeat overlay: Retry Battle restarts at full HP; Title exits', async () => {
  const { api, container } = mount();
  try {
    api.state.player.hp = 1;
    $('.end-turn-btn', container).click(); // enemy hits for 7 -> dead
    assert.equal(api.state.phase, 'lost');
    await sleep(800);
    assert.equal($('.overlay-title', container).textContent, 'Defeated…');
    const [retryBtn, titleBtn] = $$('.overlay-btns .btn', container);
    assert.equal(retryBtn.textContent, 'Retry Battle');
    assert.equal(titleBtn.textContent, 'Title');
    retryBtn.click();
    await sleep(50);
    assert.equal($('.hud-hp .bar-text', container).textContent, '30 / 30');
    assert.equal($$('.hand-card', container).length, 5);
    // Lose again, then take the Title exit.
    const root = container.querySelector('#combat-root');
    assert.ok(root, 'restarted combat should be mounted');
  } finally {
    const root = container.querySelector('#combat-root');
    if (root) root.remove();
  }

  // Second fight: defeat, then Title calls onExit.
  const second = mount();
  try {
    second.api.state.player.hp = 1;
    $('.end-turn-btn', second.container).click();
    await sleep(800);
    const [, titleBtn] = $$('.overlay-btns .btn', second.container);
    titleBtn.click();
    await sleep(50);
    assert.equal(second.wasExited(), true);
    assert.equal(second.container.querySelector('#combat-root'), null);
  } finally {
    const root = second.container.querySelector('#combat-root');
    if (root) root.remove();
  }
});

// --- Playtest fixes (2026-11-07): hover preview, delegated clicks ---------
test('hover preview: mouseover shows a separate preview, mouseout hides it', () => {
  const { api, container } = mount();
  try {
    const preview = container.querySelector('#card-preview');
    assert.ok(preview, 'preview element exists');
    assert.equal(preview.classList.contains('show'), false);
    const first = $$('.hand-card', container)[0];
    first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    assert.equal(preview.classList.contains('show'), true);
    assert.ok(preview.src.includes('basic-strike'), 'preview shows the hovered card art');
    first.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    assert.equal(preview.classList.contains('show'), false);
  } finally {
    api.destroy();
  }
});

test('delegated clicks: two different cards in quick succession both play', () => {
  const { api, container } = mount();
  try {
    const before = api.state.enemy.hp;
    $$('.hand-card', container)[0].click();
    assert.equal(api.state.enemy.hp, before - 3);
    // The hand re-rendered; immediately click the card now at index 0.
    // Same index, new generation — must NOT be swallowed by the debounce.
    $$('.hand-card', container)[0].click();
    assert.equal(api.state.enemy.hp, before - 6);
  } finally {
    api.destroy();
  }
});

test('delegated clicks: double-click on one card plays it once', () => {
  const { api, container } = mount();
  try {
    // Force Second Wind to the front of the hand so no draw luck is needed.
    api.state.player.hand = ['second-wind', 'basic-strike', 'basic-strike', 'basic-strike', 'basic-strike'];
    api.state.player.action = 0;
    api.render();
    const first = $$('.hand-card', container).find((img) => img.title.startsWith('Second Wind'));
    assert.ok(first, 'Second Wind is in hand');
    const hpBefore = api.state.enemy.hp;
    first.click();
    first.click();
    assert.equal(api.state.enemy.hp, hpBefore, 'failed card deals no damage twice');
    assert.equal($$('.hand-card.shake', container).length, 1, 'exactly one shake');
  } finally {
    api.destroy();
  }
});
