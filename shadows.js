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
  guest: { ic: "🕯️", one: "Guest", many: "Guests", cls: "t-townsfolk" },
  shadow: { ic: "🗡️", one: "Shadow", many: "Shadows", cls: "t-demon" }
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
