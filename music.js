// Background music for the shared screens (Espionage's TV, The Shadows' show screen, BoTC's Town Square).
// Public-domain (CC0) tracks; each screen picks one for each part of the game, and they fade into each other.
// Music starts off; the 🎵 button and the volume are remembered on that screen.
//   const music = gameMusic({ dir: "audio/esp/", tracks: { lobby: ["lobby", "Electric City"], ... }, store: "esp", side: "right", v: 155 });
//   music.set("lobby", paused)   (call it whenever the game changes; the same track keeps playing)
function gameMusic(o) {
  const ls = { get: k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const M = { on: ls.get(o.store + "-music") === "on", vol: +(ls.get(o.store + "-vol") || 60) / 100, key: null, want: null, paused: false, el: null, blocked: false };
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
  function fade(el, to, ms, done) {
    const from = el.volume, t0 = performance.now();
    const step = t => { const k = Math.min(1, (t - t0) / ms), end = typeof to === "function" ? to() : to; el.volume = Math.max(0, Math.min(1, from + (end - from) * k)); if (k < 1) requestAnimationFrame(step); else if (done) done(); };
    requestAnimationFrame(step);
  }
  function ui() {
    btn.textContent = !M.on ? "🎵 Music: off" : M.blocked ? "🎵 Tap to play" : "🎵 Music: on";
    btn.setAttribute("aria-pressed", String(M.on));
    now.textContent = M.on && M.key && !M.blocked ? `♪ ${o.tracks[M.key][1]}` : "";
  }
  function apply() {
    const key = M.want && o.tracks[M.want] ? M.want : null, paused = M.paused;
    if (!M.on || !key) { if (M.el) { const e = M.el; M.el = null; M.key = null; fade(e, 0, 700, () => e.pause()); } return ui(); }
    if (key !== M.key) {
      const old = M.el; if (old) fade(old, 0, 1500, () => old.pause());
      const el = new Audio(`${o.dir}${o.tracks[key][0]}.mp3${o.v ? `?v=${o.v}` : ""}`);
      el.loop = !(o.once || []).includes(key); el.volume = 0; M.el = el; M.key = key;
      el.play().then(() => { M.blocked = false; if (paused) el.pause(); else fade(el, () => M.vol, 1500); ui(); })
        .catch(() => { if (M.el === el) { M.blocked = true; M.key = null; M.el = null; } ui(); });
    } else if (M.el) {
      const el = M.el;
      if (paused && !el.paused) fade(el, 0, 500, () => { if (M.paused) el.pause(); });
      else if (!paused && el.paused) { el.play().catch(() => {}); fade(el, () => M.vol, 800); }
    }
    ui();
  }
  btn.addEventListener("click", () => { M.on = !(M.on && !M.blocked); M.blocked = false; ls.set(o.store + "-music", M.on ? "on" : "off"); apply(); });
  vol.addEventListener("input", () => { M.vol = vol.value / 100; ls.set(o.store + "-vol", vol.value); if (M.el && !M.el.paused) M.el.volume = M.vol; });
  ui();
  return {
    set(key, paused) { M.want = key; M.paused = !!paused; apply(); },
    state: () => ({ on: M.on, key: M.key, playing: !!(M.el && !M.el.paused), vol: M.el ? M.el.volume : 0, t: M.el ? M.el.currentTime : 0, blocked: M.blocked, label: btn.textContent, now: now.textContent })
  };
}
