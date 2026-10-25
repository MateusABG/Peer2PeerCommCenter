var $ = function (id) { return document.getElementById(id) };

// ICE servers used for the WebRTC connections.
// STUN is enough for most home/office networks. If some people cannot connect
// (strict corporate or mobile networks), add a TURN server here:
//   { urls: "turn:your.turn.server:3478", username: "user", credential: "pass" }
const PEER_OPTS = {
  debug: 1,
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" }
    ]
  }
};
const ROOM_PREFIX = 'p2p-';   // make this unique to your app
const PAL = ['#ff3b4e', '#19e6a7', '#ffb020', '#5ea0ff', '#c77dff', '#ff7ad9', '#a3e635', '#000000'];

var params = new URLSearchParams(location.search);
var name = (params.get("name") || "").replace(/\s+/g, " ").trim().slice(0, 20);
var code = (params.get("code") || "").trim().toUpperCase();
var isHost = params.get("host") === "1";

var conns = [];   // host: every connected guest
var hostConn;     // guest: connection to the host
