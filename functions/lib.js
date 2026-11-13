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
  // The Shadows: a Guest who sends the host today's code phrase has caught it
  const d = x.G.day || 0, M = missionOpen(x.G, x.grim);
  if (m.from !== "st" && M && (x.grim.sides || {})[pid] === "guest" && !M.caught && saysPhrase(m.text, M.phrase)) {
    await db.doc(`games/${gid}/st/grim`).update({ [`missions.${d}.caught`]: { by: pid, at: Date.now() } });
    await notify(gid, x.G, ["st"], { title: `🔎 ${nameOf(x.G, pid)} caught the code phrase`, body: "The Shadows can't murder tonight.", tag: `challenge-${gid}` });
  }
}
// The Shadows: today's code phrase (the Shadows' mission) and the Whisper (today's task), until the round table
const normPhrase = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const saysPhrase = (text, phrase) => !!normPhrase(phrase) && (" " + normPhrase(text) + " ").includes(" " + normPhrase(phrase) + " ");
const dayOpenNow = (G, d) => { const t = (G.days || {})[d] || {}; return Date.now() >= (t.dawn || Infinity) && Date.now() < (t.noms || 0); };
const missionOpen = (G, grim) => { const d = G.day || 0, M = (grim.missions || {})[d]; return isShd(G) && M && M.phrase && !M.done && dayOpenNow(G, d) ? M : null; };
const whisperOpen = (G, grim) => { const d = G.day || 0, W = (grim.tasks || {})[d]; return isShd(G) && W && W.type === "whisper" && !W.done && !W.complete && !W.failed && dayOpenNow(G, d) ? W : null; };
async function onChat(gid, pair, m) {
  const to = pair.split("~").find(p => p !== m.from);
  if (!to) return;
  const x = await load(gid); if (!x) return;
  await notify(gid, x.G, [to], { title: `✉️ ${nameOf(x.G, m.from)}`, body: clip(m.text), tag: `chat-${gid}-${pair}` });
  // Nobody reads the chat: these only look for today's phrases
  const sides = x.grim.sides || {}, d = x.G.day || 0, M = missionOpen(x.G, x.grim), at = Date.now();
  // A Shadow slipping the code phrase to a Guest
  if (M && sides[m.from] === "shadow" && sides[to] === "guest" && !(M.said || {})[m.from] && saysPhrase(m.text, M.phrase)) {
    await db.doc(`games/${gid}/st/grim`).update({ [`missions.${d}.said.${m.from}`]: { to, at } });
    await db.doc(`games/${gid}/secret/${m.from}`).update({ "mission.said": at });
  }
  // A day off: the first Guest to say the Shadows' word in a private chat is marked to die tonight (murder in plain sight)
  const PM = (x.grim.missions || {})[d];
  if (PM && PM.type === "plainsight" && !PM.marked && !PM.done && dayOpenNow(x.G, d) && sides[m.from] === "guest" && saysPhrase(m.text, PM.word)) {
    await db.doc(`games/${gid}/st/grim`).update({ [`missions.${d}.marked`]: { pid: m.from, to, at } });
    for (const p of seatIds(x.G).filter(q => sides[q] === "shadow" && !(x.grim.dead || {})[q])) await db.doc(`games/${gid}/secret/${p}`).update({ "mission.marked": { pid: m.from, at } });
    await notify(gid, x.G, ["st"], { title: "🗡️ Murder in plain sight", body: `${nameOf(x.G, m.from)} said the word. They die tonight.`, tag: `challenge-${gid}` });
  }
  // The Combination: a digit shared with the button (true, or a Shadow's one lie)
  const CW = (x.grim.tasks || {})[d];
  if (m.share && CW && CW.type === "combination" && !CW.done && dayOpenNow(x.G, d)) {
    const share = { from: m.from, to, pos: m.share.pos, digit: String(m.share.digit), lie: String(m.share.digit) !== CW.code[m.share.pos], at };
    await db.doc(`games/${gid}/st/grim`).update({ [`tasks.${d}.shares`]: require("firebase-admin").firestore.FieldValue.arrayUnion(share) });
    if (share.lie) await db.doc(`games/${gid}/secret/${m.from}`).update({ "combo.lied": { to, digit: share.digit, at } });
  }
  // The Whisper: passed on once, to someone who hasn't had it, round everyone and back to the start
  const W = whisperOpen(x.G, x.grim);
  if (W) await whisperSaid(gid, x.G, x.grim, d, W, m.from, to, at, m);
}
// The Combination: a code entered by a player. Checked against the secret code; the first correct one wins the task's shield.
// The Shadows' mission ("mislead"): a Guest enters a wrong code with a wrong digit in a place a Shadow holds.
async function onCode(gid, d, e) {
  const x = await load(gid); if (!x) return;
  const { G, grim } = x, W = (grim.tasks || {})[d], sides = grim.sides || {}, pid = e.pid, at = e.at || Date.now();
  if (!isShd(G) || !W || W.type !== "combination" || W.done || W.cracked || (grim.dead || {})[pid] || !dayOpenNow(G, d)) return;
  const sref = db.doc(`games/${gid}/secret/${pid}`), sec = (await sref.get()).data() || {}, C = sec.combo || {};
  if (C.d !== +d || (C.used || 0) >= (W.tries || 2)) return;
  const code = String(e.code || "").replace(/\D/g, ""), ok = code === W.code;
  await sref.update({ "combo.used": (C.used || 0) + 1, "combo.results": [...(C.results || []), { code, ok, at }] });
  const g = db.doc(`games/${gid}/st/grim`), entry = { pid, code, ok, at };
  const u = { [`tasks.${d}.entries`]: [...(W.entries || []), entry] };
  const M = (grim.missions || {})[d];
  if (!ok && M && M.type === "mislead" && !M.misled && sides[pid] === "guest") {
    // The Guest believed a Shadow's lie: their code has the lied digit, in the lied place
    const lies = (W.shares || []).filter(x => x.lie);
    if (lies.some(l => code[l.pos] === l.digit)) {
      u[`missions.${d}.misled`] = { by: pid, at, code };
      for (const p of seatIds(G).filter(q => sides[q] === "shadow" && !(grim.dead || {})[q])) await db.doc(`games/${gid}/secret/${p}`).update({ "mission.misled": at });
    }
  }
  if (ok) {
    u[`tasks.${d}.cracked`] = at; u[`tasks.${d}.winner`] = pid; u[`wshield.${+d + 1}`] = pid;
    const b = db.batch();
    b.update(db.doc(`games/${gid}`), { [`days.${d}.cracked`]: at });
    b.set(db.collection(`games/${gid}/square`).doc(), { pid: "", kind: "st", d: +d, at, text: "🔐 The combination has been cracked! Who cracked it, and the code, are revealed at the round table." });
    b.update(sref, { info: require("firebase-admin").firestore.FieldValue.arrayUnion({ n: +d, at, label: "Shield", text: "🔐 You cracked the combination: you have a shield tonight, and can't be murdered. Everyone is told at the round table." }) });
    await b.commit();
    await notify(gid, G, ["st"], { title: "🔐 The combination has been cracked", body: `${nameOf(G, pid)} got it, and has the shield.`, tag: `combo-${gid}` });
  }
  await g.update(u);
}
// The Lanterns: each player has a secret number, and the lanterns must be lit in order. Lighting out of turn puts them all
// out (one attempt used). Each lighter names who deserves the shield; if all are lit, the most named gets it.
// The Shadows' mission ("snuff"): a Guest lights out of turn.
async function onLight(gid, d, e) {
  const x = await load(gid); if (!x) return;
  const { G, grim } = x, W = (grim.tasks || {})[d], sides = grim.sides || {}, pid = e.pid, at = e.at || Date.now(), dead = grim.dead || {};
  if (!isShd(G) || !W || W.type !== "lanterns" || W.done || W.complete || W.failed || dead[pid] || !dayOpenNow(G, d) || !(pid in (W.nums || {}))) return;
  const cur = W.cur || [], attempt = W.attempt || 1, alive = seatIds(G).filter(p => !dead[p]);
  if (cur.some(c => c.pid === pid)) return;   // already lit this time
  const g = db.doc(`games/${gid}/st/grim`), FV = require("firebase-admin").firestore.FieldValue;
  if (W.nums[pid] === cur.length + 1) {
    const lit = [...cur, { pid, nominee: e.nominee, at }], u = { [`tasks.${d}.cur`]: lit };
    await db.doc(`games/${gid}/secret/${pid}`).update({ "lantern.lit": attempt });
    if (lit.length === Object.keys(W.nums).length) {
      // All lit: the most named wins (a tie: whoever reached that many first)
      const count = {}; let best = null, top = 0;
      for (const c of lit) { count[c.nominee] = (count[c.nominee] || 0) + 1; if (count[c.nominee] > top) { top = count[c.nominee]; best = c.nominee; } }
      Object.assign(u, { [`tasks.${d}.complete`]: at, [`tasks.${d}.winner`]: best, [`tasks.${d}.named`]: count, [`wshield.${+d + 1}`]: best });
      const b = db.batch();
      b.update(db.doc(`games/${gid}`), { [`days.${d}.lan`]: { attempt, complete: at } });
      b.set(db.collection(`games/${gid}/square`).doc(), { pid: "", kind: "st", d: +d, at, text: "🕯️ All the lanterns are lit! Who the flame was passed to is revealed at the round table." });
      if (best) b.update(db.doc(`games/${gid}/secret/${best}`), { info: FV.arrayUnion({ n: +d, at, label: "Shield", text: "🕯️ The flame was passed to you most: you have a shield tonight, and can't be murdered. Everyone is told at the round table." }) });
      await b.commit();
      await notify(gid, G, ["st"], { title: "🕯️ All the lanterns are lit", body: best ? `${nameOf(G, best)} was named most, and has the shield.` : "", tag: `lantern-${gid}` });
    }
    await g.update(u);
    return;
  }
  // Out of turn: the lanterns go out
  const resets = [...(W.resets || []), { by: pid, attempt, wanted: cur.length + 1, num: W.nums[pid], at }], failed = attempt >= (W.attempts || 3);
  const u = { [`tasks.${d}.cur`]: [], [`tasks.${d}.resets`]: resets, [`tasks.${d}.attempt`]: attempt + 1, ...(failed ? { [`tasks.${d}.failed`]: at } : {}) };
  const M = (grim.missions || {})[d];
  if (M && M.type === "snuff" && !M.snuffed && sides[pid] === "guest") {
    u[`missions.${d}.snuffed`] = { by: pid, at };
    for (const p of alive.filter(q => sides[q] === "shadow")) await db.doc(`games/${gid}/secret/${p}`).update({ "mission.snuffed": at });
  }
  await g.update(u);
  const b = db.batch();
  b.update(db.doc(`games/${gid}`), { [`days.${d}.lan`]: { attempt: attempt + 1, ...(failed ? { failed: at } : {}), out: at } });
  b.set(db.collection(`games/${gid}/square`).doc(), { pid: "", kind: "st", d: +d, at, text: failed ? "🌬️ The lanterns have gone out, and there are no attempts left. No shield today." : `🌬️ The lanterns have gone out! Someone lit theirs out of turn. Attempt ${attempt + 1} of ${W.attempts || 3}: start again from 1.` });
  await b.commit();
  await notify(gid, G, alive, { title: "🌬️ The lanterns have gone out", body: failed ? "No attempts left: no shield today." : `Attempt ${attempt + 1} of ${W.attempts || 3}. Start again from 1.`, tag: `lantern-${gid}` });
}
// The whisper each player was given (the starter: the original), and one word added to it
const words = s => normPhrase(s).split(" ").filter(Boolean);
function oneWordAdded(a, b) {
  const A = words(a), B = words(b);
  if (B.length !== A.length + 1) return null;
  for (let i = 0; i < B.length; i++) if ([...B.slice(0, i), ...B.slice(i + 1)].join(" ") === A.join(" ")) return B[i];
  return null;
}
async function whisperSaid(gid, G, grim, d, W, from, to, at, m) {
  const g = db.doc(`games/${gid}/st/grim`), had = W.had || {}, passed = W.passed || {}, dead = grim.dead || {}, sides = grim.sides || {};
  const got = (W.got || {})[from] || (from === W.start ? W.phrase : ""), sent = (W.sent || {})[from] || "", text = m.text || "";
  // After passing it on, saying it again (what you were given, or what you passed) puts you out of the running
  if (passed[from]) {
    if ((saysPhrase(text, got) || saysPhrase(text, sent)) && !(W.out || {})[from]) { await g.update({ [`tasks.${d}.out.${from}`]: at }); await db.doc(`games/${gid}/secret/${from}`).update({ "whisper.out": at }); }
    return;
  }
  if (!had[from] || !got) return;   // they've not been given it: it doesn't count
  // A pass: the whisper as given (a Guest), or with one word added (a Shadow who isn't the starter). Sent with the button, or typed.
  const added = sides[from] === "shadow" && from !== W.start ? oneWordAdded(got, text) : null;
  const isPass = m.whisper ? (normPhrase(text) === normPhrase(got) || added) : (normPhrase(text) === normPhrase(got) || added || saysPhrase(text, got));
  if (!isPass) return;
  const passText = added ? text.trim() : got;
  const alive = seatIds(G).filter(p => !dead[p]), everyone = alive.every(p => had[p] || p === to);
  const closing = to === W.start && alive.every(p => had[p]);
  if (had[to] && !closing) {
    // Sent to someone who's already had it: it stays with the sender, and counts as another time for them. A third time fails the task.
    const times = 2 + ((W.repeats || {})[to] || 0);
    if (times >= 3) {
      const b = db.batch();
      b.update(g, { [`tasks.${d}.repeats.${to}`]: times - 1, [`tasks.${d}.failed`]: { pid: to, by: from, at } });
      b.update(db.doc(`games/${gid}`), { [`days.${d}.wfail`]: { at } });
      b.set(db.collection(`games/${gid}/square`).doc(), { pid: "", kind: "st", d, at, text: "🤫 The Whisper has failed: someone was sent it for the third time. No shield today." });
      await b.commit();
      await notify(gid, G, alive, { title: "🤫 The Whisper has failed", body: "Someone was sent it for the third time. No shield today.", tag: `whisper-${gid}` });
      return;
    }
    await g.update({ [`tasks.${d}.repeats.${to}`]: times - 1 });
    await db.doc(`games/${gid}/secret/${from}`).update({ "whisper.bounce": { to, at, times } });
    return;
  }
  const u = { [`tasks.${d}.passed.${from}`]: at, [`tasks.${d}.sent.${from}`]: passText, [`tasks.${d}.chain`]: [...(W.chain || []), { from, to, at, ...(added ? { added } : {}) }] };
  if (added) u[`tasks.${d}.adds`] = [...(W.adds || []), { by: from, to, word: added, at }];
  if (closing) { u[`tasks.${d}.complete`] = at; u[`tasks.${d}.final`] = passText; } else { u[`tasks.${d}.had.${to}`] = at; u[`tasks.${d}.got.${to}`] = passText; }
  await g.update(u);
  await db.doc(`games/${gid}/secret/${from}`).update({ "whisper.passedTo": to, "whisper.passedAt": at, "whisper.bounce": null, ...(added ? { "whisper.added": added } : {}) });
  if (!closing) {
    await db.doc(`games/${gid}/secret/${to}`).update({ whisper: { d, phrase: passText, got: at, from, start: W.start, last: everyone } });
    await notify(gid, G, [to], { title: "🤫 You've been given the whisper", body: everyone ? "Everyone has now had it: pass it back to whoever started it." : "Open The Shadows, and pass it on.", tag: `whisper-${gid}` });
  } else {
    // Only the starter learns whether it came back changed
    await db.doc(`games/${gid}/secret/${to}`).update({ "whisper.final": passText, "whisper.changed": normPhrase(passText) !== normPhrase(W.phrase) });
    await notify(gid, G, [to], { title: "🤫 The whisper has come back to you", body: "Open The Shadows: has it changed?", tag: `whisper-${gid}` });
    await notify(gid, G, ["st"], { title: "🤫 The whisper has gone all the way round", body: `${nameOf(G, from)} passed it home.`, tag: `whisper-${gid}` });
  }
}

// The Shadows: a message in the Shadows' chat goes to the other Shadows still in the game
async function onConclave(gid, m) {
  const x = await load(gid); if (!x) return;
  const sides = x.grim.sides || {}, to = aliveOf(x.G, x.grim).filter(p => sides[p] === "shadow" && p !== m.from);
  if (m.at && m.at > Date.now() + 60000) return;   // held back until the Shadows' chat opens: they hear about it then
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
  const first = G.dayFirst && d === 1, M = (grim.missions || {})[d], W = (grim.tasks || {})[d];
  // The Shadows' mission ends at the round table: every Shadow still in must have said the phrase to a Guest, uncaught
  if (M && t && now >= t.noms && !M.done) {
    const adds = (W && W.adds) || [], ch = (W && W.chain) || [];
    const all = shadows, passed = M.type === "plainsight" ? !!M.marked : M.type === "snuff" ? !!M.snuffed : M.type === "mislead" ? !!M.misled : M.type === "addword" ? adds.some(a => ch.some(c => c.from === a.to)) : all.every(p => (M.said || {})[p]) && !M.caught, b = db.batch();
    b.update(db.doc(`games/${gid}/st/grim`), { [`missions.${d}.done`]: true, [`missions.${d}.passed`]: passed });
    for (const p of all) b.update(db.doc(`games/${gid}/secret/${p}`), { "mission.done": true, "mission.passed": passed, "mission.caught": !!M.caught });
    b.set(db.collection(`games/${gid}/square`).doc(), { pid: "", kind: "st", d, at: now + 2, text: M.type === "plainsight"
      ? (passed ? "🌤️ We hope you all enjoyed your day off… but the Shadows were busy. Today, right under your noses, they committed a murder in plain sight. One of you will not live to see breakfast." : "🌤️ We hope you all enjoyed your day off. All was quiet… this time.")
      : passed ? "🗝️ The Shadows completed their secret mission today. Tonight, they may murder." : "🗝️ The Shadows failed their secret mission today. Tonight, nobody will be murdered." });
    await b.commit(); M.done = true; M.passed = passed;
    once(`mission${d}`, ["st"], { title: passed ? "✅ The Shadows completed their mission" : "❌ The Shadows failed their mission", body: passed ? (M.type === "plainsight" ? `${nameOf(G, M.marked.pid)} said the word: they die tonight.` : "They may murder tonight.") : M.type === "plainsight" ? "No Guest said the word: no murder tonight." : M.type === "snuff" ? "No Guest lit out of turn: no murder tonight." : M.type === "mislead" ? "No Guest entered a wrong code: no murder tonight." : M.type === "addword" ? "No changed whisper was passed on: no murder tonight." : M.caught ? "A Guest caught the code phrase: no murder tonight." : "Not every Shadow said the phrase: no murder tonight.", tag: `challenge-${gid}` });
  }
  // The Whisper ends at the round table: if it went all the way round, the last player still in the running to say it gets a shield
  if (W && W.type === "lanterns" && t && now >= t.noms && !W.done) {
    const outs = (W.resets || []).map(r => `${nameOf(G, r.by)} (attempt ${r.attempt})`).join(", "), b = db.batch();
    b.update(db.doc(`games/${gid}/st/grim`), { [`tasks.${d}.done`]: true });
    b.set(db.collection(`games/${gid}/square`).doc(), { pid: "", kind: "st", d, at: now, text: W.complete
      ? `🕯️ The Lanterns: ✅ all lit, on attempt ${W.attempt || 1}. ${W.winner ? `The flame was passed to ${nameOf(G, W.winner)} most: they have a shield tonight.` : ""}${outs ? ` Lit out of turn: ${outs}.` : ""}`
      : `🕯️ The Lanterns: ❌ not all lit${W.failed ? ", and no attempts left" : " in time"}. No shield today.${outs ? ` Lit out of turn: ${outs}.` : ""}` });
    await b.commit(); W.done = true;
  }
  if (W && W.type === "combination" && t && now >= t.noms && !W.done) {
    const b = db.batch();
    b.update(db.doc(`games/${gid}/st/grim`), { [`tasks.${d}.done`]: true });
    b.set(db.collection(`games/${gid}/square`).doc(), { pid: "", kind: "st", d, at: now, text: W.cracked
      ? `🔐 The Combination: ✅ cracked by ${nameOf(G, W.winner)}, who has a shield tonight. The code was ${W.code}. Check it against the digits you were told…`
      : `🔐 The Combination: ❌ nobody cracked it in time, so no shield. The code was ${W.code}. Check it against the digits you were told…` });
    await b.commit(); W.done = true;
  }
  if (W && W.type === "whisper" && t && now >= t.noms && !W.done && W.failed) { await db.doc(`games/${gid}/st/grim`).update({ [`tasks.${d}.done`]: true, [`tasks.${d}.winner`]: null }); W.done = true; }
  if (W && W.type === "whisper" && t && now >= t.noms && !W.done) {
    const chain = W.chain || [], out = W.out || {}, last = W.complete ? [...chain].reverse().find(c => !out[c.from]) : null, winner = last ? last.from : null, b = db.batch();
    b.update(db.doc(`games/${gid}/st/grim`), { [`tasks.${d}.done`]: true, [`tasks.${d}.winner`]: winner, ...(winner ? { [`wshield.${d + 1}`]: winner } : {}) });
    b.set(db.collection(`games/${gid}/square`).doc(), { pid: "", kind: "st", d, at: now, text: W.complete ? `🤫 The Whisper: ✅ passed. It went all the way round${winner ? `, and ${nameOf(G, winner)} said it last: they have a shield tonight.` : ", but everyone who could have won had said it twice: no shield."}` : "🤫 The Whisper: ❌ failed. It didn't make it round everyone in time: no shield." });
    if (winner) b.update(db.doc(`games/${gid}/secret/${winner}`), { info: require("firebase-admin").firestore.FieldValue.arrayUnion({ n: d, at: now, label: "Shield", text: "🛡️ You said the whisper last: you have a shield tonight, and can't be murdered. Everyone is told at the round table." }) });
    await b.commit(); W.done = true;
  }
  // Night 1 (after Day 1): the Shadows meet each other for the first time
  const n0 = d + 1, w0 = (G.nights || {})[n0];
  if (G.dayFirst && n0 === 2 && w0 && now >= w0.open && (grim.results || {})[1] && !grim.met) {
    const all = alive.filter(p => sides[p] === "shadow"), b = db.batch(), C = (grim.missions || {})[1] || { passed: true }, FV = require("firebase-admin").firestore.FieldValue;
    for (const p of all) b.update(db.doc(`games/${gid}/secret/${p}`), { allies: all, info: FV.arrayUnion({ n: 1, at: now, label: "The Shadows meet",
      text: `${all.length > 1 ? `Your fellow Shadows: ${all.filter(q => q !== p).map(q => nameOf(G, q)).join(", ")}.` : "You are the only Shadow."} ${C.passed ? "You passed the challenge: choose tonight's victim." : "You failed the challenge: no murder tonight, but you can plot."}` }) });
    b.update(db.doc(`games/${gid}/st/grim`), { met: true });
    await b.commit();
  }
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
    // When voting ends, the most votes is banished automatically (a tie goes to the host)
    const voted = now >= t.close && now < t.close + 6 * H && !(grim.results || {})[d] ? await (first ? autoTrust : autoBanish)(gid, G, grim, d, t, now) : null;
    // Voting has ended: the host has until the banishment to decide what the Shadows' night will be
    if (voted && voted !== "tie" && !G.overAt) once(`decide${d}`, ["st"], { title: "🔒 Voting has ended", body: `${voted.exec ? `${nameOf(G, voted.exec)} (${voted.side === "shadow" ? "🗡️ a Shadow" : "🕯️ a Guest"}) will be banished at ${fmt(G, t.reveal)}.` : first ? "The trust vote is in." : "Nobody will be banished."} Decide tonight's plan.`, tag: `st-day-${gid}` });
    if (voted === "tie") once(`closed-${d}-${t.close}`, ["st"], { title: "🔒 Voting has ended in a tie", body: `Decide who is banished before ${fmt(G, t.reveal)}.`, tag: `st-day-${gid}` });
    if (now >= t.reveal && now < t.reveal + 6 * H) {
      const r = await gated("result" + d);
      if (r && r.trust) once(`reveal${d}`, all, { title: r.trusted ? `🛡️ ${nameOf(G, r.trusted)} is the most trusted` : "🛡️ Nobody won the trust vote", body: r.trusted ? "They have a shield tonight: the Shadows can't murder them." : "", tag: `day-${gid}` });
      else if (r) once(`reveal${d}`, all, { title: r.exec ? `⚖️ ${nameOf(G, r.exec)} has been banished` : "⚖️ Nobody was banished", body: r.exec ? `They were a ${r.side === "shadow" ? "Shadow 🗡️" : "Guest 🕯️"}.` : "See how everyone voted.", tag: `day-${gid}` });
    }
  }
  const n = d + 1, w = (G.nights || {})[n];
  if (w && !G.overAt) {
    // The Shadows meet once today's banishment is confirmed
    if (now >= w.open && now < w.end && (d === 0 || (grim.results || {})[d])) {
      once(`night${n}`, shadows, { title: "🌙 The Shadows meet", body: (grim.allow || {})[n] === false || ((grim.allow || {})[n] !== true && (grim.missions || {})[d] && !(grim.missions || {})[d].passed) ? "Your chat is open. There's no murder tonight." : `Your chat is open: choose tonight's victim before ${fmt(G, w.end)}.`, tag: `night-${gid}` });
      if (now >= w.end - 30 * MIN) {
        const acts = await db.collection(`games/${gid}/nights/${n}/acts`).get(), done = new Set(acts.docs.map(a => a.id));
        once(`nightRemind${n}-${w.end}`, shadows.filter(p => !done.has(p)), { title: "🌙 30 minutes left", body: `Choose tonight's victim before ${fmt(G, w.end)}.`, tag: `night-${gid}` });
      }
    }
    if (now >= w.end && now < w.end + 12 * H && d < n) once(`nightEnd${n}-${w.end}`, ["st"], { title: `🕯️ Night ${G.dayFirst ? n - 1 : n} has closed`, body: "Work out the night and serve breakfast.", tag: `st-night-${gid}` });
  }
}

// The Shadows, Day 1: the most trusted player gets a shield for Night 1 (a tie goes to the host)
async function autoTrust(gid, G, grim, d, t, now) {
  const dead = grim.dead || {}, alive = seatIds(G).filter(p => !dead[p]);
  const ballots = (await db.collection(`games/${gid}/days/${d}/ballots`).get()).docs.map(x => x.data()).filter(b => alive.includes(b.voter) && alive.includes(b.of) && b.voter !== b.of);
  const count = {};
  for (const b of ballots) (count[b.of] = count[b.of] || { of: b.of, count: 0, voters: [] }).count++, count[b.of].voters.push(b.voter);
  const rows = Object.values(count).sort((a, b) => b.count - a.count), top = rows[0];
  if (top && rows[1] && rows[1].count === top.count) return "tie";
  const trusted = top ? top.of : null, at = Math.max(t.reveal, now), b = db.batch(), g = db.doc(`games/${gid}`);
  b.set(g.collection("gated").doc("result" + d), { at, d, trust: true, trusted, exec: null, auto: true, rows, why: top ? `${top.count} vote${top.count === 1 ? "" : "s"}, the most.` : "Nobody voted." });
  b.update(g.collection("st").doc("grim"), { [`results.${d}`]: { exec: null, trusted, at, auto: true }, ...(trusted ? { [`shield.${d + 1}`]: trusted } : {}) });
  if (trusted) b.update(g.collection("secret").doc(trusted), { info: require("firebase-admin").firestore.FieldValue.arrayUnion({ n: d, at, label: "Shield", text: "🛡️ The castle trusts you most: you have a shield for Night 1, and can't be murdered tonight." }) });
  await b.commit();
  return trusted ? "trusted" : "none";
}
// The Shadows: count the votes and banish the player with the most. Their role is revealed at the banishment time.
async function autoBanish(gid, G, grim, d, t, now) {
  const sides = grim.sides || {}, dead = { ...(grim.dead || {}) }, alive = seatIds(G).filter(p => !dead[p]);
  const ballots = (await db.collection(`games/${gid}/days/${d}/ballots`).get()).docs.map(x => x.data())
    .filter(b => alive.includes(b.voter) && alive.includes(b.of) && b.voter !== b.of);
  const count = {};
  for (const b of ballots) (count[b.of] = count[b.of] || { of: b.of, count: 0, voters: [] }).count++, count[b.of].voters.push(b.voter);
  const rows = Object.values(count).sort((a, b) => b.count - a.count), top = rows[0];
  if (top && rows[1] && rows[1].count === top.count) return "tie";
  const exec = top ? top.of : null, at = Math.max(t.reveal, now), b = db.batch(), g = db.doc(`games/${gid}`);
  if (exec) dead[exec] = { how: "banished", d };
  const uidsOf = ps => Object.fromEntries(ps.map(p => [(G.uids || {})[p], true]).filter(([u]) => u));
  const inShadows = seatIds(G).filter(p => sides[p] === "shadow" && !dead[p]);
  b.set(g.collection("gated").doc("result" + d), { at, d, exec, side: exec ? sides[exec] || null : null, auto: true,
    why: top ? `${top.count} vote${top.count === 1 ? "" : "s"}, the most.` : "Nobody voted.", rows,
    ballots: ballots.map(x => ({ voter: x.voter, of: x.of, reason: x.reason || "" })) });
  b.update(g.collection("st").doc("grim"), { dead, cu: uidsOf(inShadows), ou: uidsOf(Object.keys(dead)), [`results.${d}`]: { exec, at, auto: true } });
  if (exec) b.update(g.collection("secret").doc(exec), { out: true, info: require("firebase-admin").firestore.FieldValue.arrayUnion({ n: d, at, text: "⚖️ You were banished at the round table. You're out of the game, but you can still watch and talk to the dead.", label: "Banished" }) });
  // Does the game end? No Shadows left, or as many Shadows as Guests
  const left = seatIds(G).filter(p => !dead[p]), s = left.filter(p => sides[p] === "shadow").length, winner = s === 0 ? "guests" : s >= left.length - s ? "shadows" : "";
  if (winner) { b.set(g.collection("gated").doc("end"), { at, winner, sides, dead }); b.update(g, { overAt: at, status: "over" }); }
  await b.commit();
  return exec ? { exec, side: sides[exec] || "" } : "none";
}
// The Shadows: an offer has gone to a player (they're told to look, not what it is), and their answer goes to the host
async function onOffer(gid, pid, before, after) {
  if (!after.offer || (before.offer && before.offer.n === after.offer.n)) return;
  const x = await load(gid); if (!x) return;
  await notify(gid, x.G, [pid], { title: "🌙 Someone wants a word with you", body: `Open The Shadows. You must decide by ${fmt(x.G, after.offer.until)}.`, tag: `offer-${gid}` });
}
async function onAnswer(gid, n, pid, a) {
  const x = await load(gid); if (!x) return;
  await notify(gid, x.G, ["st"], { title: a.answer === "accept" ? `🗡️ ${nameOf(x.G, pid)} accepted` : `❌ ${nameOf(x.G, pid)} refused`, body: "Work out the night and serve breakfast.", tag: `st-night-${gid}` });
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
  if (after.deleteReq && !before.deleteReq) return db.recursiveDelete(db.doc(`games/${gid}`));
  // The Shadows: the host has chosen the sides. Everyone is told to look (but not what they are: phones get seen).
  if (isShd(after) && before.status === "lobby" && after.status === "running")
    await notify(gid, after, seatIds(after), { title: "🗝️ Your role has been chosen", body: "Open The Shadows to find out: are you a Guest, or a Shadow? Keep it to yourself.", tag: `role-${gid}` });
}

module.exports = { onLight, onCode, init, vapid, notify, tick, tickGame, expired, cleanup, onGameUpdate, onConclave, autoBanish, autoTrust, saysPhrase, onOffer, onAnswer, onSubscribe, onNomination, onDefence, onSquare, onStChat, onChat, actsAt };
