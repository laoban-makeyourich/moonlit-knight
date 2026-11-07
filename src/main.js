// Moonlit Knight — main entry (Stage 3).
// Boot: preload first-screen art, enable the Start button, hand off to the
// book flow (src/book.js) via window.MoonlitKnight.start().

import { startRun } from './book.js';

const $ = (sel) => document.querySelector(sel);

// First-screen assets: loaded eagerly so the title renders instantly.
// Every other asset is lazy-loaded by the screens that need it (Stage 3/4).
const FIRST_SCREEN = [
  'assets/ui/knight.jpg',
  'assets/ui/bg-table.jpg',
];

const ALL_ASSETS = [
  ...FIRST_SCREEN,
  ...['basic-strike','iron-thorn','piercing-thrust','final-verdict','arsenal-strike',
     'ember-slash','heavy-cleave','riposte','shield-bash','vengeful-strike','crimson-edge',
     'second-wind','bulwark-stance','sharpen-blade','rally-cry','war-cry','battle-focus',
     'iron-resolve','aegis-light','moonlit-guard','iron-will','steel-rain','guardians-oath',
     'mana-crystal','deep-breath','wardens-shield','duel-dagger','blood-oath-blade',
     'spike-barrier','bulwark-shield','chainmail-vest','war-banner','lucky-horseshoe',
     'phoenix-crest','parry','thorn-guard'].map((c) => `assets/cards/${c}.jpg`),
  ...['thorn-wolf','rat-king','hollow-stag','mire-wisp','mire-crocodile','grave-witch']
    .map((m) => `assets/monsters/${m}.jpg`),
  ...['bg-forest','bg-village','bg-graveyard','bg-boss-arena','shop-merchant','shop-stall',
     'event-fairy','event-chest','event-smithy','event-spring','cardback']
    .map((u) => `assets/ui/${u}.jpg`),
];

const loaded = new Set();

function preload(src) {
  if (loaded.has(src)) return Promise.resolve(src);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { loaded.add(src); resolve(src); };
    img.onerror = () => { console.warn('[preload] failed:', src); resolve(src); };
    img.src = src;
  });
}

function preloadAll(list) {
  return Promise.all(list.map(preload));
}

// Show a one-shot banner (CSS transform/opacity only — no layout thrash).
let bannerTimer = 0;
function showBanner(text, ms = 1400) {
  const el = $('#banner');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), ms);
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

async function boot() {
  const btn = $('#start-btn');
  const status = $('#loading');
  status.textContent = 'Preparing the book…';
  await preloadAll(FIRST_SCREEN);
  status.textContent = '';
  btn.disabled = false;
  btn.textContent = 'Begin the Story';
  btn.addEventListener('click', debounce(() => {
    window.MoonlitKnight.start();
  }));
  // Warm the cache for the rest of the art in the background, lowest priority.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => preloadAll(ALL_ASSETS), { timeout: 8000 });
  } else {
    setTimeout(() => preloadAll(ALL_ASSETS), 1500);
  }
}

window.MoonlitKnight = {
  start() {
    // Stage 3: a full 3-chapter run (book flow). The run owns combat via
    // startCombat; quitting returns here to the title screen.
    $('#title-screen').classList.add('hidden');
    $('#game-screen').classList.remove('hidden');
    startRun($('#game-screen'), {
      onExit() {
        $('#game-screen').classList.add('hidden');
        $('#title-screen').classList.remove('hidden');
      },
    });
  },
  showBanner,
  debounce,
  preloadAll,
};

boot();
