/* Progressive Web App registration; service worker is scoped to this directory. */
(function () {
  "use strict";
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./service-worker.js").catch(function (error) {
        console.warn("Peerly offline support could not be enabled:", error);
      });
    });
  }
})();
