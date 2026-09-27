/**
 * verified-assistant_dashboard.js
 *
 * Shows verification/training/availability status and summary lists.
 * No backend/Supabase connection exists yet, so `assistantProfile` is
 * a realistic placeholder (pending verification) and the job lists
 * start empty. IMPORTANT: this frontend check is a UX convenience
 * only — final enforcement must happen server-side via RLS/backend,
 * per MASTER_AI_TEAM_CONTEXT.txt.
 */

// TODO: replace with a real fetch() of the signed-in assistant's row
// in the `assistants` table once Supabase is connected.
const assistantProfile = {
  verificationStatus: "pending", // pending | verified | rejected | suspended
  trainingStatus: "in_progress", // not_started | in_progress | completed
  availability: "unavailable", // available | unavailable
};

document.addEventListener("DOMContentLoaded", () => {
  renderVerificationStatus();
  renderTrainingStatus();
  renderAvailabilityToggle();
  renderAvailableRequests([]);
  renderActiveJobs([]);
  renderCompletedJobs([]);
});

function renderVerificationStatus() {
  document.getElementById("verificationStatusBadge").innerHTML =
    renderStatusBadge(assistantProfile.verificationStatus, VERIFICATION_STATUS_LABELS);

  const note = document.getElementById("verificationNote");
  if (assistantProfile.verificationStatus !== "verified") {
    note.textContent = "You must be verified before you can accept service requests.";
  } else {
    note.textContent = "You're verified and eligible to accept service requests.";
  }
}

function renderTrainingStatus() {
  document.getElementById("trainingStatusBadge").innerHTML =
    renderStatusBadge(assistantProfile.trainingStatus, TRAINING_STATUS_LABELS);
}

function renderAvailabilityToggle() {
  const container = document.getElementById("availabilityToggleContainer");
  const isAvailable = assistantProfile.availability === "available";

  container.innerHTML = `
    <p style="margin:10px 0;">
      <span class="status-dot ${isAvailable ? "on" : "off"}"></span>
      <strong>${AVAILABILITY_LABELS[assistantProfile.availability]}</strong>
    </p>
    <p class="hint" style="margin-bottom:14px;">
      ${isAvailable ? "You can receive new service requests." : "You will not receive new service requests."}
    </p>
    <button id="availabilityToggleBtn" class="btn btn-secondary btn-block" type="button">
      Switch to ${isAvailable ? "Unavailable" : "Available"}
    </button>
  `;

  document.getElementById("availabilityToggleBtn").addEventListener("click", () => {
    assistantProfile.availability = isAvailable ? "unavailable" : "available";
    // TODO: connect to PATCH /api/assistants/:id once the backend exists.
    console.log("Availability update ready for backend:", { availability: assistantProfile.availability });
    renderAvailabilityToggle();
  });
}

function renderAvailableRequests(requests) {
  const container = document.getElementById("availableRequestsContainer");
  if (!requests || requests.length === 0) {
    renderEmptyState(container, "No available requests right now.", "New eligible service requests will appear here.");
    return;
  }
  container.innerHTML = requests.map(renderRequestSummaryCard).join("");
}

function renderActiveJobs(jobs) {
  const container = document.getElementById("activeJobsContainer");
  if (!jobs || jobs.length === 0) {
    renderEmptyState(container, "No active jobs.", "Jobs you accept will show up here.");
    return;
  }
  container.innerHTML = jobs.map(renderRequestSummaryCard).join("");
}

function renderCompletedJobs(jobs) {
  const container = document.getElementById("completedJobsContainer");
  if (!jobs || jobs.length === 0) {
    renderEmptyState(container, "No completed jobs yet.", "Jobs you finish will appear here.");
    return;
  }
  container.innerHTML = jobs.map(renderRequestSummaryCard).join("");
}

function renderRequestSummaryCard(job) {
  return `
    <article class="item-card">
      <div class="item-card-top">
        <h3>${job.category}</h3>
        ${renderStatusBadge(job.status, REQUEST_STATUS_LABELS)}
      </div>
      <p class="meta">Location: ${job.location}</p>
    </article>`;
}
