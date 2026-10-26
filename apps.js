/**
 * n3xn OS — Apps registry, launcher, and built-in app factories
 */

import { createWindow, focusOrCreate, setWindowTitle } from './window-manager.js';
import {
  displayTitle,
  displayUrl,
  displayFavicon,
  hardenIframe,
  navigateCloaked,
  safeAppLabel,
  getCloakSettings,
} from './cloak.js';
import { rankSearch } from './wasm/engine.js';
import * as db from './db.js';

const DEFAULT_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen';
const DEFAULT_SANDBOX =
  'allow-downloads allow-forms allow-modals allow-orientation-lock allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts';

let apps = [];
let settings = {
  hideUrls: true,
  searchEngine: 'https://duckduckgo.com/?q=%s',
  homepage: '',
  cloakTitle: 'Google',
  cloakFavicon: 'https://www.google.com/favicon.ico',
};

export function setAppSettings(s) {
  settings = { ...settings, ...s };
}

export function getApps() {
  return apps.slice();
}

export async function loadApps() {
  try {
    const res = await fetch('data/apps.json');
    const data = await res.json();
    apps = data.apps || [];
  } catch {
    apps = [];
  }
  // Merge user-installed apps from IndexedDB
  try {
    const custom = await db.getAll('apps');
    for (const c of custom) {
      if (!apps.find((a) => a.id === c.id)) apps.push(c);
    }
  } catch {}
  return apps;
}

export async function installApp(app) {
  const entry = {
    id: app.id || `app-custom-${Date.now()}`,
    name: app.name || 'App',
    icon: app.icon || '📦',
    type: app.type || 'web',
    url: app.url || '',
    cloak: !!app.cloak,
    shelf: !!app.shelf,
    pinned: !!app.pinned,
    desktop: !!app.desktop,
  };
  apps = apps.filter((a) => a.id !== entry.id);
  apps.push(entry);
  await db.put('apps', entry);
  document.dispatchEvent(new CustomEvent('n3xn:apps-changed'));
  return entry;
}

export async function uninstallApp(id) {
  apps = apps.filter((a) => a.id !== id);
  await db.del('apps', id);
  document.dispatchEvent(new CustomEvent('n3xn:apps-changed'));
}

export function findApp(id) {
  return apps.find((a) => a.id === id);
}

export function searchApps(query) {
  return rankSearch(query, apps, (a) => `${a.name} ${a.id} ${a.url || ''}`);
}

export function launchApp(idOrApp) {
  const app = typeof idOrApp === 'string' ? findApp(idOrApp) : idOrApp;
  if (!app) return null;

  switch (app.type) {
    case 'browser':
      return openBrowser(null, app);
    case 'settings':
      return openSettings();
    case 'notepad':
      return openNotepad();
    case 'calculator':
      return openCalculator();
    case 'explorer':
      return openExplorer();
    case 'store':
      return openStore();
    case 'web':
    default:
      return openWebApp(app);
  }
}

/* ─── Browser ─── */
export function openBrowser(startUrl, appMeta) {
  return focusOrCreate('app-browser', () => {
    const win = createWindow({
      title: 'Microsoft Edge',
      icon: '🌐',
      appId: 'app-browser',
      width: 1100,
      height: 700,
    });

    const chrome = document.createElement('div');
    chrome.className = 'browser-chrome';
    chrome.innerHTML = `
      <div class="browser-tabs">
        <button class="browser-tab active" data-tab="0">
          <img class="tab-fav" src="" alt="" style="display:none" />
          <span class="tab-title">New Tab</span>
          <span class="tab-close">✕</span>
        </button>
        <button class="tb-btn" id="new-tab-btn" style="width:28px;height:28px;margin:0 4px" title="New tab">+</button>
      </div>
      <div class="browser-toolbar">
        <button class="browser-nav-btn" data-nav="back" title="Back">←</button>
        <button class="browser-nav-btn" data-nav="fwd" title="Forward">→</button>
        <button class="browser-nav-btn" data-nav="reload" title="Reload">↻</button>
        <div class="omnibox">
          <span class="lock">🔒</span>
          <input type="text" spellcheck="false" autocomplete="off" placeholder="Search or enter address" />
        </div>
        <button class="browser-nav-btn" data-nav="home" title="Home">⌂</button>
      </div>
      <div class="browser-frame-wrap">
        <div class="browser-loading">Loading…</div>
        <iframe sandbox="${DEFAULT_SANDBOX}" allow="${DEFAULT_ALLOW}" allowfullscreen></iframe>
      </div>
    `;
    win.body.appendChild(chrome);

    const state = {
      tabs: [{ title: 'New Tab', url: '', history: [], idx: -1 }],
      active: 0,
    };

    const iframe = chrome.querySelector('iframe');
    const loading = chrome.querySelector('.browser-loading');
    const omnibox = chrome.querySelector('.omnibox input');
    const tabsEl = chrome.querySelector('.browser-tabs');

    function current() {
      return state.tabs[state.active];
    }

    function renderTabs() {
      const buttons = tabsEl.querySelectorAll('.browser-tab');
      // rebuild simply
      const addBtn = tabsEl.querySelector('#new-tab-btn');
      tabsEl.querySelectorAll('.browser-tab').forEach((b) => b.remove());
      state.tabs.forEach((t, i) => {
        const btn = document.createElement('button');
        btn.className = 'browser-tab' + (i === state.active ? ' active' : '');
        btn.dataset.tab = String(i);
        const hide = getCloakSettings().hideUrls;
        const title = hide
          ? displayTitle(t.title, t.url, { appName: t.title || 'Tab' })
          : t.title || t.url || 'New Tab';
        btn.innerHTML = `<span class="tab-title">${title}</span><span class="tab-close">✕</span>`;
        btn.addEventListener('click', (e) => {
          if (e.target.classList.contains('tab-close')) {
            closeTab(i);
            return;
          }
          switchTab(i);
        });
        tabsEl.insertBefore(btn, addBtn);
      });
    }

    function switchTab(i) {
      state.active = i;
      const t = current();
      omnibox.value = getCloakSettings().hideUrls ? displayUrl(t.url) : t.url || '';
      if (t.url) {
        loading.classList.remove('hidden');
        iframe.src = t.url;
        hardenIframe(iframe, t.url);
      } else {
        iframe.src = 'about:blank';
        loading.classList.add('hidden');
      }
      renderTabs();
      setWindowTitle(win.id, displayTitle(t.title, t.url, { appName: 'Microsoft Edge' }));
    }

    function closeTab(i) {
      if (state.tabs.length === 1) {
        // reset
        state.tabs[0] = { title: 'New Tab', url: '', history: [], idx: -1 };
        switchTab(0);
        return;
      }
      state.tabs.splice(i, 1);
      if (state.active >= state.tabs.length) state.active = state.tabs.length - 1;
      switchTab(state.active);
    }

    function navigate(raw) {
      let url = (raw || '').trim();
      if (!url) return;
      if (!/^https?:\/\//i.test(url) && !url.includes('.') && !url.startsWith('about:')) {
        url = settings.searchEngine.replace('%s', encodeURIComponent(url));
      } else if (!/^https?:\/\//i.test(url) && !url.startsWith('about:')) {
        url = 'https://' + url;
      }
      const t = current();
      t.url = url;
      t.title = 'Loading…';
      t.history = t.history.slice(0, t.idx + 1);
      t.history.push(url);
      t.idx = t.history.length - 1;
      loading.classList.remove('hidden');
      omnibox.value = getCloakSettings().hideUrls ? displayUrl(url) : url;
      iframe.src = url;
      hardenIframe(iframe, url);
      renderTabs();
    }

    iframe.addEventListener('load', () => {
      loading.classList.add('hidden');
      const t = current();
      try {
        const docTitle = iframe.contentDocument?.title;
        if (docTitle) t.title = docTitle;
      } catch {
        // cross-origin
        if (!t.title || t.title === 'Loading…') t.title = 'Page';
      }
      setWindowTitle(win.id, displayTitle(t.title, t.url, { appName: 'Microsoft Edge' }));
      renderTabs();
    });

    omnibox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // When URLs are hidden, user types a new destination — navigate that
        navigate(omnibox.value);
      }
    });
    // Prevent accidental reveal: if hideUrls, don't show real URL on focus
    omnibox.addEventListener('focus', () => {
      if (getCloakSettings().hideUrls) {
        omnibox.select();
      }
    });

    chrome.querySelector('[data-nav="back"]').addEventListener('click', () => {
      const t = current();
      if (t.idx > 0) {
        t.idx--;
        t.url = t.history[t.idx];
        iframe.src = t.url;
        hardenIframe(iframe, t.url);
        omnibox.value = getCloakSettings().hideUrls ? displayUrl(t.url) : t.url;
      }
    });
    chrome.querySelector('[data-nav="fwd"]').addEventListener('click', () => {
      const t = current();
      if (t.idx < t.history.length - 1) {
        t.idx++;
        t.url = t.history[t.idx];
        iframe.src = t.url;
        hardenIframe(iframe, t.url);
        omnibox.value = getCloakSettings().hideUrls ? displayUrl(t.url) : t.url;
      }
    });
    chrome.querySelector('[data-nav="reload"]').addEventListener('click', () => {
      const t = current();
      if (t.url) {
        loading.classList.remove('hidden');
        iframe.src = t.url;
      }
    });
    chrome.querySelector('[data-nav="home"]').addEventListener('click', () => {
      navigate(settings.homepage || 'https://duckduckgo.com');
    });
    chrome.querySelector('#new-tab-btn').addEventListener('click', () => {
      state.tabs.push({ title: 'New Tab', url: '', history: [], idx: -1 });
      switchTab(state.tabs.length - 1);
    });

    if (startUrl) navigate(startUrl);
    else renderTabs();

    return win;
  });
}

function openWebApp(app) {
  return focusOrCreate(app.id, () => {
    const cloak = app.cloak !== false && getCloakSettings().hideUrls;
    const title = safeAppLabel(app);
    const win = createWindow({
      title,
      icon: app.icon || '📦',
      appId: app.id,
      width: 1000,
      height: 650,
    });

    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:100%;height:100%;position:relative';
    const loading = document.createElement('div');
    loading.className = 'browser-loading';
    loading.textContent = 'Loading…';
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', DEFAULT_SANDBOX);
    iframe.setAttribute('allow', DEFAULT_ALLOW);
    iframe.allowFullscreen = true;
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:#fff';
    wrap.appendChild(loading);
    wrap.appendChild(iframe);
    win.body.appendChild(wrap);

    iframe.addEventListener('load', () => {
      loading.style.display = 'none';
      setWindowTitle(win.id, title);
    });

    if (app.url) {
      iframe.src = app.url;
      hardenIframe(iframe, app.url);
    }
    return win;
  });
}

/* ─── Settings ─── */
function openSettings() {
  return focusOrCreate('app-settings', () => {
    const win = createWindow({
      title: 'Settings',
      icon: '⚙️',
      appId: 'app-settings',
      width: 920,
      height: 640,
    });

    const root = document.createElement('div');
    root.className = 'settings-app';
    root.innerHTML = `
      <div class="settings-nav">
        <div class="settings-nav-item active" data-panel="system">💻 System</div>
        <div class="settings-nav-item" data-panel="personalization">🎨 Personalization</div>
        <div class="settings-nav-item" data-panel="privacy">🔒 Privacy & Cloaking</div>
        <div class="settings-nav-item" data-panel="apps">📦 Apps</div>
        <div class="settings-nav-item" data-panel="about">ℹ️ About</div>
      </div>
      <div class="settings-content" id="settings-panel"></div>
    `;
    win.body.appendChild(root);

    const panel = root.querySelector('#settings-panel');
    const nav = root.querySelectorAll('.settings-nav-item');

    function show(name) {
      nav.forEach((n) => n.classList.toggle('active', n.dataset.panel === name));
      if (name === 'system') {
        panel.innerHTML = `
          <h2>System</h2>
          <div class="settings-group">
            <div class="settings-row">
              <div><label>Search engine</label><div class="desc">Used when you type a query in the address bar</div></div>
              <select id="set-search">
                <option value="https://duckduckgo.com/?q=%s">DuckDuckGo</option>
                <option value="https://www.google.com/search?q=%s">Google</option>
                <option value="https://www.bing.com/search?q=%s">Bing</option>
                <option value="https://search.brave.com/search?q=%s">Brave</option>
              </select>
            </div>
            <div class="settings-row">
              <div><label>Homepage</label><div class="desc">Leave blank for DuckDuckGo</div></div>
              <input type="text" id="set-home" placeholder="https://…" />
            </div>
          </div>
        `;
        panel.querySelector('#set-search').value = settings.searchEngine;
        panel.querySelector('#set-home').value = settings.homepage || '';
        panel.querySelector('#set-search').onchange = (e) => {
          settings.searchEngine = e.target.value;
          saveSettings();
        };
        panel.querySelector('#set-home').onchange = (e) => {
          settings.homepage = e.target.value;
          saveSettings();
        };
      } else if (name === 'personalization') {
        panel.innerHTML = `
          <h2>Personalization</h2>
          <div class="settings-group">
            <div class="settings-row">
              <div><label>Desktop wallpaper URL</label></div>
              <input type="text" id="set-wall" placeholder="https://…/image.jpg" style="min-width:260px" />
            </div>
            <div class="settings-row">
              <div><label>Apply wallpaper</label></div>
              <button class="tb-btn" id="apply-wall" style="width:auto;padding:6px 14px;background:rgba(96,205,255,.2);border-radius:6px">Apply</button>
            </div>
          </div>
        `;
        panel.querySelector('#apply-wall').onclick = () => {
          const url = panel.querySelector('#set-wall').value.trim();
          const bg = document.getElementById('desktop-bg');
          if (url) {
            bg.style.setProperty('--wallpaper', `url("${url}")`);
            bg.classList.add('has-image');
            bg.style.backgroundImage = `url("${url}")`;
          } else {
            bg.classList.remove('has-image');
            bg.style.backgroundImage = '';
          }
          settings.wallpaper = url;
          saveSettings();
        };
      } else if (name === 'privacy') {
        panel.innerHTML = `
          <h2>Privacy & Cloaking</h2>
          <div class="settings-group">
            <div class="settings-row">
              <div><label>Permanently hide URLs</label><div class="desc">Omnibox, titles, menus never show real URLs</div></div>
              <input type="checkbox" id="set-hide" />
            </div>
            <div class="settings-row">
              <div><label>Cloak title</label></div>
              <input type="text" id="set-ctitle" />
            </div>
            <div class="settings-row">
              <div><label>Cloak favicon URL</label></div>
              <input type="text" id="set-cfav" />
            </div>
            <div class="settings-row">
              <div><label>Anti-Blocksi</label><div class="desc">Stomp detection attributes on iframes</div></div>
              <input type="checkbox" id="set-blocksi" />
            </div>
          </div>
        `;
        const cs = getCloakSettings();
        panel.querySelector('#set-hide').checked = cs.hideUrls;
        panel.querySelector('#set-ctitle').value = cs.cloakTitle || 'Google';
        panel.querySelector('#set-cfav').value = cs.cloakFavicon || '';
        panel.querySelector('#set-blocksi').checked = cs.antiBlocksi;
        panel.querySelector('#set-hide').onchange = (e) => {
          settings.hideUrls = e.target.checked;
          import('./cloak.js').then((m) => m.configureCloak({ hideUrls: e.target.checked }));
          saveSettings();
        };
        panel.querySelector('#set-ctitle').onchange = (e) => {
          settings.cloakTitle = e.target.value;
          import('./cloak.js').then((m) => m.configureCloak({ cloakTitle: e.target.value }));
          saveSettings();
        };
        panel.querySelector('#set-cfav').onchange = (e) => {
          settings.cloakFavicon = e.target.value;
          import('./cloak.js').then((m) => m.configureCloak({ cloakFavicon: e.target.value }));
          saveSettings();
        };
        panel.querySelector('#set-blocksi').onchange = (e) => {
          import('./cloak.js').then((m) => m.configureCloak({ antiBlocksi: e.target.checked }));
          saveSettings();
        };
      } else if (name === 'apps') {
        panel.innerHTML = `
          <h2>Apps</h2>
          <div class="settings-group" id="apps-list-set"></div>
          <div class="settings-group" style="margin-top:12px;padding:16px">
            <strong style="font-size:13px">Install web app</strong>
            <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
              <input type="text" id="inst-name" placeholder="Name" />
              <input type="text" id="inst-url" placeholder="https://…" />
              <input type="text" id="inst-icon" placeholder="Icon (emoji)" />
              <label style="font-size:12px"><input type="checkbox" id="inst-cloak" checked /> Cloak / hide URL</label>
              <button id="inst-go" style="padding:8px;background:rgba(96,205,255,.25);border-radius:6px">Install</button>
            </div>
          </div>
        `;
        const list = panel.querySelector('#apps-list-set');
        apps.forEach((a) => {
          const row = document.createElement('div');
          row.className = 'settings-row';
          row.innerHTML = `<div><label>${a.icon || ''} ${a.name}</label><div class="desc">${a.type}</div></div>`;
          list.appendChild(row);
        });
        panel.querySelector('#inst-go').onclick = async () => {
          const name = panel.querySelector('#inst-name').value.trim();
          const url = panel.querySelector('#inst-url').value.trim();
          const icon = panel.querySelector('#inst-icon').value.trim() || '📦';
          const cloak = panel.querySelector('#inst-cloak').checked;
          if (!name || !url) return;
          await installApp({ name, url, icon, cloak, type: 'web', pinned: true });
          show('apps');
          toast('App installed');
        };
      } else if (name === 'about') {
        panel.innerHTML = `
          <h2>About n3xn OS</h2>
          <div class="settings-group">
            <div class="settings-row"><div><label>Version</label></div><span>2.0.0</span></div>
            <div class="settings-row"><div><label>UI</label></div><span>Windows 11 Fluent</span></div>
            <div class="settings-row"><div><label>WASM</label></div><span id="wasm-status">…</span></div>
            <div class="settings-row"><div><label>Engine</label></div><span>Multi-file modular · IndexedDB</span></div>
          </div>
          <p style="margin-top:16px;font-size:12px;color:var(--text-tertiary)">
            Rebuilt to be better than classic browser OS demos — true URL cloaking, real WASM acceleration, working apps list.
          </p>
        `;
        import('./wasm/engine.js').then((m) => {
          panel.querySelector('#wasm-status').textContent = m.isWasmReady() ? 'Active' : 'JS fallback';
        });
      }
    }

    nav.forEach((n) => n.addEventListener('click', () => show(n.dataset.panel)));
    show('system');
    return win;
  });
}

async function saveSettings() {
  await db.put('settings', { id: 'main', ...settings });
  setAppSettings(settings);
  document.dispatchEvent(new CustomEvent('n3xn:settings', { detail: settings }));
}

export async function loadSettings() {
  const s = await db.get('settings', 'main');
  if (s) {
    settings = { ...settings, ...s };
    setAppSettings(settings);
  }
  return settings;
}

/* ─── Notepad ─── */
function openNotepad() {
  return focusOrCreate('app-notepad', () => {
    const win = createWindow({
      title: 'Untitled - Notepad',
      icon: '📝',
      appId: 'app-notepad',
      width: 700,
      height: 500,
    });
    const root = document.createElement('div');
    root.className = 'notepad-app';
    root.innerHTML = `
      <div class="notepad-toolbar">
        <button data-act="new">New</button>
        <button data-act="save">Download</button>
      </div>
      <textarea class="notepad-area" spellcheck="true" placeholder="Type here…"></textarea>
    `;
    win.body.appendChild(root);
    const ta = root.querySelector('textarea');
    root.querySelector('[data-act="new"]').onclick = () => { ta.value = ''; };
    root.querySelector('[data-act="save"]').onclick = () => {
      const blob = new Blob([ta.value], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'note.txt';
      a.click();
    };
    return win;
  });
}

/* ─── Calculator ─── */
function openCalculator() {
  return focusOrCreate('app-calculator', () => {
    const win = createWindow({
      title: 'Calculator',
      icon: '🧮',
      appId: 'app-calculator',
      width: 320,
      height: 480,
    });
    const root = document.createElement('div');
    root.className = 'calc-app';
    root.innerHTML = `
      <div class="calc-display" id="calc-disp">0</div>
      <div class="calc-grid">
        ${['C','±','%','÷','7','8','9','×','4','5','6','−','1','2','3','+','0','.','='].map((k) => {
          const cls = ['÷','×','−','+'].includes(k) ? 'op' : k === '=' ? 'eq' : '';
          const span = k === '0' ? 'style="grid-column:span 2"' : '';
          return `<button class="calc-btn ${cls}" data-k="${k}" ${span}>${k}</button>`;
        }).join('')}
      </div>
    `;
    win.body.appendChild(root);
    let cur = '0';
    let prev = null;
    let op = null;
    const disp = root.querySelector('#calc-disp');
    root.querySelectorAll('.calc-btn').forEach((btn) => {
      btn.onclick = () => {
        const k = btn.dataset.k;
        if (k >= '0' && k <= '9' || k === '.') {
          cur = cur === '0' && k !== '.' ? k : cur + k;
        } else if (k === 'C') {
          cur = '0'; prev = null; op = null;
        } else if (k === '±') {
          cur = String(-parseFloat(cur));
        } else if (k === '%') {
          cur = String(parseFloat(cur) / 100);
        } else if (['+','−','×','÷'].includes(k)) {
          prev = parseFloat(cur); op = k; cur = '0';
        } else if (k === '=') {
          const a = prev ?? 0;
          const b = parseFloat(cur);
          let r = b;
          if (op === '+') r = a + b;
          if (op === '−') r = a - b;
          if (op === '×') r = a * b;
          if (op === '÷') r = b === 0 ? 'Error' : a / b;
          cur = String(r); prev = null; op = null;
        }
        disp.textContent = cur;
      };
    });
    return win;
  });
}

/* ─── File Explorer ─── */
function openExplorer() {
  return focusOrCreate('app-explorer', () => {
    const win = createWindow({
      title: 'File Explorer',
      icon: '📁',
      appId: 'app-explorer',
      width: 880,
      height: 560,
    });
    const root = document.createElement('div');
    root.className = 'explorer-app';
    root.innerHTML = `
      <div class="explorer-sidebar">
        <div class="explorer-side-item active" data-loc="home">🏠 Home</div>
        <div class="explorer-side-item" data-loc="desktop">🖥️ Desktop</div>
        <div class="explorer-side-item" data-loc="docs">📄 Documents</div>
        <div class="explorer-side-item" data-loc="dl">⬇️ Downloads</div>
        <div class="explorer-side-item" data-loc="pics">🖼️ Pictures</div>
      </div>
      <div class="explorer-main">
        <div class="explorer-toolbar">
          <div class="explorer-path">This PC › Home</div>
        </div>
        <div class="explorer-files" id="explorer-files"></div>
      </div>
    `;
    win.body.appendChild(root);
    const files = {
      home: [
        { name: 'Desktop', icon: '🖥️' },
        { name: 'Documents', icon: '📄' },
        { name: 'Downloads', icon: '⬇️' },
        { name: 'Pictures', icon: '🖼️' },
      ],
      desktop: [
        { name: 'n3xn OS', icon: '💠' },
        { name: 'Readme.txt', icon: '📄' },
      ],
      docs: [
        { name: 'Notes.txt', icon: '📄' },
        { name: 'Project', icon: '📁' },
      ],
      dl: [{ name: 'setup.exe', icon: '📦' }],
      pics: [{ name: 'wallpaper.jpg', icon: '🖼️' }],
    };
    const grid = root.querySelector('#explorer-files');
    const path = root.querySelector('.explorer-path');
    function show(loc) {
      root.querySelectorAll('.explorer-side-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.loc === loc);
      });
      path.textContent = 'This PC › ' + (loc.charAt(0).toUpperCase() + loc.slice(1));
      grid.innerHTML = '';
      (files[loc] || []).forEach((f) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `<div class="fi-icon">${f.icon}</div><div class="fi-name">${f.name}</div>`;
        grid.appendChild(item);
      });
    }
    root.querySelectorAll('.explorer-side-item').forEach((el) => {
      el.addEventListener('click', () => show(el.dataset.loc));
    });
    show('home');
    return win;
  });
}

/* ─── Store ─── */
function openStore() {
  return focusOrCreate('app-store', () => {
    const win = createWindow({
      title: 'Microsoft Store',
      icon: '🛍️',
      appId: 'app-store',
      width: 900,
      height: 600,
    });
    const root = document.createElement('div');
    root.style.cssText = 'padding:24px;height:100%;overflow:auto';
    root.innerHTML = `<h2 style="margin-bottom:16px">Featured apps</h2>`;
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px';
    apps.filter((a) => a.type === 'web').forEach((a) => {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--surface);border-radius:12px;padding:16px;text-align:center;cursor:default;border:1px solid var(--border)';
      card.innerHTML = `<div style="font-size:36px;margin-bottom:8px">${a.icon}</div><div style="font-size:13px;font-weight:500">${a.name}</div>`;
      card.onclick = () => launchApp(a);
      grid.appendChild(card);
    });
    root.appendChild(grid);
    win.body.appendChild(root);
    return win;
  });
}

function toast(msg) {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

export { toast };
