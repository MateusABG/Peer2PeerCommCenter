// Theme picker. Loaded in <head> so the saved theme is applied before the first paint.
(function () {
  var KEY = "peerly-theme";
  var GAME = [
    ["mercenary", "Mercenary", "#2a231d"], ["island-life", "Island Life", "#2b9157"],
    ["operator", "Operator", "#1a1e25"], ["test-chamber", "Test Chamber", "#d95f00"],
    ["cubelands", "Cubelands", "#2a2117"], ["speed-rush", "Speed Rush", "#0a1b52"],
    ["neon-nights", "Neon Nights", "#110a1f"], ["space-command", "Space Command", "#080e17"],
    ["containment", "Containment", "#161a10"]
  ];
  var GENERAL = [
    ["escuro", "Escuro", "#8f0014"], ["deep-ocean", "Deep Ocean", "#061b2b"],
    ["sakura", "Sakura", "#d0517c"], ["arctic", "Arctic", "#1d79bb"],
    ["starlight", "Starlight", "#0f1236"], ["mystic-forest", "Mystic Forest", "#112019"]
  ];
  var ALL = GAME.concat(GENERAL);
  // ids saved before the rename still resolve
  var LEGACY = { "tf2": "mercenary", "animal-crossing": "island-life", "counter-strike": "operator", "portal": "test-chamber",
    "minecraft": "cubelands", "sonic": "speed-rush", "cyberpunk": "neon-nights", "mass-effect": "space-command", "half-life": "containment" };

  function find(id) { id = LEGACY[id] || id; for (var i = 0; i < ALL.length; i++) if (ALL[i][0] === id) return ALL[i]; return null; }
  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }

  function apply(id) {
    var t = find(id) || find("escuro");
    document.documentElement.setAttribute("data-theme", t[0]);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", t[2]);
    return t[0];
  }

  window.setTheme = function (id) {
    id = apply(id);
    try { localStorage.setItem(KEY, id); } catch (e) {}
    var sel = document.querySelectorAll(".themeSelect");
    for (var i = 0; i < sel.length; i++) sel[i].value = id;
  };

  apply(saved());

  function group(label, list) {
    var g = document.createElement("optgroup"); g.label = label;
    list.forEach(function (t) { var o = document.createElement("option"); o.value = t[0]; o.textContent = t[1]; g.appendChild(o); });
    return g;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var sel = document.querySelectorAll(".themeSelect");
    for (var i = 0; i < sel.length; i++) {
      sel[i].appendChild(group("Themed", GAME));
      sel[i].appendChild(group("Classic", GENERAL));
      sel[i].value = document.documentElement.getAttribute("data-theme");
      sel[i].addEventListener("change", function () { window.setTheme(this.value); });
    }
  });

  // keep other open tabs in sync
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(e.newValue); });
})();
