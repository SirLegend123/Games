// Espionage: the server side. The TV (the host) only moves the game from phase to phase;
// the server deals the roles, checks every badge scan, works out each round, and counts the votes.
// Nobody's device (not even the TV's) can read the roles: they live in esp/{gid}/srv/grim, which only the server reads.
const crypto = require("crypto");
let db;
function init(firestore) { db = firestore; }

/* ---------- The roles (as in espionage.js) ---------- */
const AGENTS = ["analyst", "netadmin", "firewall", "tracer", "forensics", "sniffer", "honeypot", "patch"];
const SPIES = ["blackhat", "deepfake", "spoofer", "phisher", "sleeper"];
const NAME = { analyst: "Analyst", netadmin: "Network Admin", firewall: "Firewall", tracer: "Tracer", forensics: "Forensics", sniffer: "Packet Sniffer",
  honeypot: "Honeypot", patch: "Patch Manager", blackhat: "Black Hat", deepfake: "Deepfake", spoofer: "Spoofer", phisher: "Phisher", sleeper: "Sleeper" };
// What each role's scan can do, and how many times a round (the rest of a player's scans can always be a plain ping)
const ACTS = { analyst: { check: 2 }, netadmin: { pair: 2 }, firewall: { shield: 1 }, tracer: { trace: 2 }, forensics: { autopsy: 2 }, sniffer: { sniff: 2 },
  honeypot: { trap: 2 }, patch: { patch: 2 }, blackhat: { neutralise: 1 }, deepfake: { frame: 1 }, spoofer: { spoof: 1 }, phisher: { phish: 1 }, sleeper: { probe: 2 } };
const SCANS = 2;   // each player's scans per mingle
const teamOf = role => SPIES.includes(role) ? "spy" : "agent";
// How many Spies: 4-5 players, the Black Hat alone; 6-8, two; 9-10, three; 11-12, four
const spyCount = n => n >= 11 ? 4 : n >= 9 ? 3 : n >= 6 ? 2 : 1;
const MIN_P = 4, MAX_P = 12;

/* ---------- Badges: a code that changes every 30 seconds ---------- */
const WIN = 30000;
const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // no I, O, 0 or 1
const seatLetter = i => ABC[i];
function badgeCode(seed, w) {
  const h = crypto.createHash("sha256").update(`${seed}:${w}`).digest();
  let s = ""; for (let i = 0; i < 8; i++) s += ABC[h[i] % 32];
  return s;
}
// A scanned badge: the QR "ESP1.{gid}.{pid}.{code}", or the typed short code (seat letter + 3 characters)
function readToken(G, grim, tok, now) {
  tok = String(tok || "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
  const w = Math.floor(now / WIN), ws = [w + 1, w, w - 1, w - 2, w - 3];
  const seats = G.seats || [];
  let pid, code;
  const q = tok.match(/^ESP1\.([A-Z0-9]+)\.(P\d+)\.([A-Z0-9]{8})$/);
  if (q) { pid = q[2].toLowerCase(); code = q[3]; if (q[1] !== String(G.code || "").toUpperCase()) return null; }
  else if (/^[A-Z0-9]{4}$/.test(tok)) { const i = ABC.indexOf(tok[0]); pid = (seats[i] || {}).id; code = tok.slice(1); }
  else return null;
  const seed = ((grim.seeds || {})[pid]);
  if (!seed) return null;
  const ok = ws.some(x => { const c = badgeCode(seed, x); return code.length === 8 ? c === code : c.slice(0, 3) === code; });
  return ok ? pid : null;
}

/* ---------- Helpers ---------- */
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[crypto.randomInt(a.length)];
const nameOf = (G, pid) => ((G.seats || []).find(s => s.id === pid) || {}).name || "Someone";
const ids = G => (G.seats || []).map(s => s.id);
const online = G => ids(G).filter(p => !(G.out || {})[p]);
const grimRef = gid => db.doc(`esp/${gid}/srv/grim`);
const secretRef = (gid, pid) => db.doc(`esp/${gid}/secret/${pid}`);

/* ---------- Joining: the server gives each new player a seat ---------- */
async function onJoin(gid, uid, j) {
  const ref = db.doc(`esp/${gid}`);
  await db.runTransaction(async tx => {
    const s = await tx.get(ref); if (!s.exists) return;
    const G = s.data(), uids = G.uids || {}, seats = (G.seats || []).slice();
    const mine = Object.keys(uids).find(p => uids[p] === uid);
    let name = String((j && j.name) || "").trim().replace(/\s+/g, " ").slice(0, 20);
    if (!name) return;
    if (mine) {   // already seated: a new name
      if (G.status !== "lobby") return;
      const i = seats.findIndex(x => x.id === mine); seats[i] = { ...seats[i], name: uniq(seats, name, mine) };
      tx.update(ref, { seats }); return;
    }
    if (G.status !== "lobby" || seats.length >= MAX_P) { tx.set(db.doc(`esp/${gid}/joins/${uid}`), { refused: G.status !== "lobby" ? "started" : "full" }, { merge: true }); return; }
    let n = 1; while (seats.some(x => x.id === "p" + n)) n++;
    const pid = "p" + n;
    seats.push({ id: pid, name: uniq(seats, name, pid) });
    tx.update(ref, { seats, [`uids.${pid}`]: uid });
  });
}
function uniq(seats, name, pid) {
  const taken = new Set(seats.filter(x => x.id !== pid).map(x => x.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  let k = 2; while (taken.has(`${name} ${k}`.toLowerCase())) k++;
  return `${name} ${k}`;
}

/* ---------- Dealing the roles ---------- */
async function deal(gid, G) {
  const seats = ids(G), n = seats.length;
  const ref = db.doc(`esp/${gid}`);
  if (n < MIN_P || n > MAX_P) { await ref.update({ status: "lobby", phase: "lobby", err: `Espionage needs ${MIN_P} to ${MAX_P} players.` }); return; }
  const gs = await grimRef(gid).get(); if (gs.exists && gs.data().roles) return;   // dealt already
  const k = spyCount(n), order = shuffle(seats);
  const spyRoles = ["blackhat", ...shuffle(SPIES.slice(1)).slice(0, k - 1)], agentRoles = shuffle(AGENTS).slice(0, n - k);
  const roles = {}, seeds = {};
  order.forEach((p, i) => { roles[p] = i < k ? spyRoles[i] : agentRoles[i - k]; seeds[p] = crypto.randomBytes(12).toString("hex"); });
  const spies = seats.filter(p => teamOf(roles[p]) === "spy");
  // The Sleeper's cover: an Agent role that isn't in the game, if there is one
  const unused = AGENTS.filter(r => !Object.values(roles).includes(r)), cover = {};
  spies.forEach(p => { if (roles[p] === "sleeper") cover[p] = pick(unused.length ? unused : AGENTS); });
  const b = db.batch();
  b.set(grimRef(gid), { roles, seeds, cover, log: {}, done: {} });
  for (const p of seats) {
    const role = roles[p], team = teamOf(role);
    b.set(secretRef(gid, p), { role, team, seed: seeds[p], cover: cover[p] || null,
      allies: team === "spy" ? spies.filter(q => q !== p).map(q => ({ pid: q, role: roles[q] })) : [],
      round: 0, left: 0, used: {}, scans: [], reports: {}, last: null });
  }
  b.update(ref, { status: "running", phase: "roles", round: 0, out: {}, dealt: Date.now(), err: null, spies: k });
  await b.commit();
}

/* ---------- A badge scan ---------- */
// scan: { by, tok, act, pick?, at }
async function onScan(gid, id, s) {
  const ref = db.doc(`esp/${gid}`);
  return db.runTransaction(async tx => {
    const [gs, grs] = [await tx.get(ref), await tx.get(grimRef(gid))];
    if (!gs.exists || !grs.exists) return;
    const G = gs.data(), grim = grs.data(), by = s.by, r = G.round || 0, now = Date.now();
    const sref = secretRef(gid, by), sec = (await tx.get(sref)).data() || {};
    const say = (ok, msg, extra = {}) => tx.update(sref, { last: { id, ok, msg, at: now }, ...extra });
    if (G.phase !== "mingle" || G.status !== "running") return say(false, "Scanning is only open during the mingle.");
    if ((G.out || {})[by]) return say(false, "You're offline: you can't scan any more.");
    const log = (grim.log || {})[r] || [], mine = log.filter(x => x.by === by);
    if (mine.length >= SCANS) return say(false, "You've used both your scans this round.");
    const t = readToken(G, grim, s.tok, now);
    if (!t) return say(false, "That badge didn't scan. Codes change every 30 seconds: try again.");
    if (t === by) return say(false, "That's your own badge.");
    const role = grim.roles[by], caps = ACTS[role] || {}, act = s.act === "ping" ? "ping" : s.act;
    if (act !== "ping" && !caps[act]) return say(false, "Your role can't do that.");
    if (act !== "ping" && mine.filter(x => x.act === act).length >= caps[act]) return say(false, "You've already used that this round.");
    if (act === "neutralise" && (G.out || {})[t]) return say(false, `${nameOf(G, t)} is already offline.`);
    if (act === "phish" && !(ids(G).includes(s.pick) && s.pick !== t)) return say(false, "Choose who the fake message should name.");
    const entry = { by, t, act, at: now, ...(act === "phish" ? { pick: s.pick } : {}) };
    tx.update(grimRef(gid), { [`log.${r}`]: [...log, entry] });
    const scans = [...(sec.round === r ? sec.scans || [] : []), { t, act, at: now }];
    say(true, ackText(G, act, t), { round: r, scans, left: SCANS - scans.length });
  });
}
function ackText(G, act, t) {
  const n = nameOf(G, t);
  return ({ ping: `Pinged ${n}.`, check: `Checking ${n}…`, pair: `${n} added to your pair.`, shield: `Your firewall shields ${n} this round.`, trace: `Tracing ${n}…`,
    autopsy: `Examining ${n}'s badge…`, sniff: `Sniffing ${n}'s traffic…`, trap: `A honeypot is set on ${n}.`, patch: `Patching ${n}…`,
    neutralise: `Attack on ${n} launched.`, frame: `${n} is being deepfaked.`, spoof: `${n}'s results are being spoofed.`, phish: `Phishing message sent to ${n}.`,
    probe: `Probing ${n}…` })[act] + " Reports arrive at the briefing.";
}

/* ---------- The briefing: working out the round ---------- */
function resolve(G, grim, r) {
  const log = (grim.log || {})[r] || [], roles = grim.roles, out0 = G.out || {};
  const live0 = online(G), N = p => nameOf(G, p);
  const by = act => log.filter(x => x.act === act);
  const patched = new Set(by("patch").map(x => x.t));
  const framed = new Set(by("frame").map(x => x.t).filter(t => !patched.has(t)));
  const spoofed = new Set(by("spoof").map(x => x.t).filter(t => !patched.has(t)));
  const shielded = new Set(by("shield").map(x => x.t));
  const reports = {}; live0.forEach(p => reports[p] = []);
  const rep = (p, icon, text) => (reports[p] = reports[p] || []).push({ icon, text });
  // Who looks like what to the Agents' checks
  const looks = p => framed.has(p) ? "spy" : ["deepfake", "sleeper"].includes(roles[p]) ? "agent" : teamOf(roles[p]);
  const seenRole = p => roles[p] === "sleeper" ? grim.cover[p] : roles[p];
  const other = (t, pool) => { const xs = pool.filter(x => x !== t); return xs.length ? pick(xs) : t; };
  const T = t => t === "spy" ? "a Spy" : "an Agent", flip = t => t === "spy" ? "agent" : "spy";
  // The Black Hat's attack
  const offline = [], blocked = [];
  for (const x of by("neutralise")) {
    if (out0[x.t] || offline.includes(x.t)) continue;
    if (shielded.has(x.t)) { blocked.push(x.t); rep(x.by, "🧱", `Your attack on ${N(x.t)} was blocked by a Firewall.`); }
    else { offline.push(x.t); rep(x.by, "💥", `${N(x.t)} is offline.`); }
  }
  const scannedBy = t => log.filter(x => x.t === t).map(x => x.by);
  for (const x of log) {
    const s = spoofed.has(x.by), n = N(x.t);
    switch (x.act) {
      case "check": rep(x.by, "🔎", `${n} is ${T(s ? flip(looks(x.t)) : looks(x.t))}.`); break;
      case "trace": {
        let hits = [...new Set(log.filter(y => y.by === x.t).map(y => y.t))];
        if (s) hits = shuffle(ids(G).filter(p => p !== x.t && p !== x.by && !hits.includes(p))).slice(0, Math.max(1, hits.length));
        rep(x.by, "🛰️", hits.length ? `${n} scanned ${hits.map(N).join(" and ")}.` : `${n} scanned nobody.`); break;
      }
      case "autopsy": {
        if (!out0[x.t]) { rep(x.by, "🧪", `${n} is still online: there's nothing to examine yet.`); break; }
        let role = seenRole(x.t); if (s) role = pick(teamOf(role) === "spy" ? AGENTS : SPIES);
        rep(x.by, "🧪", `${n} was the ${NAME[role]}.`); break;
      }
      case "sniff": { let yes = scannedBy(x.t).some(p => p !== x.by && teamOf(roles[p]) === "spy"); if (s) yes = !yes;
        rep(x.by, "📡", yes ? `A Spy scanned ${n} this round.` : `No Spy scanned ${n} this round.`); break; }
      case "trap": {
        const caught = [...new Set(scannedBy(x.t).filter(p => p !== x.by && teamOf(roles[p]) === "spy"))];
        let who = caught.length ? pick(caught) : null;
        if (s) who = who ? null : other(x.by, ids(G).filter(p => teamOf(roles[p]) === "agent" && p !== x.t));
        rep(x.by, "🍯", who ? `${N(who)} took the bait on ${n}: they're a Spy.` : `No Spy took the bait on ${n}.`); break;
      }
      case "patch": { let hit = log.some(y => y.t === x.t && ["frame", "spoof"].includes(y.act)); if (s) hit = !hit;
        rep(x.by, "🩹", hit ? `${n} had been tampered with. You patched it.` : `${n} was clean.`); break; }
      case "shield": if (!blocked.includes(x.t)) rep(x.by, "🛡️", `You shielded ${n}.`); else rep(x.by, "🛡️", `You shielded ${n}, and blocked an attack on them!`); break;
      case "probe": rep(x.by, "💤", `${n} is the ${NAME[roles[x.t]]}.`); break;
      case "frame": rep(x.by, "🎭", `${n} looked like a Spy this round.`); break;
      case "spoof": rep(x.by, "👻", `${n}'s results were spoofed.`); break;
      case "phish": rep(x.by, "🎣", `${n} got your message: "${N(x.pick)} is not the Black Hat."`); break;
    }
  }
  // The Network Admin: their first two scans, as a pair
  for (const p of live0.filter(q => roles[q] === "netadmin")) {
    const pr = log.filter(x => x.by === p && x.act === "pair").map(x => x.t);
    if (pr.length < 2) { if (pr.length) rep(p, "🌐", "You need to scan two badges to compare them."); continue; }
    let same = looks(pr[0]) === looks(pr[1]); if (spoofed.has(p)) same = !same;
    rep(p, "🌐", `${N(pr[0])} and ${N(pr[1])} are ${same ? "on the same team" : "on different teams"}.`);
  }
  // A message from HQ (true) to one Agent still online, and the Phishers' fake ones (which look the same)
  const hq = [], liveAfter = live0.filter(p => !offline.includes(p));
  const agents = liveAfter.filter(p => teamOf(roles[p]) === "agent");
  if (agents.length) {
    const to = pick(agents), about = live0.filter(p => p !== to && roles[p] !== "blackhat");
    if (about.length) hq.push({ to, about: pick(about) });
  }
  for (const x of by("phish")) hq.push({ to: x.t, about: x.pick });
  for (const m of shuffle(hq)) rep(m.to, "📨", `HQ: ${N(m.about)} is not the Black Hat.`);
  // Who didn't scan
  const idle = live0.filter(p => !log.some(x => x.by === p));
  return { offline, blocked: blocked.length, idle, reports };
}

function winner(G, roles, out) {
  const live = ids(G).filter(p => !out[p]);
  const bh = ids(G).find(p => roles[p] === "blackhat");
  if (out[bh] === "detained") return "agents";
  const sp = live.filter(p => teamOf(roles[p]) === "spy").length;
  return sp >= live.length - sp ? "spies" : null;
}
async function finish(gid, G, grim, win, out) {
  await db.doc(`esp/${gid}`).update({ status: "over", phase: "over", winner: win, out, overAt: Date.now(),
    reveal: Object.fromEntries(ids(G).map(p => [p, grim.roles[p]])) });
}

async function briefing(gid, G) {
  const r = G.round || 0;
  const gs = await grimRef(gid).get(); if (!gs.exists) return;
  const grim = gs.data(); if ((grim.done || {})[`b${r}`]) return;
  const res = resolve(G, grim, r);
  const out = { ...(G.out || {}) }; res.offline.forEach(p => out[p] = "offline");
  const b = db.batch();
  b.update(grimRef(gid), { [`done.b${r}`]: Date.now() });
  for (const p of Object.keys(res.reports)) b.set(secretRef(gid, p), { reports: { [r]: res.reports[p] } }, { merge: true });
  b.update(db.doc(`esp/${gid}`), { out, [`brief.${r}`]: { offline: res.offline, blocked: res.blocked, idle: res.idle } });
  await b.commit();
  const win = winner(G, grim.roles, out);
  if (win) await finish(gid, G, grim, win, out);
}

/* ---------- The vote ---------- */
async function tally(gid, G) {
  const r = G.round || 0;
  const gs = await grimRef(gid).get(); if (!gs.exists) return;
  const grim = gs.data(); if ((grim.done || {})[`v${r}`]) return;
  const live = online(G), vs = await db.collection(`esp/${gid}/votes`).get(), votes = {};
  vs.forEach(v => { const x = v.data(); if (x.r === r && live.includes(v.id) && (x.of === "skip" || ids(G).includes(x.of))) votes[v.id] = x.of; });
  const n = {}; Object.values(votes).forEach(t => { if (t !== "skip") n[t] = (n[t] || 0) + 1; });
  const top = Math.max(0, ...Object.values(n)), lead = Object.keys(n).filter(t => n[t] === top);
  const detained = top > 0 && lead.length === 1 ? lead[0] : null;
  const out = { ...(G.out || {}) }; if (detained) out[detained] = "detained";
  await grimRef(gid).update({ [`done.v${r}`]: Date.now() });
  await db.doc(`esp/${gid}`).update({ out, [`result.${r}`]: { votes, detained, tie: top > 0 && lead.length > 1 } });
  const win = winner(G, grim.roles, out);
  if (win) await finish(gid, G, grim, win, out);
}

/* ---------- The host moved the game on ---------- */
async function onUpdate(gid, before, after) {
  if (after.deleteReq && !before.deleteReq) return db.recursiveDelete(db.doc(`esp/${gid}`));
  if (before.status === "lobby" && after.status === "deal") return deal(gid, after);
  if (after.status !== "running" || before.phase === after.phase) return;
  if (after.phase === "brief" && before.phase === "mingle") return briefing(gid, after);
  if (after.phase === "result" && before.phase === "vote") return tally(gid, after);
}

const DAY = 86400000;
function expired(G, now) {
  if (G.deleteReq) return true;
  if (G.status === "over") return !!G.overAt && now - G.overAt > 7 * DAY;
  return !!G.created && now - G.created > 7 * DAY;
}
async function cleanup(now = Date.now()) {
  const q = await db.collection("esp").get(); let n = 0;
  for (const g of q.docs) if (expired(g.data(), now)) { await db.recursiveDelete(g.ref); n++; }
  return n;
}

module.exports = { init, onJoin, onScan, onUpdate, deal, briefing, tally, resolve, winner, readToken, badgeCode, spyCount, expired, cleanup, AGENTS, SPIES, ACTS, NAME, WIN, seatLetter };
