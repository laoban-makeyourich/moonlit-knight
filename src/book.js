// Moonlit Knight — book / chapter flow (Stage 3).
// Turns the single Stage 2 fight into a full 3-chapter run: page cards,
// monster battles, shop, fairy blessings, chest, spring, smithy, level-ups,
// chapter bosses, and a victory screen. Pure run logic is exported for the
// node tests; startRun() is the DOM controller (jsdom-safe: it touches
// `document` only inside functions, never at module top level).
//
// Usage (browser):  import { startRun } from './book.js';
//   const run = startRun(document.getElementById('game-screen'),
//     { onExit: () => { /* back to title */ } });
//   run.destroy() removes the book DOM. run.run is the live run object.
//
// Run state (one object across chapters; HP persists between battles):
//   { deck, gold, hp, maxHp, actionCap, equipSlots, blessings, upgrades,
//     chapterIndex, pagesRemaining, smithyFreeUsedThisChapter, wins, turns }
//
// Test seams (opts): `rng` / `seed` for deterministic deals, `pagePlan`
// (a queue of page arrays dealt instead of random ones), `combatStarter`
// (defaults to the real startCombat from combat-ui.js).

import { startCombat } from './combat-ui.js';
import { CARDS, getCard, STARTER_DECK } from './cards.js';
import { getMonster } from './monsters.js';
import { CONFIG } from './engine.js';
import { mulberry32, shuffle } from './rng.js';

const CARDBACK = 'assets/ui/cardback.jpg';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export const CHAPTERS = [
  { name: 'Chapter I — Village', bg: 'assets/ui/bg-village.jpg', pages: 6,
    boss: 'rat-king', pool: ['thorn-wolf', 'mire-wisp', 'hollow-stag'] },
  { name: 'Chapter II — Forest', bg: 'assets/ui/bg-forest.jpg', pages: 8,
    boss: 'mire-crocodile', pool: ['rat-king', 'hollow-stag', 'mire-wisp', 'thorn-wolf'] },
  { name: 'Chapter III — Graveyard', bg: 'assets/ui/bg-graveyard.jpg', pages: 8,
    boss: 'grave-witch', pool: ['rat-king', 'mire-wisp', 'hollow-stag', 'thorn-wolf'] },
];

export const BLESSINGS = [
  { id: 'ember-artillery', name: 'Ember Artillery',
    text: 'Deal 6 fire damage whenever you equip an Equipment card.' },
  { id: 'battle-trumpet', name: 'Battle Trumpet',
    text: 'Basic Strike deals +2 damage.' },
  { id: 'mini-rake', name: 'Mini Rake',
    text: 'Armor gained is doubled.' },
];

export const SHOP_PRICES = [40, 50, 65];
export const SMITHY_PAID_COST = 10;
export const BATTLE_GOLD = 10;
export const BOSS_GOLD = 30;
export const CHEST_GOLD = 30;

// Level-up options: exactly 2 distinct ones are drawn after every win.
export const LEVEL_UP_KINDS = [
  { kind: 'card', name: 'New Card', text: 'Add a random card to your deck.' },
  { kind: 'equip-slot', name: '+1 Equipment Slot',
    text: 'Equip one more Equipment card in battle.' },
  { kind: 'action', name: '+1 Action',
    text: 'Start each turn with 1 more Action.' },
  { kind: 'max-hp', name: '+6 Max HP',
    text: 'Raise your Max HP by 6 and heal 6 HP.' },
  { kind: 'gold', name: '+20 Gold', text: 'Gain 20 gold.' },
];

// ---------------------------------------------------------------------------
// Pure run logic (no DOM)
// ---------------------------------------------------------------------------

export function createRun() {
  return {
    deck: [...STARTER_DECK],
    gold: CONFIG.startGold,
    hp: CONFIG.playerStartHp,
    maxHp: CONFIG.playerStartHp,
    actionCap: CONFIG.actionCap,
    equipSlots: CONFIG.equipSlotsStart,
    blessings: [],
    upgrades: {},
    chapterIndex: 0,
    pagesRemaining: CHAPTERS[0].pages,
    smithyFreeUsedThisChapter: false,
    wins: 0,
    turns: 0,
  };
}

// Weighted page kinds: monsters dominate, events stay occasional.
const PAGE_WEIGHTS = [
  ['monster', 45], ['shop', 15], ['fairy', 12], ['chest', 12],
  ['spring', 8], ['smithy', 8],
];

function pickWeighted(rng) {
  const total = PAGE_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [kind, weight] of PAGE_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return kind;
  }
  return 'monster';
}

export function dealPages(run, rng = Math.random) {
  const chapter = CHAPTERS[run.chapterIndex];
  const pages = [];
  for (let i = 0; i < 3; i += 1) {
    const kind = pickWeighted(rng);
    if (kind === 'monster') {
      const pool = chapter.pool;
      pages.push({ kind: 'monster', monsterId: pool[Math.floor(rng() * pool.length)] });
    } else {
      pages.push({ kind });
    }
  }
  return pages;
}

// 3 random distinct cards, priced 40 / 50 / 65 gold in slot order.
export function rollShopStock(rng = Math.random) {
  const pool = shuffle(CARDS.map((c) => c.id), rng);
  return SHOP_PRICES.map((price, i) => ({ cardId: pool[i], price }));
}

export function drawLevelUpOptions(rng = Math.random) {
  const kinds = shuffle([...LEVEL_UP_KINDS], rng).slice(0, 2);
  return kinds.map((k) => (k.kind === 'card'
    ? { ...k, cardId: CARDS[Math.floor(rng() * CARDS.length)].id }
    : { ...k }));
}

export function applyLevelUpOption(run, option) {
  switch (option.kind) {
    case 'card':
      run.deck.push(option.cardId);
      break;
    case 'equip-slot':
      run.equipSlots += 1;
      break;
    case 'action':
      run.actionCap += 1;
      break;
    case 'max-hp':
      run.maxHp += 6;
      run.hp = Math.min(run.maxHp, run.hp + 6);
      break;
    case 'gold':
      run.gold += 20;
      break;
    default:
      break;
  }
}

// First smithy upgrade each chapter is free; later ones cost 10 gold each.
export function applySmithyUpgrade(run, cardId) {
  const cost = run.smithyFreeUsedThisChapter ? SMITHY_PAID_COST : 0;
  if (run.gold < cost) return { ok: false, reason: 'no-gold', cost };
  run.gold -= cost;
  run.smithyFreeUsedThisChapter = true;
  run.upgrades[cardId] = (run.upgrades[cardId] || 0) + 1;
  return { ok: true, cost };
}

// ---------------------------------------------------------------------------
// Small DOM helpers (same conventions as combat-ui.js)
// ---------------------------------------------------------------------------

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function debounce(fn, wait = 350) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last < wait) return;
    last = now;
    fn(...args);
  };
}

let bannerTimer = 0;
function showBanner(text, ms = 1400) {
  if (typeof window !== 'undefined' && window.MoonlitKnight
      && typeof window.MoonlitKnight.showBanner === 'function') {
    window.MoonlitKnight.showBanner(text, ms);
    return;
  }
  const banner = document.getElementById('banner');
  if (!banner) return;
  banner.textContent = text;
  banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove('show'), ms);
}

// Image with a one-shot fallback to the card back (never loops).
function imgWithFallback(src, alt) {
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || '';
  img.draggable = false;
  img.addEventListener('error', () => {
    if (img.dataset.fallback) return;
    img.dataset.fallback = '1';
    img.src = CARDBACK;
  });
  return img;
}

// ---------------------------------------------------------------------------
// Book controller
// ---------------------------------------------------------------------------

export function startRun(container, opts = {}) {
  const rng = opts.rng || (opts.seed !== undefined ? mulberry32(opts.seed) : Math.random);
  const combatStarter = typeof opts.combatStarter === 'function' ? opts.combatStarter : startCombat;
  const onExit = typeof opts.onExit === 'function' ? opts.onExit : null;
  // Test seam: a queue of page arrays dealt instead of random pages.
  const pagePlan = Array.isArray(opts.pagePlan)
    ? opts.pagePlan.map((entry) => entry.map((p) => (typeof p === 'string' ? { kind: p } : p)))
    : null;

  const run = createRun();
  let currentCombat = null;
  let pendingBoss = false; // the win just resolved was a chapter boss

  // --- Book root ------------------------------------------------------------
  const old = container.querySelector('#book-root');
  if (old) old.remove();

  const root = el('div');
  root.id = 'book-root';
  container.appendChild(root);

  const bgImg = imgWithFallback(CHAPTERS[0].bg, '');
  bgImg.className = 'book-bg';
  root.appendChild(bgImg);

  const topbar = el('div', 'book-topbar');
  const hpSpan = el('span', 'book-hp');
  const goldSpan = el('span', 'book-gold');
  const chapterSpan = el('span', 'book-chapter');
  const pagesSpan = el('span', 'book-pages-left');
  topbar.appendChild(hpSpan);
  topbar.appendChild(goldSpan);
  topbar.appendChild(chapterSpan);
  topbar.appendChild(pagesSpan);
  root.appendChild(topbar);

  const pagesEl = el('div', 'book-pages');
  root.appendChild(pagesEl);

  const hintEl = el('div', 'book-hint', 'Turn a page to continue the story.');
  root.appendChild(hintEl);

  // --- Modal (shared by shop / events / smithy / level-up / victory) --------
  const modal = el('div', 'book-modal hidden');
  const panel = el('div', 'modal-panel');
  modal.appendChild(panel);
  root.appendChild(modal);

  function updateTopbar() {
    const chapter = CHAPTERS[run.chapterIndex];
    hpSpan.textContent = `❤ ${run.hp} / ${run.maxHp}`;
    goldSpan.textContent = `🪙 ${run.gold}`;
    chapterSpan.textContent = chapter.name;
    pagesSpan.textContent = `Pages remaining: ${run.pagesRemaining}`;
  }

  function openModal() {
    panel.innerHTML = '';
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
    panel.innerHTML = '';
  }

  function modalNotice(msg) {
    let notice = panel.querySelector('.modal-notice');
    if (!notice) {
      notice = el('div', 'modal-notice');
      panel.appendChild(notice);
    }
    notice.textContent = msg || '';
  }

  // --- Page dealing / chapter screen ----------------------------------------

  function nextPages() {
    if (pagePlan && pagePlan.length > 0) return pagePlan.shift();
    return dealPages(run, rng);
  }

  function pageArt(page) {
    if (page.kind === 'monster') return `assets/monsters/${page.monsterId}.jpg`;
    if (page.kind === 'boss') return `assets/monsters/${page.monsterId}.jpg`;
    if (page.kind === 'shop') return 'assets/ui/shop-stall.jpg';
    if (page.kind === 'fairy') return 'assets/ui/event-fairy.jpg';
    if (page.kind === 'chest') return 'assets/ui/event-chest.jpg';
    if (page.kind === 'spring') return 'assets/ui/event-spring.jpg';
    if (page.kind === 'smithy') return 'assets/ui/event-smithy.jpg';
    return CARDBACK;
  }

  function pageTitle(page) {
    if (page.kind === 'monster') return getMonster(page.monsterId).name;
    if (page.kind === 'boss') return getMonster(page.monsterId).name;
    if (page.kind === 'shop') return 'The Crow Shop';
    if (page.kind === 'fairy') return 'Fairy Blessing';
    if (page.kind === 'chest') return 'Treasure Chest';
    if (page.kind === 'spring') return 'Healing Spring';
    if (page.kind === 'smithy') return 'The Smithy';
    return 'Page';
  }

  function pageSubtitle(page) {
    if (page.kind === 'monster') {
      const m = getMonster(page.monsterId);
      return `Battle · ${m.hp} HP`;
    }
    if (page.kind === 'boss') return 'BOSS — turn this page to face it';
    if (page.kind === 'shop') return 'Buy cards from the crow merchant';
    if (page.kind === 'fairy') return 'Choose one blessing for the run';
    if (page.kind === 'chest') return 'Gold, or a random card?';
    if (page.kind === 'spring') return 'Restore all HP';
    if (page.kind === 'smithy') return 'Upgrade a card in your deck';
    return '';
  }

  function renderChapter() {
    const chapter = CHAPTERS[run.chapterIndex];
    bgImg.src = chapter.bg;
    bgImg.alt = chapter.name;
    updateTopbar();
    pagesEl.innerHTML = '';
    closeModal();
    let pages;
    if (run.pagesRemaining <= 0) {
      pages = [{ kind: 'boss', monsterId: chapter.boss }];
      hintEl.textContent = 'The chapter boss waits on the last page.';
    } else {
      pages = nextPages();
      hintEl.textContent = 'Turn a page to continue the story.';
    }
    for (const page of pages) {
      const card = el('button', 'page-card');
      card.type = 'button';
      card.dataset.kind = page.kind;
      if (page.monsterId) card.dataset.monsterId = page.monsterId;
      if (page.kind === 'boss') card.classList.add('boss');
      const art = imgWithFallback(pageArt(page), pageTitle(page));
      art.className = 'page-art';
      const title = el('div', 'page-title', pageTitle(page));
      const sub = el('div', 'page-sub', pageSubtitle(page));
      card.appendChild(art);
      card.appendChild(title);
      card.appendChild(sub);
      card.addEventListener('click', debounce(() => onPagePick(page), 350));
      pagesEl.appendChild(card);
    }
  }

  // --- Page resolution -------------------------------------------------------

  function onPagePick(page) {
    if (page.kind === 'boss') {
      startBattle(page.monsterId);
      return;
    }
    run.pagesRemaining = Math.max(0, run.pagesRemaining - 1);
    updateTopbar();
    if (page.kind === 'monster') {
      startBattle(page.monsterId);
      return;
    }
    if (page.kind === 'shop') return openShop();
    if (page.kind === 'fairy') return openFairy();
    if (page.kind === 'chest') return openChest();
    if (page.kind === 'spring') return openSpring();
    if (page.kind === 'smithy') return openSmithy();
  }

  // After a panel closes (or a level-up is picked), show the next pages —
  // or the boss page when the chapter's pages are spent.
  function afterPageResolved() {
    closeModal();
    renderChapter();
  }

  function leaveButton(label = 'Leave') {
    const btn = el('button', 'btn secondary', label);
    btn.type = 'button';
    btn.addEventListener('click', debounce(() => afterPageResolved(), 350));
    return btn;
  }

  // --- Shop ------------------------------------------------------------------

  function openShop() {
    let stock = rollShopStock(rng);
    const bought = new Set();
    openModal();

    function renderShop() {
      panel.innerHTML = '';
      const art = imgWithFallback('assets/ui/shop-merchant.jpg', 'The crow merchant');
      art.className = 'modal-art';
      panel.appendChild(art);
      panel.appendChild(el('div', 'modal-title', 'The Crow Shop'));
      panel.appendChild(el('div', 'modal-text',
        `Gold: ${run.gold} — the crow only takes gold, no haggling.`));
      const grid = el('div', 'shop-grid');
      stock.forEach((item, i) => {
        const card = getCard(item.cardId);
        const cell = el('button', 'shop-card');
        cell.type = 'button';
        cell.dataset.cardId = item.cardId;
        cell.dataset.price = String(item.price);
        if (bought.has(i)) cell.classList.add('sold');
        const img = imgWithFallback(`assets/cards/${item.cardId}.jpg`, card.name);
        img.className = 'shop-card-art';
        cell.appendChild(img);
        cell.appendChild(el('div', 'shop-card-name', card.name));
        cell.appendChild(el('div', 'shop-card-text', card.text));
        cell.appendChild(el('div', 'shop-card-price',
          bought.has(i) ? 'SOLD' : `${item.price} 🪙`));
        cell.addEventListener('click', debounce(() => {
          if (bought.has(i)) return;
          if (run.gold < item.price) {
            modalNotice('Not enough gold for that card.');
            return;
          }
          run.gold -= item.price;
          run.deck.push(item.cardId);
          bought.add(i);
          updateTopbar();
          showBanner(`${card.name} joins your deck!`);
          renderShop();
        }, 350));
        grid.appendChild(cell);
      });
      panel.appendChild(grid);
      const row = el('div', 'modal-row');
      const refreshBtn = el('button', 'btn secondary', 'Refresh — 1 🪙');
      refreshBtn.type = 'button';
      refreshBtn.addEventListener('click', debounce(() => {
        if (run.gold < 1) {
          modalNotice('Not enough gold to refresh.');
          return;
        }
        run.gold -= 1;
        stock = rollShopStock(rng);
        bought.clear();
        updateTopbar();
        renderShop();
      }, 350));
      row.appendChild(refreshBtn);
      row.appendChild(leaveButton());
      panel.appendChild(row);
      panel.appendChild(el('div', 'modal-notice'));
    }

    renderShop();
  }

  // --- Fairy blessing ----------------------------------------------------------

  function openFairy() {
    openModal();
    const art = imgWithFallback('assets/ui/event-fairy.jpg', 'A fairy in the moonlight');
    art.className = 'modal-art';
    panel.appendChild(art);
    panel.appendChild(el('div', 'modal-title', 'Fairy Blessing'));
    const available = BLESSINGS.filter((b) => !run.blessings.includes(b.id));
    if (available.length === 0) {
      panel.appendChild(el('div', 'modal-text',
        'The fairy smiles: you already carry all three blessings.'));
      panel.appendChild(leaveButton('Continue'));
      return;
    }
    panel.appendChild(el('div', 'modal-text', 'Choose one blessing. It lasts for the whole run.'));
    for (const blessing of BLESSINGS) {
      const owned = run.blessings.includes(blessing.id);
      const btn = el('button', 'blessing-btn');
      btn.type = 'button';
      btn.dataset.blessing = blessing.id;
      btn.disabled = owned;
      btn.appendChild(el('div', 'blessing-name', blessing.name + (owned ? ' — already yours' : '')));
      btn.appendChild(el('div', 'blessing-text', blessing.text));
      btn.addEventListener('click', debounce(() => {
        run.blessings.push(blessing.id);
        showBanner(`Blessing received: ${blessing.name}`);
        afterPageResolved();
      }, 350));
      panel.appendChild(btn);
    }
    panel.appendChild(leaveButton());
  }

  // --- Chest -------------------------------------------------------------------

  function openChest() {
    openModal();
    const art = imgWithFallback('assets/ui/event-chest.jpg', 'A treasure chest');
    art.className = 'modal-art';
    panel.appendChild(art);
    panel.appendChild(el('div', 'modal-title', 'Treasure Chest'));
    panel.appendChild(el('div', 'modal-text', 'The chest is unlocked. Take one:'));
    const row = el('div', 'modal-row');
    const goldBtn = el('button', 'btn', `+${CHEST_GOLD} Gold`);
    goldBtn.type = 'button';
    goldBtn.dataset.choice = 'gold';
    goldBtn.addEventListener('click', debounce(() => {
      run.gold += CHEST_GOLD;
      updateTopbar();
      showBanner(`+${CHEST_GOLD} gold!`);
      afterPageResolved();
    }, 350));
    const cardBtn = el('button', 'btn', 'Random Card');
    cardBtn.type = 'button';
    cardBtn.dataset.choice = 'card';
    cardBtn.addEventListener('click', debounce(() => {
      const card = CARDS[Math.floor(rng() * CARDS.length)];
      run.deck.push(card.id);
      showBanner(`${card.name} joins your deck!`);
      afterPageResolved();
    }, 350));
    row.appendChild(goldBtn);
    row.appendChild(cardBtn);
    panel.appendChild(row);
    panel.appendChild(leaveButton());
  }

  // --- Spring ------------------------------------------------------------------

  function openSpring() {
    openModal();
    const art = imgWithFallback('assets/ui/event-spring.jpg', 'A moonlit spring');
    art.className = 'modal-art';
    panel.appendChild(art);
    panel.appendChild(el('div', 'modal-title', 'Healing Spring'));
    panel.appendChild(el('div', 'modal-text',
      `The water glows faintly. Rest here to restore all HP (${run.hp} → ${run.maxHp}).`));
    const row = el('div', 'modal-row');
    const restBtn = el('button', 'btn', 'Rest — full heal');
    restBtn.type = 'button';
    restBtn.addEventListener('click', debounce(() => {
      run.hp = run.maxHp;
      updateTopbar();
      showBanner('Fully healed.');
      afterPageResolved();
    }, 350));
    row.appendChild(restBtn);
    row.appendChild(leaveButton('Leave'));
    panel.appendChild(row);
  }

  // --- Smithy ------------------------------------------------------------------

  function openSmithy() {
    openModal();

    function renderSmithy() {
      panel.innerHTML = '';
      const art = imgWithFallback('assets/ui/event-smithy.jpg', 'The smithy');
      art.className = 'modal-art';
      panel.appendChild(art);
      panel.appendChild(el('div', 'modal-title', 'The Smithy'));
      const firstFree = !run.smithyFreeUsedThisChapter;
      panel.appendChild(el('div', 'modal-text',
        firstFree
          ? 'The first upgrade this chapter is free. Later upgrades cost 10 gold each.'
          : 'Upgrades now cost 10 gold each (the free one is spent for this chapter).'));
      // One row per distinct card in the deck, with its count and level.
      const counts = new Map();
      for (const id of run.deck) counts.set(id, (counts.get(id) || 0) + 1);
      const list = el('div', 'smithy-list');
      for (const [id, count] of [...counts.entries()].sort()) {
        const card = getCard(id);
        const level = run.upgrades[id] || 0;
        const cost = firstFree ? 0 : SMITHY_PAID_COST;
        const row = el('button', 'smithy-row');
        row.type = 'button';
        row.dataset.cardId = id;
        row.dataset.cost = String(cost);
        const thumb = imgWithFallback(`assets/cards/${id}.jpg`, card.name);
        thumb.className = 'smithy-thumb';
        row.appendChild(thumb);
        row.appendChild(el('span', 'smithy-name',
          `${card.name} ×${count}${level > 0 ? `  (+${level})` : ''}`));
        row.appendChild(el('span', 'smithy-cost', cost === 0 ? 'Free' : `${cost} 🪙`));
        row.addEventListener('click', debounce(() => {
          const result = applySmithyUpgrade(run, id);
          if (!result.ok) {
            modalNotice('Not enough gold for that upgrade.');
            return;
          }
          updateTopbar();
          showBanner(`${card.name} upgraded! (+${run.upgrades[id]})`);
          renderSmithy();
        }, 350));
        list.appendChild(row);
      }
      panel.appendChild(list);
      panel.appendChild(leaveButton());
      panel.appendChild(el('div', 'modal-notice'));
    }

    renderSmithy();
  }

  // --- Level-up ------------------------------------------------------------------

  function showLevelUp() {
    const options = drawLevelUpOptions(rng);
    openModal();
    panel.appendChild(el('div', 'modal-title', 'Level Up!'));
    panel.appendChild(el('div', 'modal-text', 'The battle is won. Choose one reward:'));
    for (const option of options) {
      const btn = el('button', 'levelup-option');
      btn.type = 'button';
      btn.dataset.kind = option.kind;
      if (option.kind === 'card') {
        const card = getCard(option.cardId);
        const img = imgWithFallback(`assets/cards/${option.cardId}.jpg`, card.name);
        img.className = 'levelup-thumb';
        btn.appendChild(img);
        btn.appendChild(el('div', 'levelup-name', `${option.name}: ${card.name}`));
        btn.appendChild(el('div', 'levelup-text', card.text));
        btn.dataset.cardId = option.cardId;
      } else {
        btn.appendChild(el('div', 'levelup-name', option.name));
        btn.appendChild(el('div', 'levelup-text', option.text));
      }
      btn.addEventListener('click', debounce(() => {
        applyLevelUpOption(run, option);
        updateTopbar();
        closeModal();
        if (pendingBoss) {
          pendingBoss = false;
          advanceChapterOrVictory();
        } else {
          renderChapter();
        }
      }, 350));
      panel.appendChild(btn);
    }
  }

  function advanceChapterOrVictory() {
    if (run.chapterIndex >= CHAPTERS.length - 1) {
      showVictory();
      return;
    }
    run.chapterIndex += 1;
    run.pagesRemaining = CHAPTERS[run.chapterIndex].pages;
    run.smithyFreeUsedThisChapter = false;
    showBanner(CHAPTERS[run.chapterIndex].name);
    renderChapter();
  }

  function showVictory() {
    openModal();
    panel.appendChild(el('div', 'modal-title', 'The book closes.'));
    panel.appendChild(el('div', 'modal-text',
      'The Grave Witch is defeated, and the last page turns itself. The story is yours.'));
    const stats = el('div', 'victory-stats');
    stats.appendChild(el('div', 'victory-stat', `Chapters cleared: ${CHAPTERS.length}`));
    stats.appendChild(el('div', 'victory-stat', `Battles won: ${run.wins}`));
    stats.appendChild(el('div', 'victory-stat', `Turns played: ${run.turns}`));
    stats.appendChild(el('div', 'victory-stat', `Gold left: ${run.gold}`));
    panel.appendChild(stats);
    const againBtn = el('button', 'btn', 'Play Again');
    againBtn.type = 'button';
    againBtn.addEventListener('click', debounce(() => {
      restartRun();
    }, 350));
    panel.appendChild(againBtn);
  }

  function restartRun() {
    const fresh = createRun();
    for (const key of Object.keys(fresh)) run[key] = fresh[key];
    pendingBoss = false;
    showBanner('A new story begins…');
    renderChapter();
  }

  // --- Battles -------------------------------------------------------------------

  function startBattle(monsterId, { fullHp = false } = {}) {
    if (fullHp) run.hp = run.maxHp;
    root.classList.add('hidden');
    const combat = combatStarter(container, {
      monsterId,
      deckIds: [...run.deck],
      blessings: [...run.blessings],
      equipSlots: run.equipSlots,
      actionCap: run.actionCap,
      upgrades: { ...run.upgrades },
      startHp: run.hp,
      maxHp: run.maxHp,
      gold: run.gold,
      onExit: () => { teardownToTitle(); },
      onVictory: (combatState) => { handleVictory(monsterId, combatState); },
      onRetry: () => { retryBattle(monsterId); },
    });
    currentCombat = combat;
  }

  function handleVictory(monsterId, combatState) {
    const isBoss = CHAPTERS[run.chapterIndex].boss === monsterId;
    run.hp = Math.max(0, combatState.player.hp);
    run.gold = combatState.player.gold + (isBoss ? BOSS_GOLD : BATTLE_GOLD);
    run.wins += 1;
    run.turns += combatState.turn;
    pendingBoss = isBoss;
    if (currentCombat) {
      currentCombat.destroy();
      currentCombat = null;
    }
    root.classList.remove('hidden');
    updateTopbar();
    showLevelUp();
  }

  function retryBattle(monsterId) {
    // Death retry: the SAME battle, full HP, same deck and run modifiers.
    if (currentCombat) {
      currentCombat.destroy();
      currentCombat = null;
    }
    startBattle(monsterId, { fullHp: true });
  }

  function teardownToTitle() {
    if (currentCombat) {
      currentCombat.destroy();
      currentCombat = null;
    }
    destroy();
    if (onExit) onExit();
  }

  function destroy() {
    if (currentCombat) {
      currentCombat.destroy();
      currentCombat = null;
    }
    root.remove();
  }

  // Expose the live api for the caller / tests.
  const api = {
    run,
    render: renderChapter,
    destroy,
    get combat() { return currentCombat; },
    startBattle,
  };

  renderChapter();
  return api;
}
