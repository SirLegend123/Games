// The live link's connection servers, shared by the Storyteller, the Town Square and the Player app.
// STUN servers help two devices find a direct route to each other; TURN servers pass the traffic on
// when they can't (some mobile networks, routers and school or office Wi-Fi block direct links).
const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: "stun:stun.cloudflare.com:3478" },
  { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
  { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turns:openrelay.metered.ca:443?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" }
];
// For testing against a local PeerJS server: ?peer=localhost:9000
function peerOpts() {
  const h = new URLSearchParams(location.search).get("peer");
  if (!h) return { config: { iceServers: ICE_SERVERS } };
  const [host, port] = h.split(":");
  return { host, port: Number(port) || 9000, path: "/", secure: false };
}
