'use strict';
// Vercel Web Analytics configuration. Loaded (defer) before /_vercel/insights/script.js,
// so the beforeSend hook is queued before the first pageview is sent.
//
// Owner traffic exclusion: a browser opted out on the unlisted owner opt-out page carries
// localStorage "va-disable" (Vercel's documented opt-out key) and/or a first-party
// "va_disable" cookie shared across arcyusdc.xyz and www.arcyusdc.xyz. Every event
// from such a browser is dropped (beforeSend returns null). Other visitors are unaffected.
(function () {
  var KEY = 'va-disable';
  var COOKIE = 'va_disable';
  var MAX_AGE = 60 * 60 * 24 * 400; // 400 days, the browser maximum for cookie lifetime

  function sharedDomain() {
    var host = location.hostname;
    return host === 'arcyusdc.xyz' || /\.arcyusdc\.xyz$/.test(host) ? '; Domain=arcyusdc.xyz' : '';
  }
  function readStorage() {
    try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; }
  }
  function readCookie() {
    try { return (';' + document.cookie).replace(/\s+/g, '').indexOf(';' + COOKIE + '=1') !== -1; } catch (_) { return false; }
  }
  function writeCookie(value, maxAge) {
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    try {
      document.cookie = COOKIE + '=' + value + '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax' + secure + sharedDomain();
      // Also clear/set any host-only copy so www and apex never disagree.
      if (sharedDomain()) document.cookie = COOKIE + '=' + value + '; Path=/; Max-Age=' + maxAge + '; SameSite=Lax' + secure;
    } catch (_) {}
  }
  function isExcluded() { return readStorage() || readCookie(); }
  function exclude() {
    try { localStorage.setItem(KEY, '1'); } catch (_) {}
    writeCookie('1', MAX_AGE);
    return isExcluded();
  }
  function include() {
    try { localStorage.removeItem(KEY); } catch (_) {}
    writeCookie('', 0);
    return !isExcluded();
  }

  // Keep both stores in sync (e.g. opted out on apex, now visiting www).
  if (isExcluded()) exclude();

  window.arcyAnalyticsOptOut = { isExcluded: isExcluded, exclude: exclude, include: include };

  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  window.va('beforeSend', function (event) {
    if (isExcluded()) return null;
    if (navigator.doNotTrack === '1') return null;
    try { var url = new URL(event.url); url.search = ''; url.hash = ''; return Object.assign({}, event, { url: url.href }); }
    catch (_) { return null; }
  });
})();
