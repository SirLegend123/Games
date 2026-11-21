// Espionage: shared by the TV (espionage-tv.html, the host) and the phones (espionage.html).
// In one room, 4 to 12 players. Agents and Spies; everyone wears a badge on their phone, and scanning
// someone's badge uses your role's ability. The server (functions/esp.js) works out every round:
// no device, not even the TV's, can see the roles.

/* ---------- Firebase ---------- */
// This config is public by design: it only says which Firebase project to talk to. The rules protect the data.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDhlGMiD-rkqUfXQaVGuyhqi-FuZWqOeKg",
  authDomain: "clocktower-daily.firebaseapp.com",
  projectId: "clocktower-daily",
  storageBucket: "clocktower-daily.firebasestorage.app",
  messagingSenderId: "660092089498",
  appId: "1:660092089498:web:ff0ce62e1872c84b049b23"
};
// ?emu=1 talks to the local Firebase emulator instead (for testing)
const EMU = new URLSearchParams(location.search).has("emu");
let fbApp, fbAuth, db, myUid = "";
function fbStart() {
  fbApp = FB.initializeApp(EMU ? { ...FIREBASE_CONFIG, projectId: "demo-ct", apiKey: "demo-key" } : FIREBASE_CONFIG);
  fbAuth = FB.getAuth(fbApp);
  db = FB.initializeFirestore(fbApp, {});
  if (EMU) { FB.connectAuthEmulator(fbAuth, "http://127.0.0.1:9099", { disableWarnings: true }); FB.connectFirestoreEmulator(db, "127.0.0.1", 8085); }
  return new Promise((ok, bad) => {
    const off = FB.onAuthStateChanged(fbAuth, u => { if (u) { off(); myUid = u.uid; ok(u.uid); } else FB.signInAnonymously(fbAuth).catch(bad); });
  });
}
const eref = (gid, ...p) => FB.doc(db, "esp", gid, ...p);
const ecol = (gid, ...p) => FB.collection(db, "esp", gid, ...p);

/* ---------- Little helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rnd = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I, O, 0 or 1
const newCode = () => Array.from({ length: 6 }, () => CODE_ABC[rnd(32)]).join("");
const nameOf = (G, pid) => ((G.seats || []).find(s => s.id === pid) || {}).name || "Someone";
const seatIds = G => (G.seats || []).map(s => s.id);
const onlineIds = G => seatIds(G).filter(p => !(G.out || {})[p]);
const mmss = ms => { ms = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(ms / 60)}:${String(ms % 60).padStart(2, "0")}`; };
// Time left in the phase (the host can pause it)
const leftMs = G => G.paused != null ? G.paused : G.ends ? G.ends - Date.now() : 0;

/* ---------- The roles (as in functions/esp.js) ---------- */
const MIN_P = 4, MAX_P = 12, SCANS = 2;
const TEAM = {
  agent: { ic: "🛡️", one: "Agent", many: "Agents", cls: "t-agent", goal: "Find and detain the Black Hat." },
  spy: { ic: "🕶️", one: "Spy", many: "Spies", cls: "t-spy", goal: "Stay hidden until there are as many Spies online as Agents." }
};
// act: what a scan does, and how many times a round. Every scan can also be a plain 📶 ping, which does nothing.
const ROLES = {
  analyst: { team: "agent", ic: "🔎", name: "Analyst", act: "check", n: 2, verb: "Check",
    does: "Scan a badge to learn whether they're an Agent or a Spy." },
  netadmin: { team: "agent", ic: "🌐", name: "Network Admin", act: "pair", n: 2, verb: "Compare",
    does: "Scan two badges: you learn whether those two are on the same team." },
  firewall: { team: "agent", ic: "🧱", name: "Firewall", act: "shield", n: 1, verb: "Shield",
    does: "Scan a badge to shield them this round: the Black Hat can't take them offline." },
  tracer: { team: "agent", ic: "🛰️", name: "Tracer", act: "trace", n: 2, verb: "Trace",
    does: "Scan a badge to learn whose badges they scanned this round." },
  forensics: { team: "agent", ic: "🧪", name: "Forensics", act: "autopsy", n: 2, verb: "Examine",
    does: "Scan the badge of someone offline or detained to learn their role." },
  sniffer: { team: "agent", ic: "📡", name: "Packet Sniffer", act: "sniff", n: 2, verb: "Sniff",
    does: "Scan a badge to learn whether a Spy scanned them this round." },
  honeypot: { team: "agent", ic: "🍯", name: "Honeypot", act: "trap", n: 2, verb: "Set a trap",
    does: "Scan a badge to set a trap on them: if a Spy scans them this round, you learn who." },
  patch: { team: "agent", ic: "🩹", name: "Patch Manager", act: "patch", n: 2, verb: "Patch",
    does: "Scan a badge to undo a Deepfake or a Spoofer on them this round, and learn whether they'd been tampered with." },
  blackhat: { team: "spy", ic: "🎩", name: "Black Hat", act: "neutralise", n: 1, verb: "Neutralise",
    does: "Once a round, scan a badge to take them offline at the briefing (unless a Firewall shields them). If you're detained, the Agents win." },
  deepfake: { team: "spy", ic: "🎭", name: "Deepfake", act: "frame", n: 1, verb: "Deepfake",
    does: "You look like an Agent to every check. Once a round, scan a badge to make them look like a Spy this round." },
  spoofer: { team: "spy", ic: "👻", name: "Spoofer", act: "spoof", n: 1, verb: "Spoof",
    does: "Once a round, scan an Agent's badge: their reports this round come back wrong." },
  phisher: { team: "spy", ic: "🎣", name: "Phisher", act: "phish", n: 1, verb: "Phish",
    does: "Once a round, scan a badge and pick a name: they get a fake message from HQ saying that person is not the Black Hat. (HQ sends real ones too.)" },
  sleeper: { team: "spy", ic: "💤", name: "Sleeper", act: "probe", n: 2, verb: "Probe",
    does: "You look like an Agent to every check, with a cover role. Scan a badge to learn their role." }
};
const AGENT_ROLES = Object.keys(ROLES).filter(k => ROLES[k].team === "agent");
const SPY_ROLES = Object.keys(ROLES).filter(k => ROLES[k].team === "spy");
const spyCount = n => n >= 11 ? 4 : n >= 9 ? 3 : n >= 6 ? 2 : 1;
const roleChip = r => ROLES[r] ? `<span class="${TEAM[ROLES[r].team].cls}">${ROLES[r].ic} ${esc(ROLES[r].name)}</span>` : "";

/* ---------- The phases ---------- */
const PHASES = {
  lobby: ["📡", "Waiting for players"], deal: ["🔐", "Dealing the roles"], roles: ["🪪", "Check your role"],
  mingle: ["🤝", "Mingle"], brief: ["📋", "Briefing"], council: ["🗣️", "Council"], vote: ["🗳️", "Vote"],
  result: ["⚖️", "The verdict"], over: ["🏁", "Game over"]
};
const DEFAULT_MINS = { mingle: 5, council: 3, vote: 1 };
const minsOf = G => ({ ...DEFAULT_MINS, ...(G.mins || {}) });

/* ---------- Badges: a code that changes every 30 seconds ---------- */
const BADGE_WIN = 30000;
async function badgeCode(seed, w) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${seed}:${w}`)));
  let s = ""; for (let i = 0; i < 8; i++) s += CODE_ABC[h[i] % 32];
  return s;
}
// What a badge shows now: the QR text, and the short code to type in if the camera won't
async function badgeNow(G, pid, seed) {
  const code = await badgeCode(seed, Math.floor(Date.now() / BADGE_WIN));
  const i = seatIds(G).indexOf(pid);
  return { qr: `ESP1.${G.code}.${pid.toUpperCase()}.${code}`, short: CODE_ABC[i] + code.slice(0, 3) };
}
// Whose badge a scanned or typed code is (for the phone to show a name straight away; the server checks it properly)
function badgeWho(G, tok) {
  tok = String(tok || "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
  const q = tok.match(/^ESP1\.([A-Z0-9]+)\.(P\d+)\.[A-Z0-9]{8}$/);
  if (q) return q[1] === G.code ? q[2].toLowerCase() : null;
  if (/^[A-Z0-9]{4}$/.test(tok)) return (seatIds(G))[CODE_ABC.indexOf(tok[0])] || null;
  return null;
}
