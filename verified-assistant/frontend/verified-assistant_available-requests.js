/**
 * verified-assistant_available-requests.js
 *
 * Lists open service requests this assistant is eligible to accept.
 * Frontend blocks unverified assistants from accepting as a UX
 * convenience — the real enforcement must happen via backend/RLS.
 * No backend/API exists yet, so nothing here fakes a saved
 * assignment; it only prepares the { requestId, assistantId } payload.
 */

// TODO: replace with the real signed-in assistant's verification
// status once Supabase Auth + `assistants` table are connected.
const currentAssistant = {
  id: "assistant-placeholder-id",
  verificationStatus: "pending", // pending | verified | rejected | suspended
};

// TODO: replace with a real fetch() of open `requests` rows.
let allRequests = [];

document.addEventListener("DOMContentLoaded", () => {
  renderVerificationNotice();
  renderRequests(allRequests);

  document.getElementById("categoryFilter").addEventListener("change", applyFilters);
  document.getElementById("urgencyFilter").addEventListener("change", applyFilters);

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => closeModal(document.getElementById(button.dataset.closeModal)));
  });
  enableModalDismiss(document.getElementById("detailsModal"));
});

function renderVerificationNotice() {
  const notice = document.getElementById("verificationNotice");
  if (currentAssistant.verificationStatus !== "verified") {
    showBanner(notice, "You must be verified before you can accept service requests. You can still browse what's available.", "info");
  }
}

function applyFilters() {
  const category = document.getElementById("categoryFilter").value;
  const urgency = document.getElementById("urgencyFilter").value;

  const filtered = allRequests.filter((request) =>
    (!category || request.category === category) && (!urgency || request.urgency === urgency)
  );

  renderRequests(filtered);
}

function renderRequests(requests) {
  const container = document.getElementById("requestsContainer");

  if (!requests || requests.length === 0) {
    renderEmptyState(container, "No available requests right now.", "New eligible service requests will appear here as they come in.");
    return;
  }

  container.innerHTML = requests.map((request) => `
    <article class="item-card">
      <div class="item-card-top">
        <h3>${request.category}</h3>
        ${renderStatusBadge(request.status, REQUEST_STATUS_LABELS)}
      </div>
      <p class="meta">${request.description}</p>
      <p class="meta">Location: ${request.location}</p>
      <p class="meta">Urgency: ${request.urgency}</p>
      <p class="meta">Requested: ${formatDate(request.preferredDate)} ${request.preferredTime || ""}</p>
      <div class="actions">
        <button class="btn btn-secondary btn-sm" type="button" onclick="viewDetails('${request.id}')">View Details</button>
        <button class="btn btn-primary btn-sm" type="button" onclick="acceptRequest('${request.id}')">Accept Request</button>
      </div>
    </article>
  `).join("");
}

function findRequest(requestId) {
  return allRequests.find((r) => r.id === requestId);
}

function viewDetails(requestId) {
  const request = findRequest(requestId);
  if (!request) return;

  document.getElementById("detailsTitle").textContent = request.category;
  document.getElementById("detailsBody").innerHTML = `
    <p class="meta">${request.description}</p>
    <p class="meta">Location: ${request.location}</p>
    <p class="meta">Urgency: ${request.urgency}</p>
    <p class="meta">Requested: ${formatDate(request.preferredDate)} ${request.preferredTime || ""}</p>
  `;
  hideBanner(document.getElementById("acceptMessage"));

  const acceptBtn = document.getElementById("acceptRequestBtn");
  acceptBtn.onclick = () => acceptRequest(request.id);

  openModal(document.getElementById("detailsModal"));
}

function acceptRequest(requestId) {
  const messageEl = document.getElementById("acceptMessage");

  if (currentAssistant.verificationStatus !== "verified") {
    showBanner(messageEl, "You must be verified before you can accept service requests.", "error");
    return;
  }

  const assignmentData = {
    requestId: requestId,
    assistantId: currentAssistant.id,
  };

  // TODO: connect to POST /api/assignments once the backend exists.
  // Expected workflow: open request -> assistant accepts -> assignment
  // created -> request becomes "assigned".
  console.log("Assignment ready for backend submission:", assignmentData);

  showBanner(messageEl, backendNotConnectedMessage("Request accepted"), "success");
}
