// The Shadows: shared by the host (shadows-host.html) and the players (shadows.html).
// It runs on Clocktower Daily's engine (daily.js): the same Firebase project, sign-in, timetable, phases and notifications.
// Two sides: the Guests, and the Shadows hidden amongst them. Each night the Shadows murder a Guest;
// each evening everyone votes at the round table to banish someone, and learns which side they were on.
const KIND = "shadows";

/* ---------- The daily timetable ---------- */
// The day (phaseOf's names in brackets): breakfast, then private chats only (chats); the round table, open discussion
// with everyone (noms); voting (vote); counting (count); the banishment, when the Shadows' chat opens (the night).
SCHED_KEYS.splice(0, SCHED_KEYS.length,
  ["dawn", "🍳", "Breakfast", "Who was murdered in the night. Private chats open"],
  ["noms", "🗣️", "The round table", "Open discussion with everyone. Private chats close"],
  ["vote", "🗳️", "Voting begins", "Vote to banish the player you suspect"],
  ["close", "🔒", "Voting ends", "No more votes"],
  ["reveal", "⚖️", "The banishment", "Who is banished, and which side they were on"],
  ["night", "🌙", "The Shadows meet", "Their chat opens: they choose who to murder"],
  ["nightEnd", "🕯️", "The murder choice ends", "The host works out the night"]);
for (const k of Object.keys(DEFAULT_SCHED)) delete DEFAULT_SCHED[k];
Object.assign(DEFAULT_SCHED, { dawn: "07:30", noms: "18:00", vote: "19:00", close: "20:00", reveal: "20:30", night: "20:30", nightEnd: "22:00" });
// A day's times (private chats start at breakfast)
const dTimes = (slot, sched, start) => { const t = dayTimes(slot, sched, start); return { ...t, chats: t.dawn }; };
Object.assign(PHASE_INFO, {
  lobby: ["🏰", "Waiting to start"], wait: ["🕯️", "Night 1 is coming"], night: ["🌙", "Night"], dark: ["🌌", "The castle sleeps"],
  dawn: ["🍳", "Breakfast"], chats: ["🤫", "Private chats"], noms: ["🗣️", "The round table"], vote: ["🗳️", "Voting"],
  count: ["🔒", "Counting the votes"], dusk: ["🌆", "Evening"], over: ["🏁", "Game over"]
});
// Who can say what, when (the security rules check the same)
const privateOpen = p => p.k === "chats" || p.k === "dawn";        // breakfast until the round table
const tableOpen = p => p.k === "noms";                            // the round table discussion
const shadowsOpen = p => p.k === "night";                         // the Shadows' chat, from the banishment until the murder choice ends
Object.assign(HOW, { murdered: "Murdered", banished: "Banished", other: "Left the game" });
for (const k of Object.keys(PUSH_TEXT)) PUSH_TEXT[k] = PUSH_TEXT[k].replace(/Clocktower Daily/g, "The Shadows");

/* ---------- The two sides ---------- */
const SIDE = {
  guest: { ic: "🕯️", one: "Guest", many: "Guests", cls: "t-townsfolk", emblem: "img/emblem-guest.webp?v=150" },
  shadow: { ic: "🗡️", one: "Shadow", many: "Shadows", cls: "t-demon", emblem: "img/emblem-shadow.webp?v=150" }
};
const sideChip = s => s && SIDE[s] ? `<span class="${SIDE[s].cls}">${SIDE[s].ic} ${SIDE[s].one}</span>` : `<span class="hint">no side yet</span>`;
// How many Shadows to start with
const suggestShadows = n => n <= 6 ? 1 : n <= 10 ? 2 : n <= 16 ? 3 : 4;
// The game ends when every Shadow has gone, or when the Shadows are as many as the Guests left
function whoWins(sides, dead) {
  const alive = Object.keys(sides).filter(p => !dead[p]);
  const s = alive.filter(p => sides[p] === "shadow").length, g = alive.length - s;
  return s === 0 ? "guests" : s >= g ? "shadows" : "";
}
const WIN = { guests: "🕯️ The Guests win!", shadows: "🗡️ The Shadows win!" };

/* ---------- What kind of night it is (the host decides) ---------- */
const MODES = {
  murder: { ic: "🗡️", name: "Murder", what: "The Shadows choose a Guest to murder.", ask: "Choose who the Shadows murder tonight." },
  seduce: { ic: "🌹", name: "Seduction", what: "The Shadows choose a Guest to invite to join them. If they refuse, nobody dies.", ask: "Choose a Guest to invite to join the Shadows. If they refuse, nobody dies tonight." },
  blackmail: { ic: "⛓️", name: "Blackmail", what: "The Shadows choose a Guest who must join them, or be murdered.", ask: "Choose a Guest to blackmail: they must join the Shadows, or be murdered tonight." }
};

/* ---------- Day 1 ----------
   The game starts at breakfast on Day 1. The Shadows don't know each other yet: each must slip the host's code phrase
   into a private chat with a Guest before the round table. If they all do (and no Guest catches it), they may murder
   on Night 1. Day 1's round table is a trust vote: the most trusted player gets a shield for Night 1. */
// Games that start on Day 1 number their nights from the night after it (stored one higher, as Night n comes before Day n)
const nightNo = (G, n) => G && G.dayFirst ? n - 1 : n;
const shownPhase = (G, p) => G && G.dayFirst && (p.k === "night" || p.k === "dark") ? { ...p, n: p.n - 1 } : p;
const trustDay = (G, d) => !!(G && G.dayFirst && d === 1);
// The code phrase, ignoring capitals, punctuation and spacing
const normPhrase = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// The Whisper: the same words with exactly one added (a Shadow's change). Returns the added word, or null.
function oneWordAdded(a, b) {
  const A = normPhrase(a).split(" ").filter(Boolean), B = normPhrase(b).split(" ").filter(Boolean);
  if (B.length !== A.length + 1) return null;
  for (let i = 0; i < B.length; i++) if ([...B.slice(0, i), ...B.slice(i + 1)].join(" ") === A.join(" ")) return B[i];
  return null;
}
const saysPhrase = (text, phrase) => !!normPhrase(phrase) && (" " + normPhrase(text) + " ").includes(" " + normPhrase(phrase) + " ");

/* ---------- The shield tasks ---------- */
// The Hidden Key: the key is in one room, in one hiding place. Each player is told one room, or one hiding place, it is NOT in.
const KEY_ROOMS = ["Library", "Cellar", "Chapel", "Conservatory", "Gallery", "Kitchen"];
const KEY_SPOTS = ["under the rug", "behind a portrait", "inside the clock", "up the chimney", "in a suit of armour"];
// As many rooms and hiding places as the players can rule out between them (each holds one clue)
function keyGrid(n) {
  let r = 2, s = 2;
  for (;;) {
    if (r <= s && r < KEY_ROOMS.length && r + s - 1 <= n) r++;
    else if (s < KEY_SPOTS.length && r + s - 1 <= n) s++;
    else if (r < KEY_ROOMS.length && r + s - 1 <= n) r++;
    else break;
  }
  return { rooms: KEY_ROOMS.slice(0, r), spots: KEY_SPOTS.slice(0, s) };
}
const keyClueText = c => c ? (c.kind === "room" ? `The key is not in the ${c.name}.` : `The key is not ${c.name}.`) : "";
// The Broken Seal: everyone holds half a seal (a colour and a crest). Find who holds the other half.
const SEAL_COLS = ["Crimson", "Azure", "Emerald", "Gold"];
const SEAL_SYMS = [["🦅", "Eagle"], ["🐺", "Wolf"], ["🦉", "Owl"], ["🐍", "Serpent"], ["🦌", "Stag"], ["🐻", "Bear"], ["🦁", "Lion"], ["🐉", "Dragon"]];
const sealName = id => { const [c, s] = String(id || "").split("-"), y = SEAL_SYMS[+s]; return y ? `${SEAL_COLS[+c]} ${y[0]} ${y[1]}` : ""; };
const TASKS = {
  whisper: { ic: "🤫", name: "The Whisper" }, combination: { ic: "🔐", name: "The Combination" }, lanterns: { ic: "🕯️", name: "The Lanterns" },
  key: { ic: "🗝️", name: "The Hidden Key" }, seal: { ic: "🤝", name: "The Broken Seal" }, dayoff: { ic: "🌤️", name: "A day off" }
};

/* ---------- The Shadows' missions ----------
   Each runs alongside the day's task, whatever happens to the shield, and earns that night's murder.
   The Spy: find out a named Guest's piece of today's task. Frame a Guest: they get enough votes at the banishment.
   Clean hands: a Guest is banished, and no Shadow votes for them. (Day 1: find your fellow Shadows.) */
const SPY_TASKS = ["combination", "lanterns", "whisper", "key", "seal"];
const SPY_WHAT = { combination: "digit", lanterns: "lantern number", whisper: "whisper (who gave it to them)", key: "clue", seal: "half seal" };
// What the Shadows must find out, about a named player (the name already escaped or made bold)
const spyAsk = (task, who) => task === "whisper" ? `who gave ${who} the whisper` : `${who}'s ${SPY_WHAT[task]}`;
const VOTE_MISSIONS = ["frame", "clean"];
const MISSION_NAME = { findallies: "🔎 Find your fellow Shadows", spy: "🕵️ The Spy", frame: "🎯 Frame a Guest", clean: "🧤 Clean hands", rest: "🚫 No murder tonight" };

/* ---------- The live game: one evening on a video call ----------
   The host moves the game on, step by step. Each step moves the day's clock (the same clock the daily game runs on)
   to now, so everything else works as it does over several days. Times the host hasn't reached yet sit far ahead. */
const LIVE_FAR = 6 * 3600000;
const LIVE_DUR = { task: 5, whisper: 8, combination: 2, dayoff: 7, roam: 2, table: 3, vote: 1 };   // minutes
const LIVE_STEP = {
  lobby: ["🏰", "Gathering"], breakfast: ["🍳", "Breakfast"], explain: ["📜", "Today's task"], task: ["🛡️", "The task"], roam: ["🚶", "Roam the castle"],
  table: ["🗣️", "The round table"], vote: ["🗳️", "The vote"], count: ["⚖️", "The votes"], verdict: ["⚖️", "The verdict"], reveal: ["⚖️", "The truth"],
  night: ["🌙", "Night falls"], over: ["🏁", "Game over"]
};
// Where everyone should be on the call: the main room, the breakout rooms, or muted in the dark
const LIVE_WHERE = { breakfast: "main", explain: "main", task: "rooms", roam: "rooms", table: "main", vote: "main", count: "main", verdict: "main", reveal: "main", night: "dark" };
const isLive = G => !!(G && G.live && G.live.on);
const liveStep = G => isLive(G) ? (G.overAt && nowMs() >= G.overAt ? "over" : G.live.step || "lobby") : "";
// A live day's clock: breakfast now, and everything after it waiting for the host
function liveTimes(now) {
  const F = LIVE_FAR;
  return { dawn: now, chats: now, taskStart: now + F, taskEnd: now + F + 500, noms: now + F + 1000, vote: now + F + 2000, close: now + F + 3000, reveal: now + F + 4000, night: now + F + 5000, nightEnd: now + F + 6000 };
}
// The day's task is open (the daily game: breakfast until the round table; live: while the host's task runs)
const taskOpenAt = (t, now = nowMs()) => !!t && now >= (t.taskStart || t.dawn) && now < (t.taskEnd || t.noms);
// The Shadows' mission can be done from the task's start until the round table
const missionOpenAt = (t, now = nowMs()) => !!t && now >= (t.taskStart || t.dawn) && now < t.noms;
// How long the task runs live
const liveTaskMins = (G, task) => { const D = { ...LIVE_DUR, ...((G.live || {}).dur || {}) }; return task === "whisper" ? D.whisper : task === "combination" ? D.combination : task && task !== "dayoff" ? D.task : D.dayoff; };

// A read that asks the server afresh. (A page that has been refused a document a few times, while it was still locked,
// can go on being refused after it unlocks: a transaction's read always goes to the server.)
async function getFresh(ref) {
  try { return await FB.getDoc(ref); }
  catch (e) { if (e.code !== "permission-denied") throw e; return FB.runTransaction(db, tx => tx.get(ref)); }
}
// Everyone's votes, once voting has ended (live: read one by one if the list is refused)
async function readBallots(gid, d, voters) {
  try { const q = await FB.getDocs(gcol(gid, "days", String(d), "ballots")); return q.docs.map(x => x.data()); }
  catch (e) { if (e.code !== "permission-denied" || !voters || !voters.length) throw e;
    return FB.runTransaction(db, async tx => { const out = []; for (const v of voters) { const x = await tx.get(gref(gid, "days", String(d), "ballots", v)); if (x.exists()) out.push(x.data()); } return out; }); }
}

/* ---------- The round table ---------- */
// ballots: [{voter, of, reason?, at}]. Only living players' votes count, and only for living players.
function countBallots(ballots, alive) {
  const out = {};
  for (const b of ballots) if (alive.includes(b.voter) && alive.includes(b.of) && b.voter !== b.of) {
    const r = out[b.of] = out[b.of] || { of: b.of, count: 0, voters: [] };
    r.count++; r.voters.push(b.voter);
  }
  return Object.values(out).sort((a, b) => b.count - a.count);
}
// The player with the most votes is banished. A tie: the host decides (or calls a fresh vote).
function banishVerdict(rows) {
  const top = rows[0];
  if (!top) return { exec: null, tied: [], why: "Nobody voted." };
  const tied = rows.filter(r => r.count === top.count).map(r => r.of);
  if (tied.length > 1) return { exec: null, tied, why: `A tie on ${plural(top.count, "vote")}.` };
  return { exec: top.of, tied: [], why: `${plural(top.count, "vote")}, the most.` };
}

/* ---------- Pages ---------- */
// The Shadows and Clocktower Daily share game codes: send a code to the right app
function wrongApp(G, host) {
  if (!G || G.kind === KIND) return "";
  return host ? "daily-st.html" : "daily.html";
}
