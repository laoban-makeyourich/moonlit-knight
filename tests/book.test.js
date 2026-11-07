// Moonlit Knight — book / chapter flow tests (Stage 3).
// Run: node --test tests/book.test.js
//
// Headless DOM via jsdom, installed dev-only into /tmp/mk-test (NOT
// committed). Uses the rigged seams in src/book.js: `pagePlan` (exact pages
// dealt) and `combatStarter` (a fake combat that wins on a timer) so no test
// depends on playing full real battles — except the blessing and death-retry
// tests, which drive the real combat UI headlessly.

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

const { startRun } = await import('../src/book.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const $ = (sel, root) => root.querySelector(sel);
const $$ = (sel, root) => [...root.querySelectorAll(sel)];

function mount(opts = {}) {
  const container = document.getElementById('game-screen');
  let exited = false;
  const api = startRun(container, {
    seed: 42,
    pagePlan: opts.pagePlan,
    combatStarter: opts.combatStarter,
    onExit: () => { exited = true; },
  });
  return { api, container, wasExited: () => exited };
}

function clickPageCard(container, kind) {
  const card = $(`.page-card[data-kind="${kind}"]`, container);
  assert.ok(card, `a ${kind} page card should be on screen`);
  card.click();
}

function clickButtonByText(container, text) {
  const btn = $$('.modal-panel .btn', container).find((b) => b.textContent.includes(text));
  assert.ok(btn, `a button containing "${text}" should be on screen`);
  btn.click();
}

// Fake combat: wins on a timer with a fixed end-of-fight state, so the book
// flow (level-up, next chapter, victory) can be driven without playing.
function fakeCombat({ turn = 5, hp = 18, gold = 40 } = {}) {
  return (_container, o) => {
    setTimeout(() => o.onVictory({ turn, player: { hp, gold } }), 0);
    return { destroy() {}, state: {} };
  };
}

// ---------------------------------------------------------------------------
// Chapter screen + page picking
// ---------------------------------------------------------------------------

test('run starts at Chapter I with 3 pages and pagesRemaining 6', () => {
  const { api, container } = mount({
    pagePlan: [[{ kind: 'monster', monsterId: 'thorn-wolf' }, 'shop', 'fairy']],
  });
  try {
    assert.equal(api.run.chapterIndex, 0);
    assert.equal(api.run.pagesRemaining, 6);
    assert.equal(api.run.gold, 23);
    assert.equal(api.run.hp, 30);
    assert.equal(api.run.maxHp, 30);
    assert.equal(api.run.deck.length, 8);
    assert.deepEqual(api.run.blessings, []);
    assert.equal($('.book-chapter', container).textContent, 'Chapter I — Village');
    assert.equal($('.book-pages-left', container).textContent, 'Pages remaining: 6');
    assert.equal($('.book-gold', container).textContent, '🪙 23');
    assert.equal($$('.page-card', container).length, 3);
  } finally {
    api.destroy();
  }
});

test('picking a page decrements the counter and shows 3 new pages', () => {
  const { api, container } = mount({
    pagePlan: [['spring', 'chest', 'shop'], ['fairy', 'smithy', 'chest']],
  });
  try {
    api.run.hp = 10;
    clickPageCard(container, 'spring');
    assert.equal($('.modal-title', container).textContent, 'Healing Spring');
    clickButtonByText(container, 'Rest');
    assert.equal(api.run.hp, 30); // full heal
    assert.equal(api.run.pagesRemaining, 5);
    assert.equal($('.book-pages-left', container).textContent, 'Pages remaining: 5');
    assert.equal($$('.page-card', container).length, 3);
    assert.equal($('.book-modal', container).classList.contains('hidden'), true);
  } finally {
    api.destroy();
  }
});

test('chest: taking gold adds 30 and resolves the page', () => {
  const { api, container } = mount({
    pagePlan: [['chest', 'spring', 'shop'], ['fairy', 'smithy', 'spring']],
  });
  try {
    clickPageCard(container, 'chest');
    assert.equal($('.modal-title', container).textContent, 'Treasure Chest');
    clickButtonByText(container, 'Gold');
    assert.equal(api.run.gold, 53); // 23 + 30
    assert.equal(api.run.pagesRemaining, 5);
    assert.equal($$('.page-card', container).length, 3);
  } finally {
    api.destroy();
  }
});

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

test('shop: purchase deducts gold and adds the card; unaffordable is refused; refresh costs 1', () => {
  const { api, container } = mount({
    pagePlan: [['shop', 'spring', 'chest'], ['fairy', 'smithy', 'spring']],
  });
  try {
    clickPageCard(container, 'shop');
    assert.equal($('.modal-title', container).textContent, 'The Crow Shop');
    const cards = $$('.shop-card', container);
    assert.equal(cards.length, 3);
    assert.deepEqual(cards.map((c) => c.dataset.price), ['40', '50', '65']);

    api.run.gold = 45;
    const firstId = cards[0].dataset.cardId;
    cards[0].click(); // 40 gold: affordable
    assert.equal(api.run.gold, 5);
    assert.equal(api.run.deck.length, 9);
    assert.ok(api.run.deck.includes(firstId));
    assert.equal($('.shop-card.sold', container).dataset.cardId, firstId);

    const second = $$('.shop-card', container)[1];
    second.click(); // 50 gold: unaffordable at 5
    assert.equal(api.run.gold, 5);
    assert.equal(api.run.deck.length, 9);
    assert.match($('.modal-notice', container).textContent, /Not enough gold/);

    clickButtonByText(container, 'Refresh');
    assert.equal(api.run.gold, 4); // refresh costs 1
    assert.equal($$('.shop-card', container).length, 3);
    assert.equal($$('.shop-card.sold', container).length, 0);

    clickButtonByText(container, 'Leave');
    assert.equal($('.book-modal', container).classList.contains('hidden'), true);
    assert.equal(api.run.pagesRemaining, 5);
    assert.equal($$('.page-card', container).length, 3);
  } finally {
    api.destroy();
  }
});

// ---------------------------------------------------------------------------
// Fairy blessing (recorded, and it works in a real fight)
// ---------------------------------------------------------------------------

test('blessing pick is recorded and affects combat: Mini Rake doubles Armor', () => {
  const { api, container } = mount({
    pagePlan: [
      ['fairy', 'spring', 'chest'],
      [{ kind: 'monster', monsterId: 'thorn-wolf' }, 'shop', 'spring'],
    ],
  });
  try {
    clickPageCard(container, 'fairy');
    const rakeBtn = $('.blessing-btn[data-blessing="mini-rake"]', container);
    assert.ok(rakeBtn, 'Mini Rake should be offered');
    rakeBtn.click();
    assert.deepEqual(api.run.blessings, ['mini-rake']);
    assert.equal(api.run.pagesRemaining, 5);

    // The next deal is a real Thorn Wolf fight; Mini Rake must apply there.
    clickPageCard(container, 'monster');
    const combat = api.combat;
    assert.ok(combat, 'a real combat should be mounted');
    assert.equal(combat.state.player.hp, 30); // entered with run HP
    assert.deepEqual(combat.state.player.blessings, ['mini-rake']);
    combat.state.player.hand = ['iron-thorn'];
    assert.equal(combat.playHandIndex(0).ok, true);
    assert.equal(combat.state.player.armor, 6); // 3 doubled
    assert.equal(combat.state.enemy.hp, 11); // damage is not doubled
  } finally {
    api.destroy();
  }
});

// ---------------------------------------------------------------------------
// Smithy
// ---------------------------------------------------------------------------

test('smithy: first upgrade per chapter is free, the second costs 10 gold', () => {
  const { api, container } = mount({
    pagePlan: [['smithy', 'spring', 'chest'], ['smithy', 'spring', 'chest']],
  });
  try {
    api.run.gold = 25;
    clickPageCard(container, 'smithy');
    assert.equal($('.modal-title', container).textContent, 'The Smithy');
    const row = $('.smithy-row[data-card-id="basic-strike"]', container);
    assert.ok(row, 'Basic Strike should be listed');
    assert.equal($('.smithy-cost', row).textContent, 'Free');
    row.click();
    assert.deepEqual(api.run.upgrades, { 'basic-strike': 1 });
    assert.equal(api.run.gold, 25); // free
    assert.equal(api.run.smithyFreeUsedThisChapter, true);

    clickButtonByText(container, 'Leave');
    assert.equal(api.run.pagesRemaining, 5);
    clickPageCard(container, 'smithy');
    const row2 = $('.smithy-row[data-card-id="basic-strike"]', container);
    assert.equal($('.smithy-cost', row2).textContent, '10 🪙');
    assert.match($('.smithy-name', row2).textContent, /\(\+1\)/);
    row2.click();
    assert.deepEqual(api.run.upgrades, { 'basic-strike': 2 });
    assert.equal(api.run.gold, 15); // 25 - 10
  } finally {
    api.destroy();
  }
});

test('smithy: Counter cards are disabled with a note and cannot be upgraded', () => {
  const { api, container } = mount({
    pagePlan: [['smithy', 'spring', 'chest']],
  });
  try {
    api.run.gold = 25;
    api.run.deck.push('parry'); // Counter card — no smithy effect
    clickPageCard(container, 'smithy');
    const row = $('.smithy-row[data-card-id="parry"]', container);
    assert.ok(row, 'Parry should be listed');
    assert.equal(row.disabled, true);
    assert.match($('.smithy-note', row).textContent, /Counter cards cannot be upgraded/);
    row.click(); // disabled: must not spend gold or add an upgrade
    assert.deepEqual(api.run.upgrades, {});
    assert.equal(api.run.gold, 25);
    // A normal card in the same smithy still upgrades for free.
    const strike = $('.smithy-row[data-card-id="basic-strike"]', container);
    assert.equal(strike.disabled, false);
    strike.click();
    assert.deepEqual(api.run.upgrades, { 'basic-strike': 1 });
  } finally {
    api.destroy();
  }
});

// ---------------------------------------------------------------------------
// Boss page, wins, level-up, chapters, victory
// ---------------------------------------------------------------------------

test('boss page appears when pagesRemaining hits 0', () => {
  const { api, container } = mount({
    pagePlan: [['spring', 'chest', 'shop'], ['spring', 'chest', 'shop']],
  });
  try {
    api.run.pagesRemaining = 1;
    api.render();
    clickPageCard(container, 'spring');
    clickButtonByText(container, 'Rest');
    assert.equal(api.run.pagesRemaining, 0);
    const cards = $$('.page-card', container);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].dataset.kind, 'boss');
    assert.equal(cards[0].dataset.monsterId, 'rat-king');
    assert.match($('.page-title', cards[0]).textContent, /Rat King/);
  } finally {
    api.destroy();
  }
});

test('battle win: +10 gold, level-up, then back to the chapter screen', async () => {
  const { api, container } = mount({
    pagePlan: [
      [{ kind: 'monster', monsterId: 'thorn-wolf' }, 'shop', 'fairy'],
      ['chest', 'spring', 'smithy'],
    ],
    combatStarter: fakeCombat({ turn: 3, hp: 18, gold: 40 }),
  });
  try {
    clickPageCard(container, 'monster');
    await sleep(50); // fake combat wins on a timer
    assert.equal($('.modal-title', container).textContent, 'Level Up!');
    assert.equal($$('.levelup-option', container).length, 2);
    assert.equal(api.run.wins, 1);
    assert.equal(api.run.hp, 18); // damage taken persists
    assert.equal(api.run.turns, 3);
    assert.equal(api.run.gold, 50); // 40 + 10 battle gold

    $$('.levelup-option', container)[0].click();
    assert.equal(api.run.pagesRemaining, 5);
    assert.equal($$('.page-card', container).length, 3);
    assert.equal($('.book-modal', container).classList.contains('hidden'), true);
  } finally {
    api.destroy();
  }
});

test('boss win advances to the next chapter with fresh pages', async () => {
  const { api, container } = mount({
    combatStarter: fakeCombat({ turn: 4, hp: 22, gold: 40 }),
  });
  try {
    api.run.pagesRemaining = 0;
    api.render();
    clickPageCard(container, 'boss');
    await sleep(50);
    assert.equal($('.modal-title', container).textContent, 'Level Up!');
    assert.equal(api.run.gold, 70); // 40 + 30 boss gold
    $$('.levelup-option', container)[0].click();
    assert.equal(api.run.chapterIndex, 1);
    assert.equal(api.run.pagesRemaining, 8);
    assert.equal(api.run.smithyFreeUsedThisChapter, false);
    assert.equal($('.book-chapter', container).textContent, 'Chapter II — Forest');
    assert.equal($$('.page-card', container).length, 3);
  } finally {
    api.destroy();
  }
});

test('death retry restores full HP for the same battle', async () => {
  const { api, container } = mount({
    pagePlan: [[{ kind: 'monster', monsterId: 'thorn-wolf' }, 'shop', 'fairy']],
  });
  try {
    api.run.hp = 12;
    clickPageCard(container, 'monster');
    const combat = api.combat;
    assert.ok(combat, 'a real combat should be mounted');
    assert.equal($('.hud-hp .bar-text', container).textContent, '12 / 30');

    combat.state.player.hp = 1;
    $('.end-turn-btn', container).click(); // Thorn Wolf Bite 7 -> dead
    assert.equal(combat.state.phase, 'lost');
    await sleep(800); // defeat overlay appears after a 650ms delay
    assert.equal($('.overlay-title', container).textContent, 'Defeated…');
    const [retryBtn, titleBtn] = $$('.overlay-btns .btn', container);
    assert.equal(retryBtn.textContent, 'Retry Battle');
    assert.equal(titleBtn.textContent, 'Title');

    retryBtn.click();
    await sleep(50);
    const retryCombat = api.combat;
    assert.ok(retryCombat, 'a fresh combat should be mounted after retry');
    assert.notEqual(retryCombat, combat);
    assert.equal($('.hud-hp .bar-text', container).textContent, '30 / 30');
    assert.equal(api.run.hp, 30);
    assert.equal(retryCombat.state.player.hp, 30);
  } finally {
    api.destroy();
  }
});

test('victory screen appears after beating the Grave Witch, and Play Again restarts the run', async () => {
  const { api, container } = mount({
    combatStarter: fakeCombat({ turn: 5, hp: 18, gold: 40 }),
  });
  try {
    api.run.chapterIndex = 2;
    api.run.pagesRemaining = 0;
    api.render();
    clickPageCard(container, 'boss');
    await sleep(50);
    assert.equal($('.modal-title', container).textContent, 'Level Up!');
    $$('.levelup-option', container)[0].click();
    await sleep(20);
    assert.equal($('.modal-title', container).textContent, 'The book closes.');
    const stats = $('.victory-stats', container).textContent;
    assert.match(stats, /Chapters cleared: 3/);
    assert.match(stats, /Battles won: 1/);
    assert.match(stats, /Turns played: 5/);
    assert.match(stats, /Gold left: (70|90)/); // 40 + 30 boss gold (+20 if the level-up was gold)

    clickButtonByText(container, 'Play Again');
    assert.equal(api.run.chapterIndex, 0);
    assert.equal(api.run.pagesRemaining, 6);
    assert.equal(api.run.gold, 23);
    assert.equal(api.run.hp, 30);
    assert.equal(api.run.deck.length, 8);
    assert.deepEqual(api.run.blessings, []);
    assert.equal($('.book-chapter', container).textContent, 'Chapter I — Village');
    assert.equal($$('.page-card', container).length, 3);
  } finally {
    api.destroy();
  }
});
