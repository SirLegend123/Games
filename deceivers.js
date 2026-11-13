// The Deceivers: shared by the host (deceivers-host.html) and the players (deceivers.html).
// It runs on Clocktower Daily's engine (daily.js): the same Firebase project, sign-in, timetable, phases and notifications.
// Two sides: the Guests, and the Schemers hidden amongst them. Each night the Schemers murder a Guest;
// each evening everyone votes at the round table to banish someone, and learns which side they were on.
const KIND = "deceivers";

/* ---------- The daily timetable ---------- */
SCHED_KEYS.splice(0, SCHED_KEYS.length,
  ["dawn", "🍳", "Breakfast", "Find out who was murdered in the night"],
  ["vote", "🗳️", "The round table", "Vote to banish the player you suspect"],
  ["close", "🔒", "Voting closes", "No more votes"],
  ["reveal", "⚖️", "The banishment", "Who is banished, and which side they were on"],
  ["night", "🌙", "The Schemers meet", "The Schemers choose who to murder"],
  ["nightEnd", "🕯️", "The Schemers' choice closes", "The host works out the night"]);
for (const k of Object.keys(DEFAULT_SCHED)) delete DEFAULT_SCHED[k];
Object.assign(DEFAULT_SCHED, { dawn: "07:30", vote: "19:00", close: "20:00", reveal: "20:30", night: "20:30", nightEnd: "22:00" });
// A day's times. The day is for talking until the round table (phaseOf calls that "chats", and the round table "vote").
const dTimes = (slot, sched, start) => { const t = dayTimes(slot, sched, start); return { ...t, chats: t.dawn, noms: t.vote }; };
Object.assign(PHASE_INFO, {
  lobby: ["🏰", "Waiting to start"], wait: ["🕯️", "Night 1 is coming"], night: ["🌙", "Night"], dark: ["🌌", "The castle sleeps"],
  dawn: ["🍳", "Breakfast"], chats: ["🤫", "Whispers"], noms: ["🗳️", "The round table"], vote: ["🗳️", "The round table"],
  count: ["🔒", "Counting the votes"], dusk: ["🌆", "Evening"], over: ["🏁", "Game over"]
});
Object.assign(HOW, { murdered: "Murdered", banished: "Banished", other: "Left the game" });
for (const k of Object.keys(PUSH_TEXT)) PUSH_TEXT[k] = PUSH_TEXT[k].replace(/Clocktower Daily/g, "The Deceivers");

/* ---------- The two sides ---------- */
const SIDE = {
  guest: { ic: "🕯️", one: "Guest", many: "Guests", cls: "t-townsfolk" },
  schemer: { ic: "🗡️", one: "Schemer", many: "Schemers", cls: "t-demon" }
};
const sideChip = s => s && SIDE[s] ? `<span class="${SIDE[s].cls}">${SIDE[s].ic} ${SIDE[s].one}</span>` : `<span class="hint">no side yet</span>`;
// How many Schemers to start with
const suggestSchemers = n => n <= 6 ? 1 : n <= 10 ? 2 : n <= 16 ? 3 : 4;
// The game ends when every Schemer has gone, or when the Schemers are as many as the Guests left
function whoWins(sides, dead) {
  const alive = Object.keys(sides).filter(p => !dead[p]);
  const s = alive.filter(p => sides[p] === "schemer").length, g = alive.length - s;
  return s === 0 ? "guests" : s >= g ? "schemers" : "";
}
const WIN = { guests: "🕯️ The Guests win!", schemers: "🗡️ The Schemers win!" };

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
// The Deceivers and Clocktower Daily share game codes: send a code to the right app
function wrongApp(G, host) {
  if (!G || G.kind === KIND) return "";
  return host ? "daily-st.html" : "daily.html";
}
