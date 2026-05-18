/**
 * Same-origin WebSocket URL for local dev and HTTPS deploy (e.g. Render).
 * https → wss://, http → ws://; path matches main.py @app.websocket("/ws/audio").
 */
(function (global) {
  function getWebSocketUrl() {
    var proto = global.location.protocol === "https:" ? "wss:" : "ws:";
    var host = global.location.host;
    if (!host) {
      host =
        global.location.protocol === "file:"
          ? "localhost:8000"
          : (global.location.hostname || "localhost") + ":8000";
    }
    return proto + "//" + host + "/ws/audio";
  }

  global.MediBridgeWs = { getWebSocketUrl: getWebSocketUrl };
})(typeof window !== "undefined" ? window : globalThis);
