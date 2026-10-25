/* Clocktower Companion: things every app shares.
   A settings button (⚙) in the top bar opens: undo, text size, light or dark, keep the screen awake,
   the Trouble Brewing character sheet, saving a game to a file or loading one, and installing the apps.
   Tapping a character's name anywhere (outside buttons and forms) shows what it does.
   Each app saves its game in this browser; undo and backups work on those saved games. */
(function () {
  'use strict';

  // Each app's saved game, plus its own preferences
  const APPS = {
    'good.html': { name: 'Clocktower Notebook', game: 'clocktower-notebook-v1', keys: ['clocktower-notebook-v1', 'clocktower-notebook-tab'], simple: 'Hides World building (the possible-worlds maths) and the script picker, and makes the buttons bigger.' },
    'evil.html': { name: 'Evil Grimoire', game: 'clocktower-evil-v1', keys: ['clocktower-evil-v1', 'clocktower-evil-tab'], simple: "Hides the analysis cards (how the team is doing, story checks, who you've told what, where the game stands, careful, everyone's likely character) and makes the buttons bigger." },
    'storyteller.html': { name: "Storyteller's Grimoire", game: 'botc-storyteller-v1', keys: ['botc-storyteller-v1', 'botc-storyteller-v1-tab'] },
    'clockwork-storyteller.html': { name: 'Clockwork Storyteller', game: 'clockwork-storyteller-v1', keys: ['clockwork-storyteller-v1', 'clockwork-storyteller-prefs'] },
    'solo.html': { name: 'Solo Practice', game: 'clocktower-solo-v1', keys: ['clocktower-solo-v1', 'clocktower-solo-prefs'] },
  };
  const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const app = APPS[page] || null;
  const PREFS = 'clocktower-companion-prefs';

  /* ---------- Preferences shared by every app ---------- */
  let prefs = { theme: 'auto', zoom: 1, awake: true };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS)) || {}); } catch (e) {}
  // The Clockwork Storyteller and Solo Practice used to have their own text size: carry it over once
  if (!prefs.migrated) {
    ['clockwork-storyteller-prefs', 'clocktower-solo-prefs'].forEach(k => { try { const o = JSON.parse(localStorage.getItem(k)); if (o && o.text > 1 && prefs.zoom === 1) prefs.zoom = o.text >= 1.4 ? 1.3 : 1.15; } catch (e) {} });
    prefs.migrated = true;
    try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) {}
  }
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) {} apply(); };
  // Simple mode (Notebook and Evil Grimoire): on for someone new, off for anyone already mid-game
  if (app && app.simple && prefs['simple:' + page] == null) {
    prefs['simple:' + page] = !localStorage.getItem(app.game);
    try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) {}
  }
  function applyLook() {
    const root = document.documentElement;
    root.classList.toggle('simple', !!(app && app.simple && prefs['simple:' + page]));
    if (prefs.theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', prefs.theme);
    root.style.zoom = prefs.zoom === 1 ? '' : String(prefs.zoom);
  }
  applyLook();
  function apply() {
    applyLook();
    const root = document.documentElement;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(document.body || root).backgroundColor || '#15121b';
    wake();
  }

  /* ---------- Undo: every change to the saved game can be stepped back ---------- */
  // The app saves its game to localStorage; we keep the earlier versions (for this visit) and can put one back.
  const UNDO = 'clocktower-undo:' + page;
  let stack = [];
  try { stack = JSON.parse(sessionStorage.getItem(UNDO)) || []; } catch (e) {}
  let blocked = false, lastPush = 0, typingAt = 0, lastTyping = false;
  // Typing in a box saves on every key: those saves count as one step
  document.addEventListener('input', e => { if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'file') typingAt = Date.now(); }, true);
  const rawSet = Storage.prototype.setItem;
  if (app) {
    Storage.prototype.setItem = function (k, v) {
      if (this === localStorage && k === app.game) {
        if (blocked) return;  // an undo is reloading the page: don't let a last-moment save overwrite it
        const old = localStorage.getItem(k);
        if (old !== v && old != null) {
          const typing = Date.now() - typingAt < 1500;
          if (!(typing && lastTyping && Date.now() - lastPush < 4000) || !stack.length) {
            stack.push(old);
            if (stack.length > 40) stack.shift();
          }
          lastPush = Date.now(); lastTyping = typing;
        }
      }
      return rawSet.call(this, k, v);
    };
  }
  // The history lives in memory, and is written down only when the page goes away (so it survives a reload)
  function keepStack() {
    let s = stack.slice(), json = JSON.stringify(s);
    while (json.length > 3e6 && s.length > 1) { s = s.slice(Math.ceil(s.length / 4)); json = JSON.stringify(s); }
    try { sessionStorage.setItem(UNDO, json); } catch (e) { try { sessionStorage.setItem(UNDO, JSON.stringify(s.slice(-3))); } catch (e2) {} }
  }
  addEventListener('pagehide', keepStack);
  document.addEventListener('visibilitychange', () => { if (document.hidden) keepStack(); });
  function undo() {
    if (!stack.length) return;
    const prev = stack.pop();
    keepStack();
    rawSet.call(localStorage, app.game, prev);
    blocked = true;
    location.reload();
  }

  /* ---------- Keep the screen awake while an app is open ---------- */
  let lock = null;
  async function wake() {
    try {
      if (prefs.awake && app && 'wakeLock' in navigator && document.visibilityState === 'visible' && !lock) {
        lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { lock = null; });
      } else if ((!prefs.awake || !app) && lock) { await lock.release(); lock = null; }
    } catch (e) { lock = null; }
  }
  document.addEventListener('visibilitychange', wake);

  /* ---------- Save a game to a file, or load one ---------- */
  function exportGame() {
    const data = {};
    app.keys.forEach(k => { const v = localStorage.getItem(k); if (v != null) data[k] = v; });
    const blob = new Blob([JSON.stringify({ app: page, name: app.name, saved: new Date().toISOString(), data }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${app.name.replace(/[^A-Za-z]+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function importGame(file) {
    const r = new FileReader();
    r.onload = () => {
      let o;
      try { o = JSON.parse(r.result); } catch (e) { return note('That file isn\'t a saved game.'); }
      if (!o || !o.data || o.app !== page) return note(o && o.name ? `That's a ${o.name} game. Open it in that app.` : 'That file isn\'t a saved game for this app.');
      const cur = localStorage.getItem(app.game);
      if (cur != null) { stack.push(cur); keepStack(); }
      Object.keys(o.data).forEach(k => { if (app.keys.includes(k)) rawSet.call(localStorage, k, o.data[k]); });
      blocked = true;
      location.reload();
    };
    r.readAsText(file);
  }

  /* ---------- Install (Android shows a prompt; iPhone uses Share → Add to Home Screen) ---------- */
  let installEvt = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (open) render(); });
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});

  /* ---------- Trouble Brewing character sheet ---------- */
  const SHEET = [
    ['townsfolk', 'Townsfolk', [
      ['Washerwoman', 'You start knowing that 1 of 2 players is a particular Townsfolk.'],
      ['Librarian', 'You start knowing that 1 of 2 players is a particular Outsider. (Or that zero are in play.)'],
      ['Investigator', 'You start knowing that 1 of 2 players is a particular Minion.'],
      ['Chef', 'You start knowing how many pairs of evil players there are.'],
      ['Empath', 'Each night, you learn how many of your 2 alive neighbours are evil.'],
      ['Fortune Teller', 'Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you.'],
      ['Undertaker', 'Each night*, you learn which character died by execution today.'],
      ['Monk', 'Each night*, choose a player (not yourself): they are safe from the Demon tonight.'],
      ['Ravenkeeper', 'If you die at night, you are woken to choose a player: you learn their character.'],
      ['Virgin', 'The 1st time you are nominated, if the nominator is a Townsfolk, they are executed immediately.'],
      ['Slayer', 'Once per game, during the day, publicly choose a player: if they are the Demon, they die.'],
      ['Soldier', 'You are safe from the Demon.'],
      ['Mayor', 'If only 3 players live & no execution occurs, your team wins. If you die at night, another player might die instead.'],
    ]],
    ['outsider', 'Outsiders', [
      ['Butler', 'Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too.'],
      ['Drunk', 'You do not know you are the Drunk. You think you are a Townsfolk character, but you are not.'],
      ['Recluse', 'You might register as evil & as a Minion or Demon, even if dead.'],
      ['Saint', 'If you die by execution, your team loses.'],
    ]],
    ['minion', 'Minions', [
      ['Poisoner', 'Each night, choose a player: they are poisoned tonight and tomorrow day.'],
      ['Spy', 'Each night, you see the Grimoire. You might register as good & as a Townsfolk or Outsider, even if dead.'],
      ['Scarlet Woman', 'If there are 5 or more players alive & the Demon dies, you become the Demon. (Travellers don\'t count.)'],
      ['Baron', 'There are extra Outsiders in play. [+2 Outsiders]'],
    ]],
    ['demon', 'Demon', [
      ['Imp', 'Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.'],
    ]],
  ];
  const ABILITY = {};
  SHEET.forEach(([team, , rs]) => rs.forEach(([r, t]) => { ABILITY[r.toLowerCase()] = { name: r, team, text: t }; }));
  const COUNTS = { 5: [3, 0, 1], 6: [3, 1, 1], 7: [5, 0, 1], 8: [5, 1, 1], 9: [5, 2, 1], 10: [7, 0, 2], 11: [7, 1, 2], 12: [7, 2, 2], 13: [9, 0, 3], 14: [9, 1, 3], 15: [9, 2, 3] };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- The ⚙ panel ---------- */
  let open = false, view = 'menu', toast = '';
  const css = `
  .cc-btn { font: inherit; font-weight: 800; border-radius: 10px; min-height: 36px; padding: 4px 10px; cursor: pointer; border: 1px solid var(--line, #3b3346); background: var(--surface, #211c29); color: var(--fg, #ece6f2); }
  .cc-btn:hover { border-color: var(--brass, #d4ab55); }
  .cc-btn.on, .cc-seg button[aria-pressed="true"] { background: var(--brass, #d4ab55); color: #1a1408; border-color: var(--brass, #d4ab55); }
  .cc-gear { min-width: 40px; font-size: 1.1rem; line-height: 1; }
  .cc-float { position: fixed; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 60; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
  .cc-back { position: fixed; inset: 0; z-index: 70; background: rgba(0,0,0,.45); display: grid; place-items: end center; }
  @media (min-width: 640px) { .cc-back { place-items: center; } }
  .cc-sheet { width: min(560px, 100%); max-height: min(88vh, 900px); overflow: auto; background: var(--surface, #211c29); color: var(--fg, #ece6f2); border: 1px solid var(--line, #3b3346); border-radius: 16px 16px 0 0; padding: 16px 16px calc(16px + env(safe-area-inset-bottom, 0px)); display: grid; gap: 12px; font-family: var(--font-body, system-ui, sans-serif); }
  @media (min-width: 640px) { .cc-sheet { border-radius: 16px; } }
  .cc-sheet h2 { margin: 0; font-family: var(--font-display, Georgia, serif); font-weight: 400; color: var(--brass, #d4ab55); font-size: 1.45rem; }
  .cc-sheet h3 { margin: 6px 0 0; font-size: .74rem; text-transform: uppercase; letter-spacing: .1em; color: var(--muted, #a69cb3); }
  .cc-sheet p { margin: 0; }
  .cc-hint { color: var(--muted, #a69cb3); font-size: .88rem; }
  .cc-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .cc-set { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  .cc-set > span { font-weight: 700; min-width: 7.5em; }
  .cc-seg { display: inline-flex; border: 1px solid var(--line, #3b3346); border-radius: 10px; overflow: hidden; }
  .cc-seg button { font: inherit; font-weight: 700; border: 0; background: var(--surface, #211c29); color: inherit; padding: 8px 12px; min-height: 40px; cursor: pointer; }
  .cc-seg button + button { border-left: 1px solid var(--line, #3b3346); }
  .cc-head { display: flex; align-items: center; gap: 10px; }
  .cc-head h2 { margin-right: auto; }
  .cc-team { font-weight: 800; font-size: .74rem; text-transform: uppercase; letter-spacing: .1em; }
  .cc-role { display: grid; gap: 2px; padding: 8px 0; border-bottom: 1px solid var(--line, #3b3346); }
  .cc-role b { font-size: 1.02rem; }
  .cc-townsfolk { color: var(--townsfolk, #3e7fd6); } .cc-outsider { color: var(--outsider, #3aa0b5); } .cc-minion { color: var(--minion, #d4485e); } .cc-demon { color: var(--demon, #c0344b); }
  .cc-toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(70px + env(safe-area-inset-bottom, 0px)); z-index: 80; background: var(--surface, #211c29); color: var(--fg, #ece6f2); border: 1px solid var(--brass, #d4ab55); border-radius: 12px; padding: 10px 14px; max-width: calc(100% - 32px); box-shadow: 0 6px 18px rgba(0,0,0,.4); font-family: var(--font-body, system-ui, sans-serif); }
  .cc-pop { position: fixed; z-index: 75; max-width: min(320px, calc(100% - 24px)); background: var(--surface, #211c29); color: var(--fg, #ece6f2); border: 1px solid var(--line, #3b3346); border-radius: 12px; padding: 10px 12px; box-shadow: 0 8px 22px rgba(0,0,0,.45); font-family: var(--font-body, system-ui, sans-serif); font-size: .92rem; display: grid; gap: 4px; }
  .cc-name { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
  table.cc-counts { border-collapse: collapse; font-size: .9rem; }
  table.cc-counts td, table.cc-counts th { padding: 3px 8px; text-align: center; border-bottom: 1px solid var(--line, #3b3346); }
  `;
  function el(tag, attrs, html) { const e = document.createElement(tag); Object.assign(e, attrs || {}); if (html != null) e.innerHTML = html; return e; }
  let root = null;
  function note(t) { toast = t; render(); setTimeout(() => { if (toast === t) { toast = ''; render(); } }, 3500); }
  function seg(key, opts) { return `<div class="cc-seg">${opts.map(([v, l]) => `<button data-cc="pref" data-k="${key}" data-v="${v}" aria-pressed="${String(prefs[key]) === String(v)}">${l}</button>`).join('')}</div>`; }
  function menuHtml() {
    const can = stack.length;
    const install = standalone() ? '<p class="cc-hint">Installed: you\'re using the app version.</p>'
      : installEvt ? '<button class="cc-btn" data-cc="install">Install the Clocktower apps</button><p class="cc-hint">Puts an icon on your home screen. The apps then open full screen and work without signal.</p>'
      : /iphone|ipad|ipod/i.test(navigator.userAgent) ? '<p>In Safari, tap <b>Share</b> (the square with an arrow), then <b>Add to Home Screen</b>. The apps then open full screen and work without signal.</p>'
      : '<p>In your browser\'s menu, choose <b>Install app</b> or <b>Add to Home Screen</b>. The apps then open full screen and work without signal.</p>';
    return `<div class="cc-head"><h2>Settings</h2><button class="cc-btn" data-cc="close" aria-label="Close">✕</button></div>
      ${app ? `<h3>Undo</h3><div class="cc-row"><button class="cc-btn ${can ? 'on' : ''}" data-cc="undo" ${can ? '' : 'disabled'}>↶ Undo last change</button><span class="cc-hint">${can ? `${can} ${can === 1 ? 'step' : 'steps'} back available` : 'Nothing to undo yet'}</span></div>` : ''}
      ${app && app.simple ? `<h3>Simple mode</h3><div class="cc-set"><span>Simple mode</span>${seg('simple:' + page, [[true, 'On'], [false, 'Off']])}</div><p class="cc-hint">${esc(app.simple)}</p>` : ''}
      <h3>Display</h3>
      <div class="cc-set"><span>Text size</span>${seg('zoom', [[1, 'Normal'], [1.15, 'Large'], [1.3, 'Extra large']])}</div>
      <div class="cc-set"><span>Light or dark</span>${seg('theme', [['auto', 'Like my phone'], ['light', 'Light'], ['dark', 'Dark']])}</div>
      ${'wakeLock' in navigator ? `<div class="cc-set"><span>Keep screen on</span>${seg('awake', [[true, 'On'], [false, 'Off']])}</div><p class="cc-hint">Stops the phone dimming and locking while an app is open.</p>` : ''}
      <h3>Characters</h3><div class="cc-row"><button class="cc-btn" data-cc="sheet">Trouble Brewing character sheet</button></div>
      <p class="cc-hint">Tip: tap any character's name in the apps to see what it does.</p>
      ${app ? `<h3>Your saved game</h3><div class="cc-row"><button class="cc-btn" data-cc="export">Save game to a file</button><button class="cc-btn" data-cc="import">Load a saved game</button></div>
        <p class="cc-hint">Games are saved in this browser only. Save one to a file to keep a backup or carry on on another device.</p>` : ''}
      <h3>Install</h3>${install}`;
  }
  function sheetHtml() {
    const counts = Object.keys(COUNTS).map(n => `<tr><th>${n}</th><td class="cc-townsfolk">${COUNTS[n][0]}</td><td class="cc-outsider">${COUNTS[n][1]}</td><td class="cc-minion">${COUNTS[n][2]}</td><td class="cc-demon">1</td></tr>`).join('');
    return `<div class="cc-head"><button class="cc-btn" data-cc="menu" aria-label="Back">‹</button><h2>Trouble Brewing</h2><button class="cc-btn" data-cc="close" aria-label="Close">✕</button></div>
      ${SHEET.map(([team, label, rs]) => `<div><div class="cc-team cc-${team}">${label}</div>${rs.map(([r, t]) => `<div class="cc-role"><b class="cc-${team}">${esc(r)}</b><span>${esc(t)}</span></div>`).join('')}</div>`).join('')}
      <p class="cc-hint">* Not the first night.</p>
      <h3>How many of each</h3>
      <table class="cc-counts"><tr><th>Players</th><th class="cc-townsfolk">Town</th><th class="cc-outsider">Out</th><th class="cc-minion">Min</th><th class="cc-demon">Dem</th></tr>${counts}</table>
      <p class="cc-hint">A Baron swaps 2 Townsfolk for 2 Outsiders.</p>`;
  }
  function render() {
    if (!root) return;
    root.innerHTML = (open ? `<div class="cc-back" data-cc="backdrop"><div class="cc-sheet" role="dialog" aria-modal="true" aria-label="Settings">${view === 'sheet' ? sheetHtml() : menuHtml()}</div></div>` : '')
      + (toast ? `<div class="cc-toast" role="status">${esc(toast)}</div>` : '');
  }
  function mountButton() {
    const bar = document.querySelector('header.bar');
    const b = el('button', { className: 'cc-btn cc-gear' + (bar ? '' : ' cc-float'), type: 'button', title: 'Settings, undo and the character sheet' }, '⚙&#xFE0E;');
    b.setAttribute('aria-label', 'Settings, undo and the character sheet');
    b.dataset.cc = 'open';
    // Next to the app's Help or Menu button if it has one, so it doesn't start a new row
    const near = bar && [...bar.querySelectorAll('button, a')].find(x => x.id === 'helpBtn' || /^(help|menu)$/i.test(x.textContent.trim()));
    if (near) near.after(b); else if (bar) bar.appendChild(b); else document.body.appendChild(b);
  }

  /* ---------- Tap a character's name to see what it does ---------- */
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function showPop(target, info) {
    closePop();
    pop = el('div', { className: 'cc-pop', role: 'tooltip' }, `<b class="cc-${info.team}">${esc(info.name)}</b><span>${esc(info.text)}</span>`);
    document.body.appendChild(pop);
    const r = target.getBoundingClientRect(), z = prefs.zoom || 1, w = pop.offsetWidth, h = pop.offsetHeight;
    let left = Math.min(Math.max(8, r.left / z), innerWidth / z - w - 8), top = r.bottom / z + 6;
    if (top + h > innerHeight / z - 8) top = r.top / z - h - 6;
    pop.style.left = left + 'px'; pop.style.top = Math.max(8, top) + 'px';
  }
  const INTERACTIVE = 'button, a, select, input, textarea, label, summary, [data-act], [onclick], [contenteditable], .cc-sheet';
  document.addEventListener('click', e => {
    const t = e.target;
    const cc = t.closest && t.closest('[data-cc]');
    if (cc) {
      const a = cc.dataset.cc;
      if (a === 'backdrop' && t !== cc) return;
      e.preventDefault();
      if (a === 'open') { open = true; view = 'menu'; }
      else if (a === 'close' || a === 'backdrop') open = false;
      else if (a === 'menu') view = 'menu';
      else if (a === 'sheet') view = 'sheet';
      else if (a === 'undo') return undo();
      else if (a === 'pref') {
        const k = cc.dataset.k, v = cc.dataset.v;
        prefs[k] = k === 'zoom' ? +v : (k === 'awake' || k.startsWith('simple:')) ? v === 'true' : v;
        savePrefs();
        fixTab();
      }
      else if (a === 'export') { exportGame(); note('Saved. Look in your downloads.'); }
      else if (a === 'import') { const i = el('input', { type: 'file', accept: '.json,application/json' }); i.onchange = () => i.files[0] && importGame(i.files[0]); i.click(); }
      else if (a === 'install' && installEvt) { installEvt.prompt(); installEvt = null; }
      render();
      return;
    }
    if (pop && !pop.contains(t)) closePop();
    // A character's name (on its own, or in bold) that isn't part of a button or form
    if (!t.closest || t.closest(INTERACTIVE)) return;
    const txt = (t.textContent || '').trim().replace(/[.,!?:;'’]+$/, '').toLowerCase();
    if (txt.length > 16 || !ABILITY[txt]) return;
    showPop(t, ABILITY[txt]);
  });
  // Underline character names that can be tapped (bold names and table headings)
  function markNames() {
    document.querySelectorAll('b, strong, th span').forEach(n => {
      if (n.classList.contains('cc-name') || n.closest(INTERACTIVE)) return;
      const txt = (n.textContent || '').trim().toLowerCase();
      if (ABILITY[txt]) n.classList.add('cc-name');
    });
  }
  let markT = null;
  const observer = new MutationObserver(() => { clearTimeout(markT); markT = setTimeout(markNames, 120); });

  addEventListener('keydown', e => { if (e.key === 'Escape') { if (pop) closePop(); else if (open) { open = false; render(); } } });
  addEventListener('scroll', closePop, { passive: true });

  // If the tab you're on is hidden by Simple mode, go to the first one you can see
  function fixTab() {
    const cur = document.querySelector('.tab[aria-selected="true"]');
    if (cur && !cur.offsetParent) { const first = [...document.querySelectorAll('.tab')].find(t => t.offsetParent); if (first) first.click(); }
  }
  function start() {
    document.head.appendChild(el('style', {}, css));
    root = el('div', { className: 'cc-root' });
    document.body.appendChild(root);
    mountButton();
    apply();
    markNames();
    setTimeout(fixTab, 0);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
