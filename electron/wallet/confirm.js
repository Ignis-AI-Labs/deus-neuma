// Renderer for the trusted wallet-confirmation window. Loaded as an external
// file (never inline) so the page CSP can forbid inline script entirely —
// belt-and-suspenders against any future injection. Every view-model field is
// attacker-controllable (the sign request comes from a possibly-compromised
// renderer), so EVERYTHING is written via textContent / createElement and NEVER
// innerHTML: injected markup can only ever appear as literal text, never run.
(function () {
  'use strict';
  var settled = false;
  function done(ok) {
    if (settled) return;
    settled = true;
    try { window.neumaConfirm.resolve(ok === true); } catch (e) { /* window tearing down */ }
  }
  function txt(el, s) { el.textContent = s == null ? '' : String(s); }

  // THE LOOK, re-validated here (defense in depth -- the theme crossed IPC):
  // four strict hexes or nothing. Cosmetic root vars only; --alert is
  // semantic and never themed, so a warning can never be dressed quiet.
  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    function ok(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v); }
    if (!(ok(theme.ground) && ok(theme.panel) && ok(theme.ink) && ok(theme.trim))) return;
    function rgba(hex, a) {
      return 'rgba(' + parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) + ','
        + parseInt(hex.slice(5, 7), 16) + ',' + a + ')';
    }
    var s = document.documentElement.style;
    s.setProperty('--void', theme.ground);
    s.setProperty('--ground', theme.ground);
    s.setProperty('--panel', theme.panel);
    s.setProperty('--ink', theme.ink);
    s.setProperty('--signal', theme.trim);
    s.setProperty('--line', rgba(theme.ink, 0.18));
    s.setProperty('--line-hover', rgba(theme.ink, 0.4));
    s.setProperty('--text-1', rgba(theme.ink, 0.95));
    s.setProperty('--text-2', rgba(theme.ink, 0.7));
    s.setProperty('--text-3', rgba(theme.ink, 0.5));
    if (typeof theme.head === 'string' && /^#[0-9a-fA-F]{6}$/.test(theme.head)) {
      s.setProperty('--heading', theme.head);
    }
  }

  function render(v) {
    if (!v) { done(false); return; }
    applyTheme(v.theme);
    if (v.tone === 'alert') document.body.classList.add('tone-alert');
    txt(document.getElementById('kindTag'), v.kind === 'gate' ? 'CONFIRM' : 'SIGNATURE REQUEST');
    txt(document.getElementById('headingText'), v.heading || 'CONFIRM');
    var intro = document.getElementById('intro');
    if (v.intro) txt(intro, v.intro); else intro.hidden = true;

    if (Array.isArray(v.fields) && v.fields.length) {
      var f = document.getElementById('fields');
      f.hidden = false;
      v.fields.forEach(function (row) {
        var wrap = document.createElement('div'); wrap.className = 'field';
        var k = document.createElement('div'); k.className = 'k'; txt(k, row.label);
        var val = document.createElement('div'); val.className = 'v'; txt(val, row.value);
        wrap.appendChild(k); wrap.appendChild(val); f.appendChild(wrap);
      });
    }
    if (v.body) { var b = document.getElementById('body'); b.hidden = false; txt(b, v.body); }
    if (v.warning) {
      document.getElementById('warn').hidden = false;
      txt(document.getElementById('warnText'), v.warning);
    }
    txt(document.getElementById('confirm'), v.confirmLabel || 'Sign');
    txt(document.getElementById('reject'), v.rejectLabel || 'Reject');
  }

  document.getElementById('reject').addEventListener('click', function () { done(false); });
  document.getElementById('confirm').addEventListener('click', function () { done(true); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') done(false);
    else if (e.key === 'Enter' && document.activeElement === document.getElementById('confirm')) done(true);
  });

  // Default focus lands on Reject -- approval always takes a deliberate act.
  document.getElementById('reject').focus();

  window.neumaConfirm.view().then(render).catch(function () { done(false); });
})();
