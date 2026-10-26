/**
 * n3xn OS — bootstrap
 */
import { openDB } from './db.js';
import { initWasm, isWasmReady } from './wasm/engine.js';
import { configureCloak, protectDocumentTitle, getCloakSettings } from './cloak.js';
import { initWindowManager, minimizeAll } from './window-manager.js';
import {
  loadApps,
  loadSettings,
  getApps,
  launchApp,
  searchApps,
  setAppSettings,
  toast,
} from './apps.js';

const $ = (sel) => document.querySelector(sel);

async function boot() {
  const bootEl = $('#boot');
  try {
    await openDB();
    await initWasm();
    const settings = await loadSettings();
    configureCloak({
      hideUrls: settings.hideUrls !== false,
      cloakTitle: settings.cloakTitle || 'Google',
      cloakFavicon: settings.cloakFavicon || 'https://www.google.com/favicon.ico',
      antiBlocksi: settings.antiBlocksi !== false,
    });
    setAppSettings(settings);
    await loadApps();

    initWindowManager($('#window-host'));
    setupDesktop();
    setupTaskbar();
    setupStartMenu();
    setupSearch();
    setupWidgets();
    startClock();
    protectDocumentTitle();

    // Wallpaper
    if (settings.wallpaper) {
      const bg = $('#desktop-bg');
      bg.style.backgroundImage = `url("${settings.wallpaper}")`;
      bg.classList.add('has-image');
    }

    // Reveal OS
    $('#os').classList.remove('hidden');
    requestAnimationFrame(() => {
      bootEl.classList.add('done');
      setTimeout(() => bootEl.remove(), 600);
    });

    console.info('[n3xn OS] ready · WASM:', isWasmReady() ? 'on' : 'js-fallback');
  } catch (err) {
    console.error('[n3xn OS] boot failed', err);
    bootEl.querySelector('.boot-text').textContent = 'Boot error — see console';
  }
}

function setupDesktop() {
  const desktop = $('#desktop');
  const apps = getApps().filter((a) => a.desktop);
  // Always show a few core icons
  const icons = [
    { id: 'app-explorer', name: 'File Explorer', icon: '📁' },
    { id: 'app-browser', name: 'Microsoft Edge', icon: '🌐' },
    { id: 'app-notepad', name: 'Notepad', icon: '📝' },
    { id: 'app-recycle', name: 'Recycle Bin', icon: '🗑️', special: true },
    ...apps.filter((a) => !['app-explorer', 'app-browser', 'app-notepad'].includes(a.id)),
  ];

  desktop.innerHTML = '';
  icons.forEach((app) => {
    const el = document.createElement('div');
    el.className = 'desk-icon';
    el.dataset.id = app.id;
    el.innerHTML = `<div class="icon">${app.icon}</div><div class="label">${app.name}</div>`;
    el.addEventListener('dblclick', () => {
      if (app.special) {
        toast('Recycle Bin is empty');
        return;
      }
      launchApp(app.id);
    });
    el.addEventListener('click', (e) => {
      desktop.querySelectorAll('.desk-icon').forEach((x) => x.classList.remove('selected'));
      el.classList.add('selected');
    });
    desktop.appendChild(el);
  });

  desktop.addEventListener('click', (e) => {
    if (e.target === desktop) {
      desktop.querySelectorAll('.desk-icon').forEach((x) => x.classList.remove('selected'));
      closeFlyouts();
    }
  });
}

function setupTaskbar() {
  const pinned = $('#taskbar-pinned');
  function renderPinned() {
    const apps = getApps().filter((a) => a.shelf || a.pinned);
    const core = [
      { id: 'app-browser', icon: '🌐' },
      { id: 'app-explorer', icon: '📁' },
      { id: 'app-store', icon: '🛍️' },
    ];
    const seen = new Set();
    pinned.innerHTML = '';
    [...core, ...apps].forEach((a) => {
      if (seen.has(a.id)) return;
      seen.add(a.id);
      const btn = document.createElement('button');
      btn.className = 'taskbar-app';
      btn.title = a.name || a.id;
      btn.dataset.appId = a.id;
      btn.textContent = a.icon || '📦';
      btn.addEventListener('click', () => launchApp(a.id));
      pinned.appendChild(btn);
    });
  }
  renderPinned();
  document.addEventListener('n3xn:apps-changed', renderPinned);

  $('#btn-start').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleStart();
  });
  $('#btn-search').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSearch();
  });
  $('#btn-widgets').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleWidgets();
  });
  $('#btn-show-desktop').addEventListener('click', () => minimizeAll());
  $('#btn-power').addEventListener('click', () => {
    if (confirm('Shut down n3xn OS? (This reloads the page)')) location.reload();
  });

  // Update taskbar indicators
  document.addEventListener('n3xn:window-open', updateTaskbarActive);
  document.addEventListener('n3xn:window-close', updateTaskbarActive);
  document.addEventListener('n3xn:focus', updateTaskbarActive);
}

function updateTaskbarActive() {
  // light visual only
  document.querySelectorAll('.taskbar-app').forEach((btn) => {
    btn.classList.remove('active', 'open');
  });
}

function setupStartMenu() {
  const menu = $('#start-menu');
  const grid = $('#pinned-grid');
  const rec = $('#recommended-list');

  function render() {
    const apps = getApps();
    grid.innerHTML = '';
    apps.filter((a) => a.pinned !== false).slice(0, 18).forEach((a) => {
      const item = document.createElement('div');
      item.className = 'pinned-item';
      item.innerHTML = `<div class="icon">${a.icon || '📦'}</div><div class="name">${a.name}</div>`;
      item.addEventListener('click', () => {
        launchApp(a);
        closeFlyouts();
      });
      grid.appendChild(item);
    });

    rec.innerHTML = '';
    apps.slice(0, 4).forEach((a) => {
      const item = document.createElement('div');
      item.className = 'rec-item';
      item.innerHTML = `<div class="icon">${a.icon || '📦'}</div><div class="info"><div class="title">${a.name}</div><div class="sub">App</div></div>`;
      item.addEventListener('click', () => {
        launchApp(a);
        closeFlyouts();
      });
      rec.appendChild(item);
    });
  }

  render();
  document.addEventListener('n3xn:apps-changed', render);

  $('#start-search').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (!q) {
      render();
      return;
    }
    const results = searchApps(q);
    grid.innerHTML = '';
    results.forEach((a) => {
      const item = document.createElement('div');
      item.className = 'pinned-item';
      item.innerHTML = `<div class="icon">${a.icon || '📦'}</div><div class="name">${a.name}</div>`;
      item.addEventListener('click', () => {
        launchApp(a);
        closeFlyouts();
      });
      grid.appendChild(item);
    });
  });

  $('#btn-all-apps').addEventListener('click', () => {
    launchApp('app-store');
    closeFlyouts();
  });
  $('#btn-user').addEventListener('click', () => {
    launchApp('app-settings');
    closeFlyouts();
  });
}

function setupSearch() {
  const fly = $('#search-flyout');
  const input = $('#global-search');
  const results = $('#search-results');
  input.addEventListener('input', () => {
    const q = input.value.trim();
    results.innerHTML = '';
    if (!q) return;
    searchApps(q).forEach((a) => {
      const row = document.createElement('div');
      row.className = 'rec-item';
      row.innerHTML = `<div class="icon">${a.icon}</div><div class="info"><div class="title">${a.name}</div></div>`;
      row.addEventListener('click', () => {
        launchApp(a);
        closeFlyouts();
      });
      results.appendChild(row);
    });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const list = searchApps(input.value.trim());
      if (list[0]) {
        launchApp(list[0]);
        closeFlyouts();
      }
    }
  });
}

function setupWidgets() {
  // simple clock widget already updated by startClock
}

function startClock() {
  const timeEl = $('#clock-time');
  const dateEl = $('#clock-date');
  const widget = $('#widget-clock');
  function tick() {
    const now = new Date();
    const t = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const d = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    if (timeEl) timeEl.textContent = t;
    if (dateEl) dateEl.textContent = d;
    if (widget) widget.textContent = t;
  }
  tick();
  setInterval(tick, 1000);
  // Weather placeholder
  const w = $('#widget-weather');
  if (w) w.textContent = 'Partly cloudy · 72°';
}

function toggleStart() {
  const menu = $('#start-menu');
  const open = !menu.classList.contains('open');
  closeFlyouts();
  if (open) {
    menu.classList.remove('hidden');
    requestAnimationFrame(() => menu.classList.add('open'));
    $('#btn-start').classList.add('active');
    $('#start-search').focus();
  }
}

function toggleSearch() {
  const fly = $('#search-flyout');
  const open = !fly.classList.contains('open');
  closeFlyouts();
  if (open) {
    fly.classList.remove('hidden');
    requestAnimationFrame(() => fly.classList.add('open'));
    $('#btn-search').classList.add('active');
    $('#global-search').focus();
  }
}

function toggleWidgets() {
  const panel = $('#widgets-panel');
  const open = !panel.classList.contains('open');
  closeFlyouts();
  if (open) {
    panel.classList.remove('hidden');
    requestAnimationFrame(() => panel.classList.add('open'));
    $('#btn-widgets').classList.add('active');
  }
}

function closeFlyouts() {
  ['#start-menu', '#search-flyout', '#widgets-panel'].forEach((sel) => {
    const el = $(sel);
    el.classList.remove('open');
    el.classList.add('hidden');
  });
  document.querySelectorAll('.tb-btn.active').forEach((b) => b.classList.remove('active'));
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeFlyouts();
  // Win key simulation: Ctrl+Meta or Ctrl+Escape for start
  if ((e.ctrlKey && e.key === 'Escape') || (e.metaKey && e.key === 'Meta')) {
    e.preventDefault();
    toggleStart();
  }
});

document.addEventListener('pointerdown', (e) => {
  const menu = $('#start-menu');
  const search = $('#search-flyout');
  const widgets = $('#widgets-panel');
  if (
    menu.classList.contains('open') &&
    !menu.contains(e.target) &&
    !e.target.closest('#btn-start')
  ) {
    closeFlyouts();
  }
  if (
    search.classList.contains('open') &&
    !search.contains(e.target) &&
    !e.target.closest('#btn-search')
  ) {
    closeFlyouts();
  }
  if (
    widgets.classList.contains('open') &&
    !widgets.contains(e.target) &&
    !e.target.closest('#btn-widgets')
  ) {
    closeFlyouts();
  }
});

boot();
