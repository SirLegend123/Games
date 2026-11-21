// Background music for the shared screens (Espionage's TV, The Shadows' show screen, BoTC's Town Square).
// Public-domain (CC0) tracks; each screen picks one for each part of the game, and they fade into each other.
// Music starts off; the 🎵 button and the volume are remembered on that screen.
//   const music = gameMusic({ dir: "audio/esp/", tracks: { lobby: ["lobby", "Electric City"], ... }, store: "esp", side: "right", v: 158 });
//   music.set("lobby", paused)   (call it whenever the game changes; the same track keeps playing)
// The volume goes through the Web Audio mixer (a gain node), because iPads and iPhones ignore an audio element's own volume.
function gameMusic(o) {
  const ls = { get: k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const M = { on: ls.get(o.store + "-music") === "on", vol: +(ls.get(o.store + "-vol") || 60) / 100, key: null, want: null, paused: false, cur: null, blocked: false, ctx: null };
  const css = document.createElement("style");
  css.textContent = `.gm { position: fixed; ${o.side === "left" ? "left" : "right"}: 12px; bottom: 10px; z-index: 50; display: flex; align-items: center; gap: 8px; padding: 5px 10px;
      border-radius: 99px; background: rgba(8, 10, 18, .82); border: 1px solid rgba(255, 255, 255, .14); color: #e9e6f2; font: 600 14px/1.2 system-ui, sans-serif; }
    .gm button { font: inherit; color: inherit; background: rgba(255, 255, 255, .08); border: 1px solid rgba(255, 255, 255, .2); border-radius: 99px; padding: 6px 12px; cursor: pointer; }
    .gm button[aria-pressed="true"] { border-color: ${o.accent || "#d9b45a"}; }
    .gm input { width: 100px; accent-color: ${o.accent || "#d9b45a"}; }
    .gm .now { opacity: .7; font-weight: 500; max-width: 14em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gm.dim { opacity: .45; } .gm.dim:hover, .gm.dim:focus-within { opacity: 1; }
    @media print { .gm { display: none; } }`;
  document.head.appendChild(css);
  const box = document.createElement("div");
  box.className = "gm" + (o.dim ? " dim" : ""); box.setAttribute("role", "group"); box.setAttribute("aria-label", "Music");
  box.innerHTML = `<button type="button" aria-pressed="false"></button><input type="range" min="0" max="100" aria-label="Music volume"><span class="now" aria-live="polite"></span>`;
  document.body.appendChild(box);
  const [btn, vol, now] = box.children;
  vol.value = Math.round(M.vol * 100);
  // The mixer: made (or woken) by a tap, as phones and tablets require
  function mixer() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!M.ctx && AC) { try { M.ctx = new AC(); } catch (e) { M.ctx = null; } }
    if (M.ctx && M.ctx.state === "suspended") M.ctx.resume().catch(() => {});
    return M.ctx;
  }
  // A track: the audio element, and its own volume knob in the mixer (or, without a mixer, the element's volume)
  function track(key) {
    const el = new Audio(`${o.dir}${o.tracks[key][0]}.mp3${o.v ? `?v=${o.v}` : ""}`);
    el.loop = !(o.once || []).includes(key); el.preload = "auto";
    const t = { el, key, g: null };
    const ctx = mixer();
    if (ctx) { try { const src = ctx.createMediaElementSource(el); t.g = ctx.createGain(); t.g.gain.value = 0; src.connect(t.g).connect(ctx.destination); } catch (e) { t.g = null; } }
    if (!t.g) el.volume = 0;
    return t;
  }
  const level = t => t.g ? t.g.gain.value : t.el.volume;
  function fade(t, to, ms, done) {
    if (t.g) {
      const g = t.g.gain, c = M.ctx, at = c.currentTime;
      g.cancelScheduledValues(at); g.setValueAtTime(g.value, at); g.linearRampToValueAtTime(to, at + ms / 1000);
      if (done) setTimeout(done, ms + 50);
      return;
    }
    const from = t.el.volume, t0 = performance.now();
    const step = n => { const k = Math.min(1, (n - t0) / ms); t.el.volume = Math.max(0, Math.min(1, from + (to - from) * k)); if (k < 1) requestAnimationFrame(step); else if (done) done(); };
    requestAnimationFrame(step);
  }
  function ui() {
    btn.textContent = !M.on ? "🎵 Music: off" : M.blocked ? "🎵 Tap to play" : "🎵 Music: on";
    btn.setAttribute("aria-pressed", String(M.on));
    now.textContent = M.on && M.key && !M.blocked ? `♪ ${o.tracks[M.key][1]}` : "";
  }
  function apply() {
    const key = M.want && o.tracks[M.want] ? M.want : null, paused = M.paused;
    if (!M.on || !key) { if (M.cur) { const t = M.cur; M.cur = null; M.key = null; fade(t, 0, 700, () => t.el.pause()); } return ui(); }
    if (key !== M.key) {
      const old = M.cur; if (old) fade(old, 0, 1500, () => old.el.pause());
      const t = track(key); M.cur = t; M.key = key;
      t.el.play().then(() => { if (M.cur !== t) return;
        if (t.g && M.ctx.state !== "running") { t.el.pause(); M.blocked = true; M.key = null; M.cur = null; return ui(); }   // the mixer is still asleep: wait for a tap
        M.blocked = false; if (M.paused) t.el.pause(); else fade(t, M.vol, 1500); ui(); })
        .catch(() => { if (M.cur === t) { M.blocked = true; M.key = null; M.cur = null; } ui(); });
    } else if (M.cur) {
      const t = M.cur;
      if (paused && !t.el.paused) fade(t, 0, 500, () => { if (M.paused && M.cur === t) t.el.pause(); });
      else if (!paused && t.el.paused) { t.el.play().catch(() => {}); fade(t, M.vol, 800); }
    }
    ui();
  }
  btn.addEventListener("click", () => { M.on = !(M.on && !M.blocked); M.blocked = false; ls.set(o.store + "-music", M.on ? "on" : "off"); if (M.on) mixer(); apply(); });
  vol.addEventListener("input", () => { M.vol = vol.value / 100; ls.set(o.store + "-vol", vol.value); if (M.cur && !M.cur.el.paused) fade(M.cur, M.vol, 80); });
  // If the music was left on, the browser may wait for a tap before it can play: any tap on the screen will do
  const wake = e => { if (M.on && M.blocked && !box.contains(e.target)) { M.blocked = false; mixer(); apply(); } };
  ["click", "touchend", "keydown"].forEach(ev => document.addEventListener(ev, wake, true));
  ui();
  return {
    set(key, paused) { M.want = key; M.paused = !!paused; apply(); },
    state: () => ({ on: M.on, key: M.key, playing: !!(M.cur && !M.cur.el.paused), vol: M.cur ? level(M.cur) : 0, t: M.cur ? M.cur.el.currentTime : 0, blocked: M.blocked, label: btn.textContent, now: now.textContent, mixer: !!(M.cur && M.cur.g) })
  };
}
