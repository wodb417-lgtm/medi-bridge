/**
 * MediBridge shortcut utilities entry (re-exports featureScript.js globals).
 */
(function (global) {
  "use strict";
  if (global.MediBridgeShortcut) {
    global.ShortcutButton = global.MediBridgeShortcut.ShortcutButton;
  }
})(typeof window !== "undefined" ? window : globalThis);
