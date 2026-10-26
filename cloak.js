/**
 * n3xn OS — Strict URL cloaking system
 * Never leaks real URLs into the visible UI when hideUrls is enabled.
 * Overrides title, favicon, history display, omnibox, menus, status.
 */

const ZWS = '\u200B';
const INVISIBLE_FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');

const DEFAULTS = {
  hideUrls: true,
  cloakTitle: 'Google',
  cloakFavicon: 'https://www.google.com/favicon.ico',
  invisibleTabs: false,
  antiBlocksi: true,
  blocksiFakeSrc: 'https://www.google.com',
};

let settings = { ...DEFAULTS };

export function configureCloak(opts = {}) {
  settings = { ...settings, ...opts };
}

export function getCloakSettings() {
  return { ...settings };
}

/** Public display name / title for a page — never the real URL when hiding */
export function displayTitle(realTitle, realUrl, opts = {}) {
  if (!settings.hideUrls && !opts.forceCloak) {
    return realTitle || realUrl || 'New Tab';
  }
  if (settings.invisibleTabs || opts.invisible) {
    return ZWS;
  }
  const cloak = opts.cloakTitle || settings.cloakTitle || 'Google';
  // Prefer a clean app name if provided
  if (opts.appName) return opts.appName;
  return cloak;
}

/** Favicon that is safe to show */
export function displayFavicon(realFavicon, opts = {}) {
  if (!settings.hideUrls && !opts.forceCloak) {
    return realFavicon || '';
  }
  if (settings.invisibleTabs || opts.invisible) {
    return INVISIBLE_FAVICON;
  }
  return opts.cloakFavicon || settings.cloakFavicon || DEFAULTS.cloakFavicon;
}

/** Omnibox / address bar content — never the real URL when hiding */
export function displayUrl(realUrl, opts = {}) {
  if (!settings.hideUrls && !opts.forceCloak) {
    return realUrl || '';
  }
  // Show a neutral placeholder or the cloak domain only
  if (opts.placeholder) return opts.placeholder;
  try {
    const u = new URL(settings.cloakFavicon || 'https://www.google.com');
    return u.origin + '/';
  } catch {
    return 'https://www.google.com/';
  }
}

/** Sanitize any string that might contain a URL before putting it in the DOM */
export function sanitizeForUI(text) {
  if (!settings.hideUrls || !text) return text || '';
  // Strip common URL patterns so they never appear in menus, tooltips, etc.
  return String(text)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[hidden]')
    .replace(/www\.[^\s"'<>]+/gi, '[hidden]');
}

/** Apply anti-Blocksi attributes on an iframe element */
export function hardenIframe(iframe, realSrc) {
  if (!iframe) return;
  if (settings.antiBlocksi) {
    try {
      iframe.setAttribute('data-blocksi-src', settings.blocksiFakeSrc || DEFAULTS.blocksiFakeSrc);
      iframe.setAttribute('data-blocksi-processed', 'true');
      // Periodic stomp in case extensions rewrite attributes
      if (!iframe.__n3xnBlocksiTimer) {
        iframe.__n3xnBlocksiTimer = setInterval(() => {
          if (!iframe.isConnected) {
            clearInterval(iframe.__n3xnBlocksiTimer);
            return;
          }
          if (settings.antiBlocksi) {
            iframe.setAttribute('data-blocksi-src', settings.blocksiFakeSrc || DEFAULTS.blocksiFakeSrc);
            iframe.setAttribute('data-blocksi-processed', 'true');
          }
        }, 50);
      }
    } catch {}
  }
  // Never leave real URL in title attributes
  iframe.removeAttribute('title');
  iframe.removeAttribute('aria-label');
}

/** Build a cloaked about:blank bootstrap document that then navigates */
export function buildCloakBootstrap(targetUrl, cloakTitle) {
  const t = (cloakTitle || settings.cloakTitle || 'Google').replace(/</g, '&lt;');
  // Use a data URL or about:blank + postMessage style; simplest reliable:
  // load about:blank then set location via script after identity is set.
  return `about:blank`;
}

/** After iframe loads about:blank, navigate it while keeping document title cloaked */
export function navigateCloaked(iframe, targetUrl) {
  if (!iframe) return;
  try {
    const doc = iframe.contentDocument;
    if (doc) {
      doc.title = settings.cloakTitle || 'Google';
      // Prefer location.replace to avoid history pollution with real URL in some browsers
      iframe.contentWindow.location.replace(targetUrl);
    } else {
      iframe.src = targetUrl;
    }
  } catch {
    // Cross-origin after navigation — expected
    iframe.src = targetUrl;
  }
  hardenIframe(iframe, targetUrl);
}

/** Strip URL from window title / document when hide is on */
export function protectDocumentTitle() {
  if (!settings.hideUrls) return;
  const desired = settings.invisibleTabs ? ZWS : (settings.cloakTitle || 'Google');
  if (document.title !== desired) {
    document.title = desired;
  }
  // Keep a MutationObserver / interval light touch
  if (!window.__n3xnTitleGuard) {
    window.__n3xnTitleGuard = setInterval(() => {
      if (!settings.hideUrls) return;
      const d = settings.invisibleTabs ? ZWS : (settings.cloakTitle || 'Google');
      if (document.title !== d) document.title = d;
    }, 400);
  }
}

/** Safe label for taskbar / start menu — never a URL */
export function safeAppLabel(app) {
  if (!app) return 'App';
  if (app.name) return app.name;
  if (settings.hideUrls) return settings.cloakTitle || 'App';
  return app.url || 'App';
}
