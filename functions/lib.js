// Clocktower Daily: phone notifications.
// A scheduled check every few minutes sends the timetable notifications (dawn, nominations, voting closing,
// the execution, night actions); Firestore triggers send the instant ones (nominations, defences, messages).
// Notifications go by standard web push. The server makes its own keys the first time it runs:
// the private key stays in config/vapid (no app can read it), the public one goes in pub/vapid.
const webpush = require("web-push");

const BASE = "https://sirlegend123.github.io/Games/";
const H = 3600000, MIN = 60000;
let db, sender;

function init(firestore, send) { db = firestore; sender = send || webSend; }

/* ---------- Keys and sending ---------- */
let keys = null;
async function vapid() {
  if (keys) return keys;
  const ref = db.doc("config/vapid"), snap = await ref.get();
  if (snap.exists) keys = snap.data();
  else {
    keys = webpush.generateVAPIDKeys();
    await ref.set(keys);
    await db.doc("pub/vapid").set({ publicKey: keys.publicKey, at: Date.now() });
  }
  webpush.setVapidDetails(BASE, keys.publicKey, keys.privateKey);
  return keys;
}
async function webSend(sub, payload) {
  await vapid();
  return webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "high" });
}

/* ---------- The characters that choose at night (as in daily.js) ---------- */
const ACTS = {
  "Poisoner": { first: true, other: true }, "Monk": { other: true }, "Imp": { other: true },
  "Fortune Teller": { first: true, other: true }, "Butler": { first: true, other: true }, "Ravenkeeper": { other: true }
};
const actsAt = (role, n) => { const a = ACTS[role]; return !!(a && (n === 1 ? a.first : a.other)); };

/* ---------- Helpers ---------- */
const nameOf = (G, pid) => ((G.seats || []).find(s => s.id === pid) || {}).name || "Someone";
const seatIds = G => (G.seats || []).map(s => s.id);
const clip = (s, n = 140) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const fmt = (G, ms) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: G.tz || "Europe/London" });
async function load(gid) {
  const [g, grim] = await Promise.all([db.doc(`games/${gid}`).get(), db.doc(`games/${gid}/st/grim`).get()]);
  return g.exists ? { G: g.data(), grim: grim.exists ? grim.data() : {} } : null;
}
const aliveOf = (G, grim) => seatIds(G).filter(p => !(grim.dead || {})[p]);

// Send to players (by seat) and/or the Storyteller ("st"). Only devices still linked to that seat get it.
async function notify(gid, G, targets, msg) {
  if (!targets.length) return 0;
  const subs = await db.collection(`games/${gid}/push`).get();
  let sent = 0;
  await Promise.all(subs.docs.map(async d => {
    const s = d.data(), uid = d.id;
    const isST = s.role === "st" && uid === G.st && targets.includes("st");
    const isPlayer = s.role === "player" && s.pid && (G.uids || {})[s.pid] === uid && targets.includes(s.pid);
    if (!s.sub || !(isST || isPlayer)) return;
    const url = pageUrl(G, gid, isST);
    try { await sender(s.sub, { title: msg.title, body: msg.body || "", tag: msg.tag || "", url }); sent++; }
    catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await d.ref.delete(); else console.warn("push failed", gid, uid, e && (e.statusCode || e.message)); }
  }));
  return sent;
}

// Each game opens in its own app: Clocktower Daily, or The Shadows
const isShd = G => G.kind === "shadows";
const pageUrl = (G, gid, host) => `${BASE}${isShd(G) ? (host ? "shadows-host.html" : "shadows.html") : host ? "daily-st.html" : "daily.html"}?g=${gid}`;

/* ---------- Instant notifications ---------- */
// A device has just turned notifications on: send it a welcome, so people know straight away that it works
async function onSubscribe(gid, uid, s) {
  const g = await db.doc(`games/${gid}`).get(); if (!g.exists || !s || !s.sub) return;
  const G = g.data(), isST = s.role === "st" && uid === G.st, isPlayer = s.role === "player" && (G.uids || {})[s.pid] === uid;
  if (!isST && !isPlayer) return;
  try {
    await sender(s.sub, { title: "🔔 Notifications are on", body: isST ? (isShd(G) ? "You'll hear when players message you, and when the round table or the night needs you." : "You'll hear when players message you, and when the Virgin, a Slayer shot, voting or the night needs you.") : `You'll hear from ${G.name || "the game"} when it's your turn.`, tag: `hello-${gid}`, url: pageUrl(G, gid, isST) });
  } catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await db.doc(`games/${gid}/push/${uid}`).delete(); else console.warn("welcome failed", e && (e.statusCode || e.message)); }
}
async function onNomination(gid, d, nominee, nom) {
  const x = await load(gid); if (!x) return;
  const { G, grim } = x, by = nom.by, why = nom.reason ? `“${clip(nom.reason, 120)}”` : "";
  const t = (G.days || {})[d] || {};
  await notify(gid, G, [nominee], { title: `⚖️ ${nameOf(G, by)} has nominated you`, body: `${why} ${t.vote ? `Give your defence within ${G.defMins || 30} minutes. Voting opens at ${fmt(G, t.vote)}.` : `Give your defence: voting opens in ${G.defMins || 30} minutes, or as soon as you do.`}`, tag: `nom-${gid}` });
  await notify(gid, G, aliveOf(G, grim).filter(p => p !== by && p !== nominee), { title: `⚖️ ${nameOf(G, by)} nominated ${nameOf(G, nominee)}`, body: why, tag: `noms-${gid}` });
  if ((grim.roles || {})[nominee] === "Virgin" && !grim.virginDone)
    await notify(gid, G, ["st"], { title: "🕊️ The Virgin has been nominated", body: `${nameOf(G, by)} nominated ${nameOf(G, nominee)}. Decide what happens.`, tag: `virgin-${gid}` });
}
async function onDefence(gid, d, nominee, before, after) {
  if (before.defence || !after.defence) return;
  const x = await load(gid); if (!x) return;
  const { G, grim } = x;
  const t = (G.days || {})[d] || {};
  await notify(gid, G, aliveOf(G, grim).filter(p => p !== nominee), { title: `⚖️ ${nameOf(G, nominee)} has given a defence`, body: `“${clip(after.defence, 120)}” ${t.vote && Date.now() < t.vote ? `Voting opens at ${fmt(G, t.vote)}.` : "Voting on them is open."}`, tag: `noms-${gid}` });
}
async function onSquare(gid, m) {
  if (m.kind !== "slay") return;
  const x = await load(gid); if (!x) return;
  await notify(gid, x.G, ["st"], { title: "🏹 A Slayer shot", body: `${nameOf(x.G, m.pid)} shot at ${nameOf(x.G, m.target)}. Decide what happens.`, tag: `slay-${gid}` });
}
async function onStChat(gid, pid, m) {
  const x = await load(gid); if (!x) return;
  if (m.from === "st") await notify(gid, x.G, [pid], { title: isShd(x.G) ? "✉️ The host" : "✉️ The Storyteller", body: clip(m.text), tag: `st-${gid}` });
  else await notify(gid, x.G, ["st"], { title: `✉️ ${nameOf(x.G, pid)}`, body: clip(m.text), tag: `stc-${gid}-${pid}` });
}
async function onChat(gid, pair, m) {
  const to = pair.split("~").find(p => p !== m.from);
  if (!to) return;
  const x = await load(gid); if (!x) return;
  await notify(gid, x.G, [to], { title: `✉️ ${nameOf(x.G, m.from)}`, body: clip(m.text), tag: `chat-${gid}-${pair}` });
}

// The Shadows: a message in the Shadows' chat goes to the other Shadows still in the game
async function onConclave(gid, m) {
  const x = await load(gid); if (!x) return;
  const sides = x.grim.sides || {}, to = aliveOf(x.G, x.grim).filter(p => sides[p] === "shadow" && p !== m.from);
  await notify(gid, x.G, to, { title: `🗡️ ${m.from === "host" ? "The host" : nameOf(x.G, m.from)} (Shadows)`, body: clip(m.text), tag: `conclave-${gid}` });
}

/* ---------- Timetable notifications, checked every few minutes ---------- */
async function tick(now = Date.now()) {
  await vapid();
  const q = await db.collection("games").where("status", "in", ["running", "over"]).get();
  let total = 0;
  for (const g of q.docs) {
    const G = g.data();
    if (G.pushDone) continue;
    try { total += await tickGame(g.id, G, now); } catch (e) { console.error("tick", g.id, e); }
  }
  return total;
}
async function tickGame(gid, G, now) {
  const stateRef = db.doc(`games/${gid}/srv/push`), state = (await stateRef.get()).data() || {}, sent = state.sent || {};
  const grimSnap = await db.doc(`games/${gid}/st/grim`).get(), grim = grimSnap.exists ? grimSnap.data() : {};
  const all = seatIds(G), alive = aliveOf(G, grim), due = [];
  const once = (key, targets, msg) => { if (!sent[key]) { sent[key] = now; due.push([targets, msg]); } };
  const gated = async k => { const s = await db.doc(`games/${gid}/gated/${k}`).get(); return s.exists ? s.data() : null; };
  const d = G.day || 0, t = d && (G.days || {})[d];
  if (isShd(G)) await shadowsDue({ gid, G, grim, now, d, t, all, alive, once, gated });
  else if (t) {
    if (now >= t.dawn && now < t.dawn + 6 * H) {
      const dawn = await gated("dawn" + d);
      if (dawn) { const ds = (dawn.deaths || []).map(x => nameOf(G, x.pid));
        once(`dawn${d}`, all, { title: `🌅 Day ${d} has dawned`, body: ds.length ? `${ds.join(" and ")} ${ds.length === 1 ? "was" : "were"} found dead in the night.` : d === 1 ? "There is a Demon amongst you. Find out who." : "Nobody died in the night.", tag: `day-${gid}` }); }
    }
    if (now >= t.noms && now < (t.vote || t.close)) once(`noms${d}`, alive, { title: "⚖️ Nominations are open", body: t.vote ? `Nominate, and defend yourself if you're nominated, until ${fmt(G, t.vote)}. Voting opens then.` : `Nominate, defend yourself and vote until ${fmt(G, t.close)}.`, tag: `day-${gid}` });
    if (t.vote && now >= t.vote && now < t.close) once(`vote${d}-${t.vote}`, all, { title: "🗳️ Voting is open", body: `Vote on the nominations before ${fmt(G, t.close)}.`, tag: `day-${gid}` });
    if (now >= t.close - 30 * MIN && now < t.close) once(`close30-${d}-${t.close}`, all, { title: "🔒 Voting closes in 30 minutes", body: `Get your votes in before ${fmt(G, t.close)}.`, tag: `day-${gid}` });
    if (now >= t.close && now < t.close + 6 * H && !(grim.results || {})[d]) once(`closed-${d}-${t.close}`, ["st"], { title: "🔒 Voting has closed", body: `Confirm the execution before ${fmt(G, t.reveal)}.`, tag: `st-day-${gid}` });
    if (now >= t.reveal && now < t.reveal + 6 * H) {
      const r = await gated("result" + d);
      if (r) once(`reveal${d}`, all, { title: r.exec ? `🪓 ${nameOf(G, r.exec)} has been executed` : "🪓 Nobody was executed", body: "See how everyone voted.", tag: `day-${gid}` });
    }
  }
  const n = d + 1, w = (G.nights || {})[n];
  if (w && !G.overAt && !isShd(G)) {
    if (now >= w.open && now < w.end) {
      const secrets = await db.collection(`games/${gid}/secret`).get(), role = {};
      secrets.forEach(s => role[s.id] = s.data().role);
      const actors = alive.filter(p => actsAt(role[p], n));
      once(`night${n}`, actors, { title: `🌙 Night ${n} has fallen`, body: `Choose your night action before ${fmt(G, w.end)}.`, tag: `night-${gid}` });
      if (now >= w.end - 30 * MIN) {
        const acts = await db.collection(`games/${gid}/nights/${n}/acts`).get(), done = new Set(acts.docs.map(a => a.id));
        once(`nightRemind${n}-${w.end}`, actors.filter(p => !done.has(p)), { title: "🌙 30 minutes left", body: `Choose your night action before ${fmt(G, w.end)}.`, tag: `night-${gid}` });
      }
    }
    if (now >= w.end && now < w.end + 12 * H && d < n) once(`nightEnd${n}-${w.end}`, ["st"], { title: `🕯️ Night ${n} has closed`, body: "Time to write up the night and wake the town.", tag: `st-night-${gid}` });
  }
  let finished = false;
  if (G.overAt && now >= G.overAt) {
    const end = await gated("end");
    if (end) { once("over", all, isShd(G) ? { title: end.winner === "guests" ? "🕯️ The Guests win!" : "🗡️ The Shadows win!", body: "The game is over. See everyone's side.", tag: `day-${gid}` }
      : { title: end.winner === "good" ? "😇 Good wins!" : "😈 Evil wins!", body: "The game is over. See everyone's characters.", tag: `day-${gid}` }); finished = true; }
  }
  if (due.length) await stateRef.set({ sent }, { merge: true });
  let n2 = 0;
  for (const [targets, msg] of due) n2 += await notify(gid, G, targets, msg);
  if (finished) await db.doc(`games/${gid}`).update({ pushDone: true });
  return n2;
}

// The Shadows' timetable: breakfast, the round table, the banishment, and the Shadows' night
async function shadowsDue({ gid, G, grim, now, d, t, all, alive, once, gated }) {
  const sides = grim.sides || {}, shadows = alive.filter(p => sides[p] === "shadow");
  if (t) {
    if (now >= t.dawn && now < t.dawn + 6 * H) {
      const bk = await gated("dawn" + d);
      if (bk) { const ds = (bk.deaths || []).map(x => nameOf(G, x.pid));
        once(`dawn${d}`, all, { title: `🍳 Breakfast is served: Day ${d}`, body: ds.length ? `${ds.join(" and ")} ${ds.length === 1 ? "was" : "were"} murdered in the night.` : "Nobody was murdered in the night.", tag: `day-${gid}` }); }
    }
    if (t.noms && now >= t.noms && now < t.vote) once(`table${d}-${t.noms}`, alive, { title: "🗣️ The round table has begun", body: `Discuss with everyone until ${fmt(G, t.vote)}, when voting begins. Private chats are closed.`, tag: `day-${gid}` });
    if (now >= t.vote && now < t.close) once(`vote${d}-${t.vote}`, alive, { title: "🗳️ Voting has begun", body: `Vote to banish someone before ${fmt(G, t.close)}.`, tag: `day-${gid}` });
    if (now >= t.close - 30 * MIN && now < t.close) {
      const b = await db.collection(`games/${gid}/days/${d}/ballots`).get(), done = new Set(b.docs.map(x => x.id));
      once(`close30-${d}-${t.close}`, alive.filter(p => !done.has(p)), { title: "🔒 30 minutes left to vote", body: `Voting ends at ${fmt(G, t.close)}.`, tag: `day-${gid}` });
    }
    if (now >= t.close && now < t.close + 6 * H && !(grim.results || {})[d]) once(`closed-${d}-${t.close}`, ["st"], { title: "🔒 Voting has ended", body: `Confirm the banishment before ${fmt(G, t.reveal)}.`, tag: `st-day-${gid}` });
    if (now >= t.reveal && now < t.reveal + 6 * H) {
      const r = await gated("result" + d);
      if (r) once(`reveal${d}`, all, { title: r.exec ? `⚖️ ${nameOf(G, r.exec)} has been banished` : "⚖️ Nobody was banished", body: r.exec ? `They were a ${r.side === "shadow" ? "Shadow 🗡️" : "Guest 🕯️"}.` : "See how everyone voted.", tag: `day-${gid}` });
    }
  }
  const n = d + 1, w = (G.nights || {})[n];
  if (w && !G.overAt) {
    // The Shadows meet once today's banishment is confirmed
    if (now >= w.open && now < w.end && (d === 0 || (grim.results || {})[d])) {
      once(`night${n}`, shadows, { title: "🌙 The Shadows meet", body: `Your chat is open: choose tonight's victim before ${fmt(G, w.end)}.`, tag: `night-${gid}` });
      if (now >= w.end - 30 * MIN) {
        const acts = await db.collection(`games/${gid}/nights/${n}/acts`).get(), done = new Set(acts.docs.map(a => a.id));
        once(`nightRemind${n}-${w.end}`, shadows.filter(p => !done.has(p)), { title: "🌙 30 minutes left", body: `Choose tonight's victim before ${fmt(G, w.end)}.`, tag: `night-${gid}` });
      }
    }
    if (now >= w.end && now < w.end + 12 * H && d < n) once(`nightEnd${n}-${w.end}`, ["st"], { title: `🕯️ Night ${n} has closed`, body: "Work out the night and serve breakfast.", tag: `st-night-${gid}` });
  }
}

/* ---------- Deleting old games ----------
   A finished game is deleted 30 days after it ends; a game that never started, 30 days after it was set up;
   one left unfinished, 90 days after it started. The Storyteller can also delete a game at any time. */
const DAY = 24 * H;
function expired(G, now) {
  if (G.deleteReq) return true;
  if (G.status === "over") return !!G.overAt && now - G.overAt > 30 * DAY;
  if (G.status === "lobby") return !!G.created && now - G.created > 30 * DAY;
  const from = G.started || G.created;
  return !!from && now - from > 90 * DAY;
}
async function cleanup(now = Date.now()) {
  const q = await db.collection("games").get();
  let n = 0;
  for (const g of q.docs) if (expired(g.data(), now)) { await db.recursiveDelete(g.ref); n++; }
  return n;
}
// The Storyteller pressed "Delete this game": everything under it goes now
async function onGameUpdate(gid, before, after) {
  if (after.deleteReq && !before.deleteReq) await db.recursiveDelete(db.doc(`games/${gid}`));
}

module.exports = { init, vapid, notify, tick, tickGame, expired, cleanup, onGameUpdate, onConclave, onSubscribe, onNomination, onDefence, onSquare, onStChat, onChat, actsAt };
