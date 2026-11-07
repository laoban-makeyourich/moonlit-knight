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
globalThis.PointerEvent = dom.window.PointerEvent;
if (typeof globalThis.PointerEvent !== 'function') {
  throw new Error('jsdom here has no PointerEvent — the drag tests cannot run honestly.');
}

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

// --- Drag helpers (Pointer Events, as a real browser dispatches them) -------
function pointer(target, type, { x, y, pointerId = 1, button = 0 } = {}) {
  const ev = new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId, button,
  });
  target.dispatchEvent(ev);
  return ev;
}

// Drag the hand card at `cardIndex` from (x0, y0) to (x1, y1) and release.
function dragCard(container, cardIndex, x0, y0, x1, y1) {
  const card = $$('.hand-card', container)[cardIndex];
  pointer(card, 'pointerdown', { x: x0, y: y0 });
  pointer(window, 'pointermove', { x: x1, y: y1 });
  pointer(window, 'pointerup', { x: x1, y: y1 });
}

test('drag-to-play: dragging a strike up damages the enemy and a floater appears', () => {
  const { api, container } = mount();
  try {
    const before = api.state.enemy.hp;
    dragCard(container, 0, 400, 700, 400, 560); // up 140px > 80px lift rule
    assert.equal(api.state.enemy.hp, before - 3);
    assert.equal($$('.hand-card', container).length, 4);
    assert.equal($$('.floater.dmg', container).length >= 1, true);
    assert.equal($('.enemy-area .bar-text', container).textContent, '17 / 20');
  } finally {
    api.destroy();
  }
});

test('drag-to-play: dropping over the enemy zone plays even without a big lift', () => {
  const { api, container } = mount();
  try {
    const before = api.state.enemy.hp;
    // Start low, end in the enemy zone (y < 45% of 768) with only 60px lift.
    dragCard(container, 0, 400, 400, 400, 340);
    assert.equal(api.state.enemy.hp, before - 3);
    assert.equal($$('.hand-card', container).length, 4);
  } finally {
    api.destroy();
  }
});

test('drag highlight: dragging up marks the enemy area as the drop target', () => {
  const { api, container } = mount();
  try {
    const card = $$('.hand-card', container)[0];
    pointer(card, 'pointerdown', { x: 400, y: 700 });
    pointer(window, 'pointermove', { x: 400, y: 600 });
    assert.equal($('.enemy-area', container).classList.contains('drop-target'), true);
    assert.equal(card.classList.contains('dragging'), true);
    pointer(window, 'pointerup', { x: 400, y: 600 });
    assert.equal($('.enemy-area', container).classList.contains('drop-target'), false);
  } finally {
    api.destroy();
  }
});

test('tap: tapping a card enlarges it in the preview and never plays it', () => {
  const { api, container } = mount();
  try {
    const before = api.state.enemy.hp;
    const card = $$('.hand-card', container)[0];
    pointer(card, 'pointerdown', { x: 400, y: 700 });
    pointer(window, 'pointerup', { x: 400, y: 700 }); // no movement: a tap
    assert.equal(api.state.enemy.hp, before, 'tap must not deal damage');
    assert.equal($$('.hand-card', container).length, 5);
    const preview = container.querySelector('#card-preview');
    assert.equal(preview.classList.contains('show'), true);
    assert.ok(preview.src.includes('basic-strike'), 'preview shows the tapped card');
    // Tap the same card again: the preview toggles off.
    pointer(card, 'pointerdown', { x: 400, y: 700 });
    pointer(window, 'pointerup', { x: 400, y: 700 });
    assert.equal(preview.classList.contains('show'), false);
  } finally {
    api.destroy();
  }
});

test('drag sideways / down: the card snaps back and is not played', () => {
  const { api, container } = mount();
  try {
    const before = api.state.enemy.hp;
    dragCard(container, 0, 400, 700, 520, 700); // sideways 120px
    assert.equal(api.state.enemy.hp, before);
    assert.equal($$('.hand-card', container).length, 5);
    assert.equal($$('.hand-card', container)[0].style.transform, '');
    dragCard(container, 0, 400, 700, 400, 760); // down 60px
    assert.equal(api.state.enemy.hp, before);
    assert.equal($$('.hand-card', container).length, 5);
  } finally {
    api.destroy();
  }
});

test('drag rejected: Second Wind with 0 Action is refused with a notice', () => {
  const { api, container } = mount();
  try {
    api.state.player.hand = ['second-wind', 'basic-strike', 'basic-strike', 'basic-strike', 'basic-strike'];
    api.state.player.action = 0;
    api.render();
    const card = $$('.hand-card', container).find((img) => img.title.startsWith('Second Wind'));
    assert.ok(card, 'Second Wind is in hand');
    const hpBefore = api.state.enemy.hp;
    pointer(card, 'pointerdown', { x: 400, y: 700 });
    pointer(window, 'pointermove', { x: 400, y: 560 });
    pointer(window, 'pointerup', { x: 400, y: 560 });
    assert.equal(api.state.enemy.hp, hpBefore, 'rejected card deals no damage');
    assert.equal($$('.hand-card', container).length, 5, 'rejected card stays in hand');
    assert.match($('.combat-notice', container).textContent, /Not enough Action/);
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

test('dragged in quick succession: two different cards both play', () => {
  const { api, container } = mount();
  try {
    const before = api.state.enemy.hp;
    dragCard(container, 0, 400, 700, 400, 560);
    assert.equal(api.state.enemy.hp, before - 3);
    // The hand re-rendered; immediately drag the card now at index 0.
    // Same index, new generation — must NOT be swallowed by the debounce.
    dragCard(container, 0, 400, 700, 400, 560);
    assert.equal(api.state.enemy.hp, before - 6);
  } finally {
    api.destroy();
  }
});

test('dragged twice quickly: one failing card is attempted once', () => {
  const { api, container } = mount();
  try {
    // Force Second Wind to the front of the hand so no draw luck is needed.
    api.state.player.hand = ['second-wind', 'basic-strike', 'basic-strike', 'basic-strike', 'basic-strike'];
    api.state.player.action = 0;
    api.render();
    const hpBefore = api.state.enemy.hp;
    dragCard(container, 0, 400, 700, 400, 560);
    dragCard(container, 0, 400, 700, 400, 560);
    assert.equal(api.state.enemy.hp, hpBefore, 'failed card deals no damage twice');
    assert.equal($$('.hand-card', container).length, 5, 'failed card stays in hand');
    assert.equal($$('.hand-card.shake', container).length, 1, 'exactly one shake');
  } finally {
    api.destroy();
  }
});

test('layout: original-style combat arrangement', () => {
  const { api, container } = mount();
  try {
    // Top bar: blessing circles, gold, back arrow.
    assert.ok($('.combat-topbar', container), 'top bar exists');
    assert.equal($$('.blessing-dot', container).length, 3, '3 empty blessing outlines');
    assert.ok($('.topbar-gold .gold-num', container), 'gold lives in the top bar');
    assert.equal($('.topbar-gold .gold-num', container).textContent, '23');
    assert.ok($('.topbar-back', container), 'back arrow exists');
    // Enemy: ribbon name + Lv, HP bar, thin blue bar + hourglass.
    assert.ok($('.enemy-name', container), 'enemy name ribbon exists');
    assert.match($('.enemy-name', container).textContent, /Thorn Wolf/);
    assert.ok($('.lv-tag', container), 'Lv tag on the ribbon');
    assert.ok($('.enemy-mana-row', container), 'thin blue bar row exists');
    assert.match($('.enemy-hourglass', container).textContent, /⏳ 0/);
    assert.ok($('.enemy-special', container), 'special-ability pill exists');
    // Player: End Turn immediately left of the portrait in DOM order.
    const playerArea = $('.player-area', container);
    assert.equal(playerArea.children[0].classList.contains('end-turn-btn'), true);
    assert.equal(playerArea.children[1].classList.contains('player-portrait-wrap'), true);
    // HUD bottom-centre: HP, Mana, Action — and no gold (gold is top bar).
    assert.ok($('.hud', container), 'HUD exists');
    assert.equal($('.hud .gold-num', container), null, 'no gold in the HUD');
    assert.equal($('.action-num', container).textContent, '2 / 2');
    // Equipment row above the HUD; deck/discard arches bottom-left.
    assert.ok($('.equip-row', container), 'equipment row exists');
    assert.equal($$('.pile-arch', container).length, 2, 'two pile arches');
    assert.equal($$('.pile-arch .pile-label', container)[0].textContent, 'Deck');
    assert.equal($$('.pile-arch .pile-label', container)[1].textContent, 'Discard');
    assert.equal($$('.pile-arch .pile-num', container)[0].textContent, '5',
      'deck count: 10-card deck minus 5 drawn');
    assert.equal($$('.pile-arch .pile-num', container)[1].textContent, '0',
      'discard count: nothing discarded yet');
    // Log: collapsible on the left edge, collapsed by default.
    assert.ok($('.combat-log', container), 'log panel exists');
    assert.equal($('.combat-log', container).classList.contains('collapsed'), true);
    assert.ok($('.log-toggle', container), 'log toggle exists');
    assert.ok($('.combat-notice', container), 'notice strip exists');
  } finally {
    api.destroy();
  }
});

// --- Preview wiring + cache-busting (retest finding 2026-11-07) -----------
import { readFileSync } from 'node:fs';

test('preview wiring: the real index.html styles the preview and busts the JS cache', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // The preview box must have size even before its image loads.
  assert.match(html, /#card-preview\{[^}]*aspect-ratio:\s*342\s*\/\s*519/);
  assert.match(html, /#card-preview\{[^}]*background:#1a1426/);
  assert.match(html, /#card-preview\.show\{[^}]*opacity:\s*1/);
  // Every module URL carries the same ?v= so a new release is a fresh
  // fetch (the missing-preview retest ran a cached pre-fix combat-ui.js).
  // The version itself lives in index.html; all imports must match it.
  const vMatch = html.match(/src="src\/main\.js\?v=([\d.]+)"/);
  assert.ok(vMatch, 'index.html loads main.js with a ?v= cache-buster');
  const version = vMatch[1];
  for (const src of ['src/main.js', 'src/book.js', 'src/combat-ui.js', 'src/engine.js']) {
    const js = readFileSync(new URL(`../${src}`, import.meta.url), 'utf8');
    for (const line of js.split('\n')) {
      if (!line.trimStart().startsWith('import ')) continue; // skip comments
      for (const m of line.matchAll(/from\s+'(\.\/[^']+)'/g)) {
        assert.ok(m[1].endsWith(`?v=${version}`), `${src} imports ${m[1]} without the cache-buster`);
      }
    }
  }
});

test('preview wiring: the mounted preview is a real img with the card art', () => {
  const { api, container } = mount();
  try {
    const preview = container.querySelector('#card-preview');
    assert.ok(preview, 'preview element is in the DOM');
    assert.equal(preview.tagName, 'IMG');
    // jsdom has no layout, so check the wiring instead of pixels: hovering
    // a card must set the preview src and the show class (the browser
    // playtest must still confirm it is actually visible on screen).
    const first = $$('.hand-card', container)[0];
    first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    assert.equal(preview.classList.contains('show'), true);
    assert.ok(preview.src.includes('basic-strike'));
  } finally {
    api.destroy();
  }
});

// --- Playtest fixes v0.5.1: tap pins preview, empty equip slots ----------
test('tap pins preview: stays after pointerup and mouseout, second tap hides it', () => {
  const { api, container } = mount();
  try {
    const preview = container.querySelector('#card-preview');
    const first = $$('.hand-card', container)[0];
    const down = new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 7, clientX: 100, clientY: 900 });
    const up = new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 7, clientX: 100, clientY: 900 });
    first.dispatchEvent(down);
    window.dispatchEvent(up);
    assert.equal(preview.classList.contains('show'), true, 'tap shows the preview');
    assert.equal(api.state.enemy.hp, 20, 'tap does not play the card');
    // Pointer leaves the hand: a tap-pinned preview must stay.
    first.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    assert.equal(preview.classList.contains('show'), true, 'pinned preview survives mouseout');
    // Tap the same card again: dismisses it.
    first.dispatchEvent(down);
    window.dispatchEvent(up);
    assert.equal(preview.classList.contains('show'), false, 'second tap hides the preview');
  } finally {
    api.destroy();
  }
});

test('equipment row: free slots render as empty circles before anything is equipped', () => {
  const { api, container } = mount();
  try {
    assert.equal($$('.equip-chip.empty', container).length, 1, 'one empty slot circle at start');
    assert.ok($('.equip-empty', container).textContent.includes('No equipment yet'));
    assert.ok($('.equip-slots', container).textContent.includes('Slots: 0/1'));
  } finally {
    api.destroy();
  }
});
