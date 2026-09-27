/**
 * shared/frontend/navigation.js
 *
 * Highlights the current page's nav link and wraps window.confirm
 * with a consistent helper for status-changing actions.
 */

function highlightActiveNav() {
  const currentFile = window.location.pathname.split("/").pop();
  document.querySelectorAll("nav.app-nav a[href]").forEach((link) => {
    const linkFile = link.getAttribute("href").split("/").pop();
    if (linkFile === currentFile) {
      link.classList.add("active");
    }
  });
}

/**
 * Use for any action that changes status in an important way
 * (approve, reject, suspend, cancel, complete, accept, etc).
 */
function confirmAction(message) {
  return window.confirm(message);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", highlightActiveNav);
else highlightActiveNav();

// Resolve from this script, not the domain root: supports GitHub project Pages.
window.AppNavigation = Object.freeze({
  base: new URL("../../", document.currentScript.src),
  url(path) { return new URL(path, this.base).href; },
  go(path) { window.location.replace(this.url(path)); }
});
