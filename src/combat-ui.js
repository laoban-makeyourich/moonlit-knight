// Moonlit Knight — combat UI (Stage 2, layout + drag rework v0.5).
// DOM-only layer on top of the Stage 1 engine (src/engine.js).
// No framework, no build step. Animations are CSS transform/opacity only;
// JS timers are used solely for one-shot cleanup / banner timing.
//
// Layout follows the original game's combat screen (verified from real
// Knight gameplay video, 2026-11-07): top bar with blessing circles, gold
// and a back arrow; big enemy portrait top-centre with a name/Lv ribbon,
// red HP bar, thin blue bar + hourglass; player portrait in an arch frame
// bottom-right with End Turn immediately left of it; HUD bottom-centre
// (HP / Mana / Action); equipment chips just above the HUD; deck/discard
// arches bottom-left (our own labels — the original's two arches are
// unlabeled in the footage); hand bottom-centre.
//
// Cards are played by DRAG AND DROP (Pointer Events): drag a card up toward
// the enemy and release. A tap (tiny, quick press) only enlarges the card
// in the centre preview so it can be read; it never plays.
//
// Usage (browser):  import { startCombat } from './combat-ui.js';
//   const combat = startCombat(document.getElementById('game-screen'),
//     { monsterId: 'thorn-wolf', onExit: () => { /* back to title */ } });
//   combat.destroy() removes the combat DOM. combat.state is the engine state.
//
// Options (Stage 3): onVictory(state) is called from the victory overlay's
// "Continue" button instead of exiting to the title; onRetry() is called
// from the defeat overlay's "Retry Battle" button instead of the built-in
// restart. Without them the Stage 2 behaviour is unchanged.
//
// The module is also importable headlessly (node + jsdom) for the smoke test:
// it touches `document` only inside functions, never at module top level.

import { createGame, playCard, endTurn, isGameOver } from './engine.js?v=0.6';
import { getCard, STARTER_DECK } from './cards.js?v=0.6';
import { getMonster } from './monsters.js?v=0.6';

const CARDBACK = 'assets/ui/cardback.jpg';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// Debounce helper: ignore repeated activations within `wait` ms.
function debounce(fn, wait = 350) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last < wait) return;
    last = now;
    fn(...args);
  };
}

// Show the wooden "Your Turn" banner. Prefer the Stage 0 helper on
// window.MoonlitKnight when present; fall back to toggling #banner directly.
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

const PLAY_DENIED = {
  'game-over': 'The battle is over.',
  'not-player-turn': 'Wait for your turn.',
  'bad-index': 'No such card.',
  'unknown-card': 'Unknown card.',
  'no-action': 'Not enough Action — end your turn or play a free card.',
  'no-mana': 'Not enough Mana — play a Mana card first.',
  'no-slot': 'No free equipment slot.',
};

// Blessing names for the top-bar gold circles. Duplicated from book.js
// (BLESSINGS) on purpose: book.js imports this module, so importing back
// would be circular.
const BLESSING_NAMES = {
  'ember-artillery': 'Ember Artillery',
  'battle-trumpet': 'Battle Trumpet',
  'mini-rake': 'Mini Rake',
};

// ---------------------------------------------------------------------------
// Playability — mirrors the engine's validation, without playing the card.
// ---------------------------------------------------------------------------

export function isPlayable(state, card) {
  if (!card || !state || state.phase !== 'player') return false;
  const p = state.player;
  if (card.type === 'Action') return p.action >= card.cost;
  if (card.type === 'Spell') return p.mana >= card.cost;
  if (card.type === 'Equipment') return p.equipment.length < p.equipSlots;
  return true; // Attack, Mana and Counter are free to play.
}

// ---------------------------------------------------------------------------
// Combat UI
// ---------------------------------------------------------------------------

export function startCombat(container, opts = {}) {
  const monsterId = opts.monsterId || 'thorn-wolf';
  const monster = getMonster(monsterId);
  if (!monster) throw new Error(`Unknown monster: ${monsterId}`);

  // Clear any previous combat (e.g. Fight Again / Retry) but keep #banner,
  // which lives in #game-screen next to the combat root.
  const old = container.querySelector('#combat-root');
  if (old) old.remove();

  const state = createGame(monsterId, opts.deckIds || STARTER_DECK, opts);
  const onExit = typeof opts.onExit === 'function' ? opts.onExit : null;
  // Stage 3: onVictory(state) replaces the placeholder "Next → title" when
  // the caller runs a book flow; onRetry() replaces the default full-HP
  // restart when the caller owns the retry (run state, full HP).
  const onVictory = typeof opts.onVictory === 'function' ? opts.onVictory : null;
  const onRetry = typeof opts.onRetry === 'function' ? opts.onRetry : null;

  const root = el('div');
  root.id = 'combat-root';
  container.appendChild(root);

  // --- Top bar (original layout): blessing circles, gold, back arrow ------
  const topbar = el('div', 'combat-topbar');
  const blessingDots = el('div', 'blessing-dots');
  topbar.appendChild(blessingDots);
  const topSpacer = el('div', 'topbar-spacer');
  topbar.appendChild(topSpacer);
  const topGold = el('div', 'topbar-gold');
  topGold.appendChild(el('span', null, '🪙'));
  const goldText = el('span', 'gold-num');
  topGold.appendChild(goldText);
  topbar.appendChild(topGold);
  const backBtn = el('button', 'topbar-back', '←');
  backBtn.type = 'button';
  backBtn.title = 'Quit battle — back to title';
  backBtn.addEventListener('click', debounce(() => exitToTitle(), 350));
  topbar.appendChild(backBtn);
  root.appendChild(topbar);

  // --- Enemy area (top-center) -------------------------------------------
  const enemyArea = el('div', 'enemy-area');
  const enemyPortraitWrap = el('div', 'enemy-portrait-wrap');
  const enemyImg = imgWithFallback(`assets/monsters/${monster.id}.jpg`, monster.name);
  enemyImg.className = 'enemy-portrait';
  enemyPortraitWrap.appendChild(enemyImg);
  const enemyFloats = el('div', 'float-layer');
  enemyPortraitWrap.appendChild(enemyFloats);
  const enemyName = el('div', 'enemy-name');
  const enemyNameText = el('span', null, monster.name);
  const enemyLv = el('span', 'lv-tag', monster.boss ? 'BOSS' : 'Lv 1');
  enemyName.appendChild(enemyNameText);
  enemyName.appendChild(document.createTextNode(' '));
  enemyName.appendChild(enemyLv);
  const enemyHpBar = el('div', 'bar hp-bar');
  const enemyHpFill = el('div', 'bar-fill hp-fill');
  const enemyHpText = el('span', 'bar-text');
  enemyHpBar.appendChild(enemyHpFill);
  enemyHpBar.appendChild(enemyHpText);
  // Thin blue bar + hourglass number under the enemy HP (original layout).
  // The number is the enemy's turn count (0 at the start, as in the
  // original's first frame); the bar itself is flavor, as before.
  const enemyManaRow = el('div', 'enemy-mana-row');
  const enemyManaBar = el('div', 'bar mana-bar thin');
  const enemyManaFill = el('div', 'bar-fill mana-fill');
  enemyManaFill.style.width = '60%';
  enemyManaBar.appendChild(enemyManaFill);
  const enemyHourglass = el('span', 'enemy-hourglass');
  enemyHourglass.title = 'Enemy turns taken';
  enemyManaRow.appendChild(enemyManaBar);
  enemyManaRow.appendChild(enemyHourglass);
  const enemySpecial = el('div', 'enemy-special', monster.special || '');
  enemyArea.appendChild(enemyPortraitWrap);
  enemyArea.appendChild(enemyName);
  enemyArea.appendChild(enemyHpBar);
  enemyArea.appendChild(enemyManaRow);
  enemyArea.appendChild(enemySpecial);
  root.appendChild(enemyArea);

  // --- Combat log: collapsible panel on the left edge -----------------------
  // Default collapsed so it never covers the deck/discard arches. The
  // notice line is a separate strip above the hand (always visible).
  const logPanel = el('div', 'combat-log collapsed');
  const logToggle = el('button', 'log-toggle', 'LOG');
  logToggle.type = 'button';
  logToggle.title = 'Show / hide the battle log';
  logToggle.addEventListener('click', () => logPanel.classList.toggle('collapsed'));
  const logTitle = el('div', 'log-title', 'Battle Log');
  const logLines = el('div', 'log-lines');
  logPanel.appendChild(logToggle);
  logPanel.appendChild(logTitle);
  logPanel.appendChild(logLines);
  root.appendChild(logPanel);
  const noticeLine = el('div', 'combat-notice');
  root.appendChild(noticeLine);

  // --- Equipment row (just above the HUD) ----------------------------------
  const equipRow = el('div', 'equip-row');
  root.appendChild(equipRow);

  // --- HUD (bottom-center) --------------------------------------------------
  const hud = el('div', 'hud');
  const hpWrap = el('div', 'hud-hp');
  const hpBar = el('div', 'bar hp-bar');
  const hpFill = el('div', 'bar-fill hp-fill');
  const hpText = el('span', 'bar-text');
  hpBar.appendChild(hpFill);
  hpBar.appendChild(hpText);
  const armorBadge = el('span', 'armor-badge hidden');
  hpWrap.appendChild(hpBar);
  hpWrap.appendChild(armorBadge);
  const manaWrap = el('div', 'hud-mana');
  const manaBar = el('div', 'bar mana-bar');
  const manaFill = el('div', 'bar-fill mana-fill');
  const manaText = el('span', 'bar-text');
  manaBar.appendChild(manaFill);
  manaBar.appendChild(manaText);
  manaWrap.appendChild(manaBar);
  const actionWrap = el('div', 'hud-action');
  const actionIcon = el('span', 'hourglass', '⏳');
  const actionText = el('span', 'action-num');
  actionWrap.appendChild(actionIcon);
  actionWrap.appendChild(actionText);
  hud.appendChild(hpWrap);
  hud.appendChild(manaWrap);
  hud.appendChild(actionWrap);
  root.appendChild(hud);

  // --- Player area (bottom-right): arched portrait + End Turn --------------
  const playerArea = el('div', 'player-area');
  const playerPortraitWrap = el('div', 'player-portrait-wrap');
  const playerImg = imgWithFallback('assets/ui/knight.jpg', 'The Moonlit Knight');
  playerImg.className = 'player-portrait';
  playerPortraitWrap.appendChild(playerImg);
  const playerFloats = el('div', 'float-layer');
  playerPortraitWrap.appendChild(playerFloats);
  const endTurnBtn = el('button', 'btn end-turn-btn', 'End Turn');
  endTurnBtn.type = 'button';
  playerArea.appendChild(endTurnBtn);
  playerArea.appendChild(playerPortraitWrap);
  root.appendChild(playerArea);

  // --- Deck / discard piles: two arch frames, bottom-left ------------------
  // Our own labels: the original's two bottom-left arches are unlabeled
  // in the footage, so do not present this labeling as verified.
  const deckPiles = el('div', 'deck-piles');
  const deckPile = el('div', 'pile-arch');
  const deckPileArt = el('div', 'pile-card');
  const deckPileNum = el('span', 'pile-num', '0');
  deckPileArt.appendChild(deckPileNum);
  deckPile.appendChild(deckPileArt);
  deckPile.appendChild(el('div', 'pile-label', 'Deck'));
  const discardPile = el('div', 'pile-arch');
  const discardPileArt = el('div', 'pile-card');
  const discardPileNum = el('span', 'pile-num', '0');
  discardPileArt.appendChild(discardPileNum);
  discardPile.appendChild(discardPileArt);
  discardPile.appendChild(el('div', 'pile-label', 'Discard'));
  deckPiles.appendChild(deckPile);
  deckPiles.appendChild(discardPile);
  root.appendChild(deckPiles);

  // --- Hand (bottom-center) -------------------------------------------------
  const handEl = el('div', 'hand');
  root.appendChild(handEl);

  // --- Enlarged card preview (separate element, pointer-events:none) --------
  // Hovering a hand card shows its art large in the middle of the screen;
  // tapping a card toggles the same preview. The preview never intercepts
  // input, so it cannot cover a neighbour and swallow its input.
  //
  // NOTE on the missing-preview report (retest 2026-11-07): the live files
  // were byte-identical to local, the handler logic passes in jsdom, and the
  // new CSS was demonstrably live (trait pill + small hover lift were both
  // seen) — while the old JS module was still within GitHub Pages'
  // 10-minute HTTP cache window when the retest ran. Most likely cause:
  // the retest browser ran the CACHED pre-fix combat-ui.js (no preview
  // element at all) with fresh CSS. Mitigations shipped in v0.5:
  // (1) every module URL carries ?v=0.6 so a new release is a fresh fetch;
  // (2) the preview box now has an explicit aspect-ratio + background, so
  // it has size even before its image loads; (3) tap-to-preview gives the
  // preview a second, explicit trigger path besides hover.
  const cardPreview = imgWithFallback('assets/ui/cardback.jpg', 'Card preview');
  cardPreview.id = 'card-preview';
  root.appendChild(cardPreview);
  let previewFor = null; // src of the card currently enlarged, if any
  let previewSource = null; // 'hover' | 'tap' — who showed it last
  function hidePreview() {
    cardPreview.classList.remove('show');
    previewFor = null;
    previewSource = null;
  }
  function showPreviewFor(img, source) {
    cardPreview.src = img.src;
    cardPreview.classList.add('show');
    previewFor = img.src;
    previewSource = source;
  }
  function togglePreview(img) {
    // A tap pins the preview: if this tap already pinned this card, dismiss
    // it; otherwise show it — and a tap must NEVER dismiss a preview that
    // hover just showed for the same card (playtest: tap hid the preview
    // the moment the mouse button came up, so nothing stayed to read).
    if (previewSource === 'tap' && previewFor === img.src) {
      hidePreview();
    } else {
      showPreviewFor(img, 'tap');
    }
  }
  handEl.addEventListener('mouseover', (event) => {
    if (drag) return; // while dragging, the card stays under the pointer
    const img = event.target.closest('.hand-card');
    if (!img) return;
    showPreviewFor(img, 'hover');
  });
  handEl.addEventListener('mouseout', (event) => {
    if (event.relatedTarget && handEl.contains(event.relatedTarget)) return;
    // A tap-pinned preview survives the pointer leaving the hand; only a
    // hover preview disappears on mouseout.
    if (previewSource !== 'tap') hidePreview();
  });
  // Tapping anywhere that is not a hand card dismisses the preview.
  root.addEventListener('pointerdown', (event) => {
    if (!event.target.closest || !event.target.closest('.hand-card')) hidePreview();
  });

  // --- Drag & drop: drag a card up toward the enemy to play it -------------
  // Pointer Events (mouse + touch), NOT HTML5 drag-and-drop. Clicking /
  // tapping a card never plays it — a tap only toggles the centre preview.
  const DROP_LIFT_PX = 80; // dragging up more than this also counts as a drop
  const TAP_MOVE_PX = 8;   // pointerup within this distance counts as a tap
  const TAP_TIME_MS = 300;
  let handGen = 0;
  let lastCardPlay = { gen: -1, index: -1, time: 0 };
  let drag = null; // { img, index, pointerId, startX, startY, startTime, overEnemy }

  function dragOverEnemy(x, y) {
    // Rect hit-test (real browsers). Headless DOMs have no layout (all
    // rects are 0), so the upper part of the screen stands in for the
    // enemy area there.
    const r = enemyArea.getBoundingClientRect();
    if (r && (r.width > 0 || r.height > 0)) {
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }
    return y < window.innerHeight * 0.45;
  }

  function onDragStart(event) {
    if (drag) return;
    const img = event.target.closest ? event.target.closest('.hand-card') : null;
    if (!img || state.phase !== 'player') return;
    if (event.button !== undefined && event.button !== 0) return; // primary only
    drag = {
      img,
      index: Number(img.dataset.index),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: Date.now(),
      overEnemy: false,
    };
    // Do NOT hide the preview here: a tap is down+up, and hiding on down
    // would make the up-toggle re-show it instead of dismissing it.
    img.classList.add('dragging');
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
    if (event.preventDefault) event.preventDefault();
  }

  function onDragMove(event) {
    if (!drag) return;
    if (event.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    // A real drag (past the tap threshold) dismisses the preview.
    if (Math.hypot(dx, dy) > TAP_MOVE_PX) hidePreview();
    // Clamp so the card cannot leave the screen (skip when headless: no layout).
    let cx = dx;
    let cy = dy;
    const r = drag.img.getBoundingClientRect();
    if (r && (r.width > 0 || r.height > 0)) {
      cx = Math.max(-r.left, Math.min(window.innerWidth - r.right, dx));
      cy = Math.max(-r.top, Math.min(window.innerHeight - r.bottom, dy));
    }
    drag.img.style.transform = `translate(${cx}px, ${cy}px) rotate(0deg) scale(1.15)`;
    const over = dragOverEnemy(event.clientX, event.clientY) || dy < -DROP_LIFT_PX;
    drag.overEnemy = over;
    enemyArea.classList.toggle('drop-target', over);
  }

  function endDragCleanup(d) {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    enemyArea.classList.remove('drop-target');
    // Snap back home (the CSS transition animates it); a played card is
    // removed by render() anyway, so this is harmless there too.
    d.img.classList.remove('dragging');
    d.img.style.transform = '';
  }

  function onDragEnd(event) {
    if (!drag) return;
    if (event.pointerId !== undefined && event.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    endDragCleanup(d);
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    const dist = Math.hypot(dx, dy);
    const dt = Date.now() - d.startTime;
    if (dist < TAP_MOVE_PX && dt < TAP_TIME_MS) {
      togglePreview(d.img); // tap: enlarge to read, never play
      return;
    }
    const lifted = d.startY - event.clientY > DROP_LIFT_PX;
    if (d.overEnemy || lifted) attemptPlay(d.index, d.img);
    // Otherwise the card simply glides back into the hand (see cleanup).
  }

  function onDragCancel() {
    if (!drag) return;
    const d = drag;
    drag = null;
    endDragCleanup(d);
  }

  handEl.addEventListener('pointerdown', onDragStart);

  // --- Win / lose overlay ----------------------------------------------------
  const overlay = el('div', 'overlay hidden');
  const overlayTitle = el('div', 'overlay-title');
  const overlayLine = el('div', 'overlay-line');
  const overlayBtns = el('div', 'overlay-btns');
  const overlayBtnA = el('button', 'btn', '');
  const overlayBtnB = el('button', 'btn secondary', '');
  overlayBtnA.type = 'button';
  overlayBtnB.type = 'button';
  overlayBtns.appendChild(overlayBtnA);
  overlayBtns.appendChild(overlayBtnB);
  overlay.appendChild(overlayTitle);
  overlay.appendChild(overlayLine);
  overlay.appendChild(overlayBtns);
  root.appendChild(overlay);

  // --- Floating damage numbers ----------------------------------------------
  function floater(layer, text, kind) {
    const span = el('span', `floater ${kind}`, text);
    layer.appendChild(span);
    const remove = () => span.remove();
    span.addEventListener('animationend', remove);
    // Fallback cleanup if animationend never fires (e.g. headless DOM).
    setTimeout(remove, 1200);
  }

  function snapshot() {
    return {
      enemyHp: state.enemy.hp,
      playerHp: state.player.hp,
      playerArmor: state.player.armor,
    };
  }

  function showDiffs(before) {
    const after = snapshot();
    const eDmg = before.enemyHp - after.enemyHp;
    if (eDmg > 0) floater(enemyFloats, `-${eDmg}`, 'dmg');
    const pDmg = before.playerHp - after.playerHp;
    if (pDmg > 0) floater(playerFloats, `-${pDmg}`, 'dmg');
    const healed = after.playerHp - before.playerHp;
    if (healed > 0) floater(playerFloats, `+${healed}`, 'heal');
    const armor = after.playerArmor - before.playerArmor;
    if (armor > 0) floater(playerFloats, `+${armor} 🛡`, 'armor');
  }

  // --- Render -----------------------------------------------------------------
  function render() {
    // The hovered card may be gone after a play; never show stale art.
    hidePreview();
    const p = state.player;
    const e = state.enemy;

    // Enemy
    enemyHpFill.style.width = `${Math.max(0, (e.hp / e.maxHp) * 100)}%`;
    enemyHpText.textContent = `${Math.max(0, e.hp)} / ${e.maxHp}`;
    enemyHourglass.textContent = `⏳ ${state.enemy.turnCount}`;

    // Player HUD
    hpFill.style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
    hpText.textContent = `${Math.max(0, p.hp)} / ${p.maxHp}`;
    if (p.armor > 0) {
      armorBadge.textContent = `🛡 ${p.armor}`;
      armorBadge.classList.remove('hidden');
    } else {
      armorBadge.classList.add('hidden');
    }
    manaFill.style.width = `${Math.min(100, (p.mana / 10) * 100)}%`;
    manaText.textContent = `${p.mana} Mana`;
    actionText.textContent = `${p.action} / ${p.actionCap}`;
    goldText.textContent = `${p.gold}`;
    endTurnBtn.disabled = state.phase !== 'player';

    // Top bar: one gold circle per blessing owned (empty outlines otherwise).
    blessingDots.innerHTML = '';
    const owned = p.blessings || [];
    if (owned.length === 0) {
      for (let i = 0; i < 3; i++) blessingDots.appendChild(el('span', 'blessing-dot empty'));
    } else {
      for (const id of owned) {
        const dot = el('span', 'blessing-dot', '★');
        dot.title = BLESSING_NAMES[id] || id;
        blessingDots.appendChild(dot);
      }
    }

    // Deck / discard pile counts.
    deckPileNum.textContent = String(p.deck.length);
    discardPileNum.textContent = String(p.discard.length);

    // Equipment + counters row (small round icons with the card art).
    // Free slots render as dim dashed circles, so the row reads as slots
    // even before anything is equipped (playtest: empty row was text only).
    equipRow.innerHTML = '';
    const equipped = [...p.equipment, ...p.counters];
    for (const id of equipped) {
      const card = getCard(id);
      const chip = el('span', 'equip-chip');
      chip.title = card ? `${card.name} — ${card.text}` : id;
      const thumb = imgWithFallback(`assets/cards/${id}.jpg`, card ? card.name : id);
      chip.appendChild(thumb);
      if (p.counters.includes(id)) chip.classList.add('counter');
      equipRow.appendChild(chip);
    }
    const freeSlots = Math.max(0, p.equipSlots - p.equipment.length);
    for (let i = 0; i < freeSlots; i++) {
      const empty = el('span', 'equip-chip empty');
      empty.title = 'Empty equipment slot';
      equipRow.appendChild(empty);
    }
    if (equipped.length === 0) {
      const hint = el('span', 'equip-empty', 'No equipment yet');
      equipRow.appendChild(hint);
    }
    const slots = el('span', 'equip-slots', `Slots: ${p.equipment.length}/${p.equipSlots}`);
    equipRow.appendChild(slots);

    // Hand
    handGen += 1;
    handEl.innerHTML = '';
    const n = p.hand.length;
    p.hand.forEach((cardId, i) => {
      const card = getCard(cardId);
      const img = imgWithFallback(`assets/cards/${cardId}.jpg`, card ? card.name : cardId);
      img.className = 'hand-card';
      img.dataset.index = String(i);
      img.title = card ? `${card.name} — ${card.text}` : cardId;
      const playable = isPlayable(state, card);
      img.classList.toggle('playable', playable);
      img.classList.toggle('unplayable', !playable);
      // Fan the hand: slight rotation + drop toward the edges.
      const mid = (n - 1) / 2;
      const offset = i - mid;
      img.style.setProperty('--fan-rot', `${offset * 4}deg`);
      img.style.setProperty('--fan-y', `${Math.abs(offset) * 4}px`);
      // Clicks are handled by the delegated listener on handEl (see setup):
      // no per-card listener here, so a re-render can never orphan a click.
      handEl.appendChild(img);
    });

    // Combat log: last ~5 engine lines.
    logLines.innerHTML = '';
    for (const line of state.log.slice(-5)) {
      logLines.appendChild(el('div', 'log-line', line));
    }
  }

  function notice(msg) {
    noticeLine.textContent = msg || '';
  }

  // --- Game-over overlay -------------------------------------------------------
  let overlayTimer = 0;
  function maybeShowGameOver() {
    const result = isGameOver(state);
    if (!result) return;
    clearTimeout(overlayTimer);
    // Small delay so the final damage floater is visible first — kept short
    // (350ms) so the win does not feel like the game froze (playtest note).
    overlayTimer = setTimeout(() => {
      if (result === 'won') {
        overlayTitle.textContent = 'Victory!';
        if (onVictory) {
          // Book flow: rewards + level-up live in the caller's onVictory.
          overlayLine.textContent = `You defeated ${state.enemy.name}.`;
          overlayBtnA.textContent = 'Continue';
          overlayBtnB.textContent = 'Title';
          overlayBtnA.onclick = debounce(() => onVictory(state), 350);
          overlayBtnB.onclick = debounce(() => exitToTitle(), 350);
        } else {
          overlayLine.textContent = `You defeated ${state.enemy.name}.  Gold: ${state.player.gold}  ·  +10 EXP`;
          overlayBtnA.textContent = 'Next';
          overlayBtnB.textContent = 'Fight Again';
          overlayBtnA.onclick = debounce(() => exitToTitle(), 350);
          overlayBtnB.onclick = debounce(() => restart(), 350);
        }
      } else {
        overlayTitle.textContent = 'Defeated…';
        overlayLine.textContent = `${state.enemy.name} stands over you. The book is not finished yet.`;
        overlayBtnA.textContent = 'Retry Battle';
        overlayBtnB.textContent = 'Title';
        overlayBtnA.onclick = debounce(() => {
          if (onRetry) onRetry();
          else restart();
        }, 350);
        overlayBtnB.onclick = debounce(() => exitToTitle(), 350);
      }
      overlay.classList.remove('hidden');
    }, 350);
  }

  function restart() {
    // A fresh fight vs the same monster (full HP retry). The new combat
    // replaces this one in the container; the old root is removed by
    // startCombat, so this api object is retired with it. All run opts
    // (deck, blessings, upgrades, HP, slots) carry over to the new fight.
    startCombat(container, {
      ...opts,
      monsterId, deckIds: opts.deckIds || STARTER_DECK, onExit,
    });
  }

  function exitToTitle() {
    destroy();
    if (onExit) onExit();
  }

  // --- Handlers ----------------------------------------------------------------
  // attemptPlay: the single path from a completed drag to the engine.
  // Debounced per (hand generation, index): dragging one card twice in a
  // row plays it once, but two different cards dragged in quick succession
  // — even if the second lands at the same index after a re-render — both work.
  function attemptPlay(index, imgEl) {
    if (state.phase !== 'player') { notice(PLAY_DENIED['not-player-turn']); return; }
    const now = Date.now();
    if (lastCardPlay.gen === handGen && lastCardPlay.index === index
        && now - lastCardPlay.time < 350) return;
    lastCardPlay = { gen: handGen, index, time: now };
    const before = snapshot();
    const result = playCard(state, index);
    if (!result.ok) {
      notice(PLAY_DENIED[result.reason] || 'That card cannot be played.');
      const img = imgEl;
      img.classList.add('shake');
      setTimeout(() => img.classList.remove('shake'), 350);
      return;
    }
    notice('');
    showDiffs(before);
    render();
    maybeShowGameOver();
  }

  const onEndTurn = debounce(() => {
    if (state.phase !== 'player') return;
    hidePreview();
    const before = snapshot();
    const result = endTurn(state);
    if (!result.ok) {
      notice(PLAY_DENIED[result.reason] || 'Cannot end turn yet.');
      return;
    }
    notice('');
    showDiffs(before);
    render();
    maybeShowGameOver();
    if (!isGameOver(state)) {
      // Enemy turn runs synchronously inside endTurn; announce the new turn.
      setTimeout(() => showBanner('Your Turn'), 450);
    }
  }, 350);

  endTurnBtn.addEventListener('click', onEndTurn);

  function destroy() {
    clearTimeout(overlayTimer);
    root.remove();
  }

  // Expose the live api for the caller / smoke test.
  const api = {
    state,
    container,
    root,
    render,
    destroy,
    playHandIndex(index) {
      // Headless-friendly entry point for the smoke test: same path as a click.
      if (state.phase !== 'player') return { ok: false, reason: 'not-player-turn' };
      const before = snapshot();
      const result = playCard(state, index);
      if (!result.ok) return result;
      showDiffs(before);
      render();
      maybeShowGameOver();
      return result;
    },
    endTurn() {
      onEndTurn();
      return { ok: true };
    },
    exitToTitle,
  };

  render();
  showBanner('Your Turn');
  return api;
}
