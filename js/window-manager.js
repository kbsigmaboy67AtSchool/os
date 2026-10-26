/**
 * n3xn OS — Window Manager (Windows 11 style)
 */

import { displayTitle, displayFavicon, safeAppLabel } from './cloak.js';

let zCounter = 100;
const windows = new Map(); // id -> state
let focusedId = null;
let host = null;

export function initWindowManager(hostEl) {
  host = hostEl;
}

export function getWindows() {
  return windows;
}

export function getFocused() {
  return focusedId ? windows.get(focusedId) : null;
}

function nextZ() {
  return ++zCounter;
}

function focusWindow(id) {
  if (focusedId && windows.has(focusedId)) {
    const prev = windows.get(focusedId);
    if (prev.el) prev.el.classList.remove('focused');
  }
  focusedId = id;
  const w = windows.get(id);
  if (w && w.el) {
    w.el.classList.add('focused');
    w.el.style.zIndex = nextZ();
    w.minimized = false;
    w.el.classList.remove('minimized');
  }
  // Notify taskbar
  document.dispatchEvent(new CustomEvent('n3xn:focus', { detail: { id } }));
}

export function createWindow(opts = {}) {
  const id = opts.id || `win-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const title = opts.title || 'Window';
  const icon = opts.icon || '📄';
  const width = opts.width || 900;
  const height = opts.height || 600;
  const x = opts.x ?? Math.max(40, (window.innerWidth - width) / 2 + (windows.size % 5) * 24);
  const y = opts.y ?? Math.max(40, (window.innerHeight - 48 - height) / 2 + (windows.size % 5) * 24);

  const el = document.createElement('div');
  el.className = 'app-window focused';
  el.dataset.winId = id;
  el.style.width = width + 'px';
  el.style.height = height + 'px';
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.zIndex = nextZ();

  el.innerHTML = `
    <div class="win-titlebar">
      <span class="win-icon">${icon}</span>
      <span class="win-title"></span>
      <div class="win-controls">
        <button class="win-ctrl min" title="Minimize">─</button>
        <button class="win-ctrl max" title="Maximize">☐</button>
        <button class="win-ctrl close" title="Close">✕</button>
      </div>
    </div>
    <div class="win-body"></div>
    <div class="resize-handle n"></div>
    <div class="resize-handle s"></div>
    <div class="resize-handle e"></div>
    <div class="resize-handle w"></div>
    <div class="resize-handle ne"></div>
    <div class="resize-handle nw"></div>
    <div class="resize-handle se"></div>
    <div class="resize-handle sw"></div>
  `;

  const titleEl = el.querySelector('.win-title');
  titleEl.textContent = title;

  const body = el.querySelector('.win-body');
  if (opts.content) {
    if (typeof opts.content === 'string') body.innerHTML = opts.content;
    else if (opts.content instanceof Node) body.appendChild(opts.content);
  }

  // Controls
  el.querySelector('.win-ctrl.min').addEventListener('click', (e) => {
    e.stopPropagation();
    minimizeWindow(id);
  });
  el.querySelector('.win-ctrl.max').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMaximize(id);
  });
  el.querySelector('.win-ctrl.close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeWindow(id);
  });

  // Focus on pointer down
  el.addEventListener('pointerdown', () => focusWindow(id));

  // Drag
  const titlebar = el.querySelector('.win-titlebar');
  let drag = null;
  titlebar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.win-ctrl')) return;
    const w = windows.get(id);
    if (w?.maximized) return;
    drag = {
      ox: e.clientX - el.offsetLeft,
      oy: e.clientY - el.offsetTop,
    };
    titlebar.setPointerCapture(e.pointerId);
  });
  titlebar.addEventListener('pointermove', (e) => {
    if (!drag) return;
    el.style.left = Math.max(-el.offsetWidth + 80, e.clientX - drag.ox) + 'px';
    el.style.top = Math.max(0, e.clientY - drag.oy) + 'px';
  });
  titlebar.addEventListener('pointerup', () => { drag = null; });
  titlebar.addEventListener('dblclick', () => toggleMaximize(id));

  // Resize
  setupResize(el, id);

  host.appendChild(el);

  const state = {
    id,
    el,
    body,
    title,
    icon,
    appId: opts.appId || null,
    maximized: false,
    minimized: false,
    restore: { x, y, w: width, h: height },
    onClose: opts.onClose || null,
  };
  windows.set(id, state);
  focusWindow(id);
  document.dispatchEvent(new CustomEvent('n3xn:window-open', { detail: { id, appId: state.appId } }));
  return state;
}

function setupResize(el, id) {
  const dirs = {
    n:  { t: 1, l: 0, b: 0, r: 0 },
    s:  { t: 0, l: 0, b: 1, r: 0 },
    e:  { t: 0, l: 0, b: 0, r: 1 },
    w:  { t: 0, l: 1, b: 0, r: 0 },
    ne: { t: 1, l: 0, b: 0, r: 1 },
    nw: { t: 1, l: 1, b: 0, r: 0 },
    se: { t: 0, l: 0, b: 1, r: 1 },
    sw: { t: 0, l: 1, b: 1, r: 0 },
  };
  for (const [cls, d] of Object.entries(dirs)) {
    const handle = el.querySelector(`.resize-handle.${cls}`);
    if (!handle) continue;
    let start = null;
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const w = windows.get(id);
      if (w?.maximized) return;
      start = {
        x: e.clientX,
        y: e.clientY,
        left: el.offsetLeft,
        top: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
        d,
      };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      let left = start.left;
      let top = start.top;
      let w = start.w;
      let h = start.h;
      if (start.d.r) w = Math.max(320, start.w + dx);
      if (start.d.b) h = Math.max(200, start.h + dy);
      if (start.d.l) {
        w = Math.max(320, start.w - dx);
        left = start.left + (start.w - w);
      }
      if (start.d.t) {
        h = Math.max(200, start.h - dy);
        top = start.top + (start.h - h);
      }
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
    });
    handle.addEventListener('pointerup', () => { start = null; });
  }
}

export function minimizeWindow(id) {
  const w = windows.get(id);
  if (!w) return;
  w.minimized = true;
  w.el.classList.add('minimized');
  if (focusedId === id) focusedId = null;
  document.dispatchEvent(new CustomEvent('n3xn:window-min', { detail: { id } }));
}

export function restoreWindow(id) {
  const w = windows.get(id);
  if (!w) return;
  w.minimized = false;
  w.el.classList.remove('minimized');
  focusWindow(id);
}

export function toggleMaximize(id) {
  const w = windows.get(id);
  if (!w) return;
  if (w.maximized) {
    w.maximized = false;
    w.el.classList.remove('maximized');
    w.el.style.left = w.restore.x + 'px';
    w.el.style.top = w.restore.y + 'px';
    w.el.style.width = w.restore.w + 'px';
    w.el.style.height = w.restore.h + 'px';
  } else {
    w.restore = {
      x: w.el.offsetLeft,
      y: w.el.offsetTop,
      w: w.el.offsetWidth,
      h: w.el.offsetHeight,
    };
    w.maximized = true;
    w.el.classList.add('maximized');
  }
}

export function closeWindow(id) {
  const w = windows.get(id);
  if (!w) return;
  if (typeof w.onClose === 'function') {
    try { w.onClose(); } catch {}
  }
  w.el.remove();
  windows.delete(id);
  if (focusedId === id) focusedId = null;
  document.dispatchEvent(new CustomEvent('n3xn:window-close', { detail: { id, appId: w.appId } }));
}

export function setWindowTitle(id, title) {
  const w = windows.get(id);
  if (!w) return;
  w.title = title;
  const el = w.el.querySelector('.win-title');
  if (el) el.textContent = title;
}

export function focusOrCreate(appId, factory) {
  for (const [id, w] of windows) {
    if (w.appId === appId && !w.minimized) {
      focusWindow(id);
      return w;
    }
    if (w.appId === appId && w.minimized) {
      restoreWindow(id);
      return w;
    }
  }
  return factory();
}

export function minimizeAll() {
  for (const [id] of windows) minimizeWindow(id);
}
