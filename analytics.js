'use strict';
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
window.va('beforeSend', function (event) {
  if (navigator.doNotTrack === '1') return null;
  try { var url = new URL(event.url); url.search = ''; url.hash = ''; return Object.assign({}, event, { url: url.href }); }
  catch (_) { return null; }
});
