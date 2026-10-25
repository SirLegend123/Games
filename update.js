// Tells you when there's a newer version of the app on the site, so nobody plays on an old copy.
// Each page sets window.APP_V; bump it and version.json together with every change.
(function () {
  let shown = false;
  async function check() {
    if (shown || location.protocol === "file:") return;
    try {
      const r = await fetch("version.json?t=" + Date.now(), { cache: "no-store" });
      const { v } = await r.json();
      if (v && window.APP_V && v > window.APP_V) show(v);
    } catch (e) {}
  }
  function show(v) {
    shown = true;
    const b = document.createElement("button");
    b.id = "updBar";
    b.textContent = "🔄 A new version is ready. Tap to update (your game is kept)";
    b.style.cssText = "position:fixed;top:calc(8px + env(safe-area-inset-top, 0px));left:50%;transform:translateX(-50%);z-index:100;max-width:calc(100% - 24px);background:#d4ab55;color:#1a1408;border:0;border-radius:999px;padding:10px 18px;font:inherit;font-weight:800;box-shadow:0 4px 18px rgba(0,0,0,.45);cursor:pointer";
    // A new address makes sure the browser fetches the new copy
    b.onclick = () => { const u = new URL(location.href); u.searchParams.set("v", v); location.replace(u.toString()); };
    document.body.appendChild(b);
  }
  check();
  setInterval(check, 120000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
})();
