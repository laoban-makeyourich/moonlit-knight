// Moonlit Knight — combat UI (Stage 2).
// DOM-only layer on top of the Stage 1 engine (src/engine.js).
// No framework, no build step. Animations are CSS transform/opacity only;
// JS timers are used solely for one-shot cleanup / banner timing.
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

import { createGame, playCard, endTurn, isGameOver } from './engine.js';
import { getCard, STARTER_DECK } from './cards.js';
import { getMonster } from './monsters.js';

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
  // Thin blue bar under the enemy HP: flavor (enemy mana, static).
  const enemyManaBar = el('div', 'bar mana-bar thin');
  const enemyManaFill = el('div', 'bar-fill mana-fill');
  enemyManaFill.style.width = '60%';
  enemyManaBar.appendChild(enemyManaFill);
  const enemySpecial = el('div', 'enemy-special', monster.special || '');
  enemyArea.appendChild(enemyPortraitWrap);
  enemyArea.appendChild(enemyName);
  enemyArea.appendChild(enemyHpBar);
  enemyArea.appendChild(enemyManaBar);
  enemyArea.appendChild(enemySpecial);
  root.appendChild(enemyArea);

  // --- Combat log (bottom-left corner) ------------------------------------
  const logPanel = el('div', 'combat-log');
  const logTitle = el('div', 'log-title', 'Battle Log');
  const logLines = el('div', 'log-lines');
  const noticeLine = el('div', 'log-notice');
  logPanel.appendChild(logTitle);
  logPanel.appendChild(logLines);
  logPanel.appendChild(noticeLine);
  root.appendChild(logPanel);

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
  const goldWrap = el('div', 'hud-gold');
  const goldIcon = el('span', null, '🪙');
  const goldText = el('span', 'gold-num');
  goldWrap.appendChild(goldIcon);
  goldWrap.appendChild(goldText);
  hud.appendChild(hpWrap);
  hud.appendChild(manaWrap);
  hud.appendChild(actionWrap);
  hud.appendChild(goldWrap);
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

  // --- Hand (bottom-center) -------------------------------------------------
  const handEl = el('div', 'hand');
  root.appendChild(handEl);

  // --- Enlarged card preview (separate element, pointer-events:none) --------
  // Hovering a hand card shows its art large in the middle of the screen.
  // The preview never intercepts clicks, so it cannot cover a neighbour
  // and swallow that neighbour's click (playtest: one click did nothing).
  const cardPreview = imgWithFallback('assets/ui/cardback.jpg', 'Card preview');
  cardPreview.id = 'card-preview';
  root.appendChild(cardPreview);
  function hidePreview() { cardPreview.classList.remove('show'); }
  handEl.addEventListener('mouseover', (event) => {
    const img = event.target.closest('.hand-card');
    if (!img) return;
    cardPreview.src = img.src;
    cardPreview.classList.add('show');
  });
  handEl.addEventListener('mouseout', (event) => {
    if (event.relatedTarget && handEl.contains(event.relatedTarget)) return;
    hidePreview();
  });
  // Delegated clicks: the listener lives on the hand container, so a click
  // is never lost when render() rebuilds the hand between mousedown and
  // mouseup. Debounced per (hand generation, index): a double-click on one
  // card plays it once, but two different cards in quick succession — even
  // if the second lands at the same index after a re-render — both work.
  let handGen = 0;
  let lastCardPlay = { gen: -1, index: -1, time: 0 };
  handEl.addEventListener('click', (event) => {
    const img = event.target.closest('.hand-card');
    if (!img) return;
    const index = Number(img.dataset.index);
    const now = Date.now();
    if (lastCardPlay.gen === handGen && lastCardPlay.index === index
        && now - lastCardPlay.time < 350) return;
    lastCardPlay = { gen: handGen, index, time: now };
    hidePreview();
    onCardClick(index, img);
  });

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

    // Equipment + counters row (small round icons with the card art).
    equipRow.innerHTML = '';
    const equipped = [...p.equipment, ...p.counters];
    if (equipped.length === 0) {
      const empty = el('span', 'equip-empty', 'No equipment yet — play an Equipment card to fill a slot.');
      equipRow.appendChild(empty);
    } else {
      for (const id of equipped) {
        const card = getCard(id);
        const chip = el('span', 'equip-chip');
        chip.title = card ? `${card.name} — ${card.text}` : id;
        const thumb = imgWithFallback(`assets/cards/${id}.jpg`, card ? card.name : id);
        chip.appendChild(thumb);
        if (p.counters.includes(id)) chip.classList.add('counter');
        equipRow.appendChild(chip);
      }
      const slots = el('span', 'equip-slots', `Slots: ${p.equipment.length}/${p.equipSlots}`);
      equipRow.appendChild(slots);
    }

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

  // --- Handlers (debounced against double-clicks) ------------------------------
  function onCardClick(index, imgEl) {
    if (state.phase !== 'player') { notice(PLAY_DENIED['not-player-turn']); return; }
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
