// Clocktower Daily: shared by the Storyteller (daily-st.html) and the players (daily.html).
// The game lives in Firebase (Firestore), so it carries on over several days while everyone's phone is asleep.
// The security rules (firestore.rules) keep each player's character private and hide votes until voting closes.

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
  // Each device gets a hidden ID (anonymous sign-in): no passwords, but the rules can tell players apart
  return new Promise((ok, bad) => {
    const off = FB.onAuthStateChanged(fbAuth, u => {
      if (u) { off(); myUid = u.uid; ok(u.uid); }
      else FB.signInAnonymously(fbAuth).catch(bad);
    });
  });
}
// Firestore can remember a "not allowed" for a while. Things here unlock with time (the dawn news, the votes),
// so if something is refused, refresh the sign-in once and try again.
let lastRefresh = 0;
async function retryDenied(fn) {
  try { return await fn(); }
  catch (e) {
    if (e.code !== "permission-denied" || !fbAuth.currentUser || Date.now() - lastRefresh < 15000) throw e;
    lastRefresh = Date.now();
    await fbAuth.currentUser.getIdToken(true);
    return await fn();
  }
}
const ref = (...p) => FB.doc(db, ...p);
const col = (...p) => FB.collection(db, ...p);
const gref = (gid, ...p) => ref("games", gid, ...p);
const gcol = (gid, ...p) => col("games", gid, ...p);

/* ---------- Little helpers ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rnd = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const nowMs = () => Date.now() + (window.CLOCK_SKEW || 0);
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[rnd(CODE_CHARS.length)]).join("");
const cleanCode = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

/* ---------- The daily timetable ---------- */
// The times of day, in order. Changing them on the Storyteller's dashboard takes effect from the next day.
const SCHED_KEYS = [
  ["dawn", "🌅", "Dawn", "The night's deaths are revealed, and night info arrives"],
  ["chats", "🤫", "Private chats", "Message anyone, one to one"],
  ["noms", "⚖️", "Nominations open", "Nominate and vote. Private chats with neighbours only"],
  ["close", "🔒", "Voting closes", "The votes are counted"],
  ["reveal", "🪓", "The execution is revealed", ""],
  ["night", "🌙", "Night falls", "Choose your night action"],
  ["nightEnd", "🕯️", "Night actions close", "The Storyteller works through the night"]
];
const DEFAULT_SCHED = { dawn: "07:30", chats: "07:45", noms: "13:30", close: "18:30", reveal: "19:00", night: "19:30", nightEnd: "21:30" };
const hm = s => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };
// That clock time on the same calendar day as ms (this device's time zone)
function atClock(ms, hhmm) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() + hm(hhmm) * 60000; }
// The first time the clock shows hhmm at or after ms
function nextClock(ms, hhmm) { let t = atClock(ms, hhmm); while (t < ms) t = addDays(t, 1); return t; }
function addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }
// All of a day's times, from the scheduled dawn on that date. If the Storyteller wakes the town late (start),
// the morning is shorter: nothing happens before start.
function dayTimes(dawnSlot, sched, start = dawnSlot) {
  const t = {}; let prevRaw = dawnSlot, prevHm = hm(sched.dawn), day = dawnSlot;
  for (const [k] of SCHED_KEYS) {
    if (k !== "dawn" && hm(sched[k]) < prevHm) day = addDays(day, 1);   // the clock went past midnight
    const raw = k === "dawn" ? dawnSlot : atClock(day, sched[k]);
    prevHm = hm(sched[k]); prevRaw = raw;
    t[k] = Math.max(raw, start);
  }
  return t;
}
const schedOk = sched => {
  // Each time must come after the last, going round the clock at most once
  let total = 0;
  for (let i = 1; i < SCHED_KEYS.length; i++) { total += (hm(sched[SCHED_KEYS[i][0]]) - hm(sched[SCHED_KEYS[i - 1][0]]) + 1440) % 1440; if (hm(sched[SCHED_KEYS[i][0]]) === hm(sched[SCHED_KEYS[i - 1][0]])) return false; }
  return total < 1440;
};

// What's happening now. Night n comes before Day n. Returns { k, n, from, to }:
// lobby, wait (before Night 1), night (actions open), dark (asleep, waiting for dawn), dawn, chats, noms, count, dusk, over
function phaseOf(G, now = nowMs()) {
  if (!G || G.status === "lobby") return { k: "lobby", n: 0 };
  if (G.overAt && now >= G.overAt) return { k: "over", n: G.day || 0 };
  const N = G.nights || {}, D = G.days || {}, segs = [];
  for (let n = 1; N[n] || D[n]; n++) {
    if (N[n]) segs.push(["night", n, N[n].open, N[n].end], ["dark", n, N[n].end, D[n] ? D[n].dawn : Infinity]);
    if (D[n]) {
      const t = D[n];
      segs.push(["dawn", n, t.dawn, t.chats], ["chats", n, t.chats, t.noms], ["noms", n, t.noms, t.close], ["count", n, t.close, t.reveal], ["dusk", n, t.reveal, N[n + 1] ? N[n + 1].open : Infinity]);
    }
  }
  if (!segs.length || now < segs[0][2]) return { k: "wait", n: 0, to: segs.length ? segs[0][2] : Infinity };
  for (let i = segs.length - 1; i >= 0; i--) {
    const [k, n, from, to] = segs[i];
    if (now >= from) return { k, n, from, to: now < to ? to : Infinity };
  }
  return { k: "wait", n: 0 };
}
const PHASE_INFO = {
  lobby: ["🏰", "Waiting to start"], wait: ["🕯️", "Night 1 is coming"], night: ["🌙", "Night"], dark: ["🌌", "The town sleeps"],
  dawn: ["🌅", "Dawn"], chats: ["🤫", "Private chats"], noms: ["⚖️", "Nominations & voting"], count: ["🔒", "Counting the votes"],
  dusk: ["🌆", "Evening"], over: ["🏁", "Game over"]
};
const phaseTitle = P => {
  const [ic, name] = PHASE_INFO[P.k];
  return P.k === "night" || P.k === "dark" ? `${ic} Night ${P.n}${P.k === "dark" ? " · asleep" : ""}` : ["lobby", "wait", "over"].includes(P.k) ? `${ic} ${name}` : `${ic} Day ${P.n} · ${name}`;
};
const isDay = P => ["dawn", "chats", "noms", "count", "dusk"].includes(P.k);

/* ---------- Time words ---------- */
const clock = ms => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const DAYNAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function when(ms, now = nowMs()) {
  if (!isFinite(ms)) return "";
  const d = new Date(ms), a = new Date(now); a.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - a.getTime()) / 86400000);
  return `${days === 0 ? "" : days === 1 ? "tomorrow " : days === -1 ? "yesterday " : DAYNAMES[d.getDay()] + " "}${clock(ms)}`;
}
function left(ms, now = nowMs()) {
  if (!isFinite(ms)) return "";
  const m = Math.max(0, Math.round((ms - now) / 60000));
  return m >= 120 ? `${Math.floor(m / 60)}h ${m % 60}m` : m >= 60 ? `1h ${m - 60}m` : m <= 1 ? "a minute" : `${m} min`;
}

/* ---------- The circle ---------- */
const seatIds = G => (G.seats || []).map(s => s.id);
const seatName = (G, pid) => ((G.seats || []).find(s => s.id === pid) || {}).name || "?";
const neighbours = (G, a, b) => { const ids = seatIds(G), n = ids.length, i = ids.indexOf(a), j = ids.indexOf(b); return n > 1 && i >= 0 && j >= 0 && i !== j && (Math.abs(i - j) === 1 || Math.abs(i - j) === n - 1); };
// The nearest living players either side (the Empath's neighbours)
function aliveNeighbours(G, pid, dead) {
  const ids = seatIds(G), n = ids.length, i = ids.indexOf(pid), out = [];
  for (const dir of [-1, 1]) for (let k = 1; k < n; k++) { const q = ids[(i + dir * k + n * k) % n]; if (q !== pid && !dead[q]) { out.push(q); break; } }
  return [...new Set(out)];
}
// Who may message whom: anyone during private chats; otherwise only the players sitting either side
const canChat = (G, P, a, b) => a !== b && (P.k === "chats" || P.k === "over" || neighbours(G, a, b));
const chatWhy = P => P.k === "night" || P.k === "dark" ? "At night you can only message your neighbours." : P.k === "chats" ? "" : "Private chats are over for today: you can only message your neighbours.";
const squareOpen = P => isDay(P) || P.k === "over";
const pairId = (a, b) => [a, b].sort().join("~");

// Who's dead, as far as everyone knows: the Storyteller's record plus anything revealed since
function deadNow(G, gated = {}) {
  const dead = { ...(G.dead || {}) };
  for (const e of G.events || []) if (e.dies) dead[e.dies] = { how: e.kind, d: e.d };
  for (const g of Object.values(gated)) if (g) for (const x of g.deaths || []) dead[x.pid] = { how: x.how, d: x.d, n: x.n };
  return dead;
}
const HOW = { night: "Died in the night", executed: "Executed", virgin: "Executed (Virgin)", slayer: "Shot by the Slayer", other: "Died" };

/* ---------- Trouble Brewing night actions ---------- */
// What a player chooses at night, from the character they believe they are
const ACTS = {
  "Poisoner": { first: true, other: true, picks: 1, ask: "Choose a player to poison tonight and tomorrow." },
  "Monk": { other: true, picks: 1, notSelf: true, ask: "Choose a player (not yourself): they are safe from the Demon tonight." },
  "Imp": { other: true, picks: 1, ask: "Choose a player to kill tonight. Choosing yourself passes the Demon on to a Minion." },
  "Fortune Teller": { first: true, other: true, picks: 2, ask: "Choose 2 players: you'll learn if either is a Demon." },
  "Butler": { first: true, other: true, picks: 1, notSelf: true, ask: "Choose your Master (not yourself): tomorrow you may only vote if they vote too." },
  "Ravenkeeper": { other: true, picks: 1, ask: "If you die tonight, which player's character do you want to learn? (Choose every night, just in case.)" }
};
const actOf = (role, n) => { const a = ACTS[role]; return a && (n === 1 ? a.first : a.other) ? a : null; };
const FIRST_ORDER = ["MINION", "DEMON", "Poisoner", "Washerwoman", "Librarian", "Investigator", "Chef", "Empath", "Fortune Teller", "Butler", "Spy"];
const OTHER_ORDER = ["Poisoner", "Monk", "Scarlet Woman", "Imp", "Ravenkeeper", "Empath", "Fortune Teller", "Undertaker", "Butler", "Spy"];

/* ---------- Nominations ---------- */
// Each nomination comes with a reason. The nominee then has time to give a defence; voting on it opens
// when they do, or when that time runs out. New nominations stop that long before voting closes.
const defMins = G => G.defMins || 30;
const voteOpensAt = (G, x) => Math.min(x.defAt || Infinity, x.at + defMins(G) * 60000);
const nomsCloseAt = (G, d) => G.days[d].close - defMins(G) * 60000;
const byTime = list => [...list].sort((a, b) => a.at - b.at);

/* ---------- Votes ---------- */
// The execution threshold: half the living players, rounded up
const needVotes = aliveCount => Math.ceil(aliveCount / 2);
// Count the votes on each nomination. votes: [{nom, voter, at}] (only yes votes are stored).
// Dead players have one ghost vote for the rest of the game; the Butler's vote only counts if their Master votes too.
function tally({ noms, votes, dead, ghostUsed = {}, butler = null }) {
  const byVoter = {}, out = {};
  [...votes].sort((a, b) => a.at - b.at).forEach(v => (byVoter[v.voter] = byVoter[v.voter] || []).push(v));
  for (const nm of noms) out[nm.of] = { of: nm.of, by: nm.by, voters: [], count: 0 };
  for (const [voter, vs] of Object.entries(byVoter)) {
    let list = vs.filter(v => out[v.nom]);
    if (dead[voter]) list = ghostUsed[voter] ? [] : list.slice(0, 1);
    for (const v of list) {
      if (butler && butler.pid === voter && !(votes.some(w => w.voter === butler.master && w.nom === v.nom))) continue;
      out[v.nom].voters.push(voter); out[v.nom].count++;
    }
  }
  return Object.values(out).sort((a, b) => b.count - a.count);
}
// Who's executed: the most votes, if it reaches the threshold and isn't tied
function verdict(rows, need) {
  const top = rows[0];
  if (!top || top.count < need) return { exec: null, why: top ? `No one reached ${need} votes.` : "No one was nominated." };
  if (rows[1] && rows[1].count === top.count) return { exec: null, why: `A tie on ${top.count} votes: no one is executed.` };
  return { exec: top.of, why: `${top.count} votes (${need} needed).` };
}

/* ---------- Calendar (.ics) ---------- */
function icsFile(name, sched, fromMs, days = 7) {
  const pad = n => String(n).padStart(2, "0");
  const stamp = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`; };
  const ev = [];
  let base = new Date(fromMs); base.setHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const t = dayTimes(addDays(base.getTime(), i) + hm(sched.dawn) * 60000, sched);
    for (const [k, ic, label] of SCHED_KEYS) {
      if (!["dawn", "chats", "noms", "close", "reveal", "night", "nightEnd"].includes(k) || t[k] < fromMs) continue;
      const remind = ["close", "nightEnd"].includes(k) ? 30 : 0;
      ev.push(["BEGIN:VEVENT", `UID:${k}-${t[k]}@clocktower-daily`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(t[k])}`, `DTEND:${stamp(t[k] + 15 * 60000)}`,
        `SUMMARY:${ic} ${label} · ${name}`, "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${label}`, `TRIGGER:-PT${remind}M`, "END:VALARM", "END:VEVENT"].join("\r\n"));
    }
  }
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Clocktower Daily//EN", "CALSCALE:GREGORIAN", ...ev, "END:VCALENDAR"].join("\r\n");
}
function downloadIcs(text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
  const a = document.createElement("a"); a.href = url; a.download = "clocktower-daily.ics"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ---------- Theme ---------- */
function themeLabel() { const t = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"); return t === "light" ? "🌙" : "☀️"; }
function toggleTheme(key) {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const t = cur === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(key, t); } catch (e) {}
}

/* ---------- The characters sheet ---------- */
function sheetHtml(script = "tb") {
  const R = SCRIPTS[script].roles;
  return `<div class="sheet">${TEAMS.map(t => `<h3 class="t-${t}">${TEAM_LABEL[t]}</h3>${R[t].map(([n, ic, text]) => `<p class="srow"><span class="ico">${ic}</span><span><b>${esc(n)}</b> ${esc(text)}</span></p>`).join("")}`).join("")}</div>`;
}
