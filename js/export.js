/* Centralized exports exposed from the chat header. */
(function () {
  "use strict";
  var chatButton = document.getElementById("exportChatBtn");
  var notesButton = document.getElementById("exportNotes");
  var boardButton = document.getElementById("exportBoard");
  var messages = document.getElementById("msgs");

  function downloadText(filename, text) {
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  if (chatButton && messages) chatButton.addEventListener("click", function () {
    var lines = Array.from(messages.children).map(function (node) {
      return (node.innerText || node.textContent || "").trim();
    }).filter(Boolean);
    downloadText("peerly-chat-" + new Date().toISOString().slice(0, 10) + ".txt",
      "Chat export\nExported: " + new Date().toLocaleString() + "\n\n" + lines.join("\n\n"));
  });

  if (notesButton) notesButton.addEventListener("click", function () {
    var notes = document.getElementById("sharedNotes");
    if (notes) downloadText("peerly-notes.txt", notes.value);
  });

  if (boardButton) boardButton.addEventListener("click", function () {
    var save = document.getElementById("wbSave");
    if (save) save.click();
  });
})();
