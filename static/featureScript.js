/**
 * MediBridge — 단축키 배지 (ShortcutButton)
 * appendChild에 문자열을 넘기지 않도록 DOM 노드만 사용.
 */
(function (global) {
  "use strict";

  var DEFAULT_HINT_CLASS = "shortcut-hint";

  function formatShortcutLabel(label) {
    if (label == null) return "";
    var text = String(label).replace(/[()]/g, "").trim();
    if (!text) return "";
    if (/^spacebar$/i.test(text)) return "Space";
    if (text.length <= 6) return text;
    var parts = text.split("+");
    return (parts[parts.length - 1] || text).trim();
  }

  function isElement(node) {
    return !!(node && node.nodeType === 1);
  }

  function findHintHost(buttonEl) {
    if (!isElement(buttonEl)) return null;
    return buttonEl.querySelector(".speak-btn__text") || buttonEl;
  }

  function removeExistingHints(host, className) {
    if (!host || !host.querySelectorAll) return;
    var selector = "." + className.split(/\s+/).join(".");
    host.querySelectorAll(selector).forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function createHintNode(label, className) {
    var span = document.createElement("span");
    span.className = className;
    span.setAttribute("aria-hidden", "true");
    span.textContent = label;
    return span;
  }

  var ShortcutButton = {
    /**
     * @param {HTMLElement} buttonEl
     * @param {string} shortcutLabel
     * @param {{ className?: string, useAdjacentHTML?: boolean }} [options]
     */
    init: function (buttonEl, shortcutLabel, options) {
      options = options || {};
      var className = options.className || DEFAULT_HINT_CLASS;
      var label = formatShortcutLabel(shortcutLabel);
      if (!isElement(buttonEl) || !label) return null;

      try {
        var host = findHintHost(buttonEl);
        if (!host) return null;

        removeExistingHints(host, className);

        if (options.useAdjacentHTML) {
          host.insertAdjacentHTML(
            "beforeend",
            '<span class="' +
              className +
              '" aria-hidden="true">' +
              label.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") +
              "</span>"
          );
          return host.querySelector("." + className.split(/\s+/).join("."));
        }

        var node = createHintNode(label, className);
        host.appendChild(node);
        return node;
      } catch (err) {
        console.error("[ShortcutButton.init]", err);
        return null;
      }
    },
  };

  global.MediBridgeShortcut = {
    ShortcutButton: ShortcutButton,
    formatShortcutLabel: formatShortcutLabel,
  };
})(typeof window !== "undefined" ? window : globalThis);
