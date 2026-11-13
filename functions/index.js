// Clocktower Daily's notification server (Firebase Cloud Functions, 1st generation, London region)
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const lib = require("./lib");

admin.initializeApp();
const db = admin.firestore();
// In the local emulator, notifications are written to pushtest/ instead of being sent
lib.init(db, process.env.FUNCTIONS_EMULATOR === "true" ? async (sub, payload) => { await db.collection("pushtest").add({ endpoint: sub.endpoint, ...payload, at: Date.now() }); } : undefined);

const R = functions.region("europe-west2");
const doc = path => R.firestore.document(path);

// Every 5 minutes: dawn, nominations open, voting closing, the execution, night actions, the end
exports.tick = R.pubsub.schedule("every 5 minutes").onRun(() => lib.tick(Date.now()));
// Every 6 hours: delete games that ended 30 days ago (see lib.js)
exports.cleanup = R.pubsub.schedule("every 6 hours").onRun(() => lib.cleanup(Date.now()));
// The Storyteller deleted a game: remove everything in it
exports.onGameUpdate = doc("games/{gid}").onUpdate((ch, c) => lib.onGameUpdate(c.params.gid, ch.before.data(), ch.after.data()));
// A welcome as soon as a device turns notifications on
exports.onSubscribe = doc("games/{gid}/push/{uid}").onCreate((s, c) => lib.onSubscribe(c.params.gid, c.params.uid, s.data()));
// Straight away: nominations, defences, Slayer shots and messages
exports.onNomination = doc("games/{gid}/days/{d}/noms/{nominee}").onCreate((s, c) => lib.onNomination(c.params.gid, c.params.d, c.params.nominee, s.data()));
exports.onDefence = doc("games/{gid}/days/{d}/noms/{nominee}").onUpdate((ch, c) => lib.onDefence(c.params.gid, c.params.d, c.params.nominee, ch.before.data(), ch.after.data()));
exports.onSquare = doc("games/{gid}/square/{id}").onCreate((s, c) => lib.onSquare(c.params.gid, s.data()));
exports.onStChat = doc("games/{gid}/stchat/{pid}/msgs/{id}").onCreate((s, c) => lib.onStChat(c.params.gid, c.params.pid, s.data()));
exports.onConclave = doc("games/{gid}/conclave/{id}").onCreate((s, c) => lib.onConclave(c.params.gid, s.data()));
exports.onOffer = doc("games/{gid}/secret/{pid}").onUpdate((ch, c) => lib.onOffer(c.params.gid, c.params.pid, ch.before.data(), ch.after.data()));
exports.onAnswer = doc("games/{gid}/nights/{n}/answers/{pid}").onCreate((s, c) => lib.onAnswer(c.params.gid, c.params.n, c.params.pid, s.data()));
exports.onChat = doc("games/{gid}/chats/{pair}/msgs/{id}").onCreate((s, c) => lib.onChat(c.params.gid, c.params.pair, s.data()));
