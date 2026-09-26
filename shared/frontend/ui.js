/**
 * shared/frontend/ui.js
 *
 * Small UI helpers: banner messages, empty/error/loading states,
 * and modal open/close. Kept deliberately simple — no framework.
 */

function showBanner(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className = "message-banner show " + (type || "info");
}

function hideBanner(el) {
  if (!el) return;
  el.className = "message-banner";
  el.textContent = "";
}

function renderEmptyState(container, title, body) {
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <h3>${title}</h3>
      <p>${body}</p>
    </div>`;
}

function renderErrorState(container, body) {
  if (!container) return;
  container.innerHTML = `
    <div class="error-state">
      <h3>Something went wrong</h3>
      <p>${body || "Please try again."}</p>
    </div>`;
}

function renderLoadingState(container, text) {
  if (!container) return;
  container.innerHTML = `<div class="loading-state">${text || "Loading..."}</div>`;
}

function openModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.add("show");
  const focusable = modalEl.querySelector("input, select, textarea, button");
  if (focusable) focusable.focus();
}

function closeModal(modalEl) {
  if (!modalEl) return;
  modalEl.classList.remove("show");
}

/**
 * Wires a modal so it also closes on overlay click or Escape key.
 */
function enableModalDismiss(overlayEl) {
  if (!overlayEl) return;
  overlayEl.addEventListener("click", (event) => {
    if (event.target === overlayEl) closeModal(overlayEl);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlayEl.classList.contains("show")) {
      closeModal(overlayEl);
    }
  });
}

/**
 * Placeholder rule (see MASTER_AI_TEAM_CONTEXT.txt / master prompt section 35):
 * until a real backend endpoint exists, frontend actions must not fake a
 * saved/completed state. This helper standardises that "ready, not yet
 * connected" message so every form is consistent.
 */
function backendNotConnectedMessage(actionLabel) {
  return `${actionLabel} — frontend validation successful. Backend/API submission is not connected yet, so nothing has been permanently saved.`;
}
