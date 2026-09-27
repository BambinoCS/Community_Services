/**
 * verified-assistant_completed-jobs.js
 *
 * Read-only history of completed jobs. Rating/earnings/feedback are
 * intentionally NOT implemented — there is no payment system yet
 * (see master prompt section 19), so no earnings figures are shown.
 */

// TODO: replace with a real fetch() of this assistant's completed
// `requests` once the backend exists.
let completedJobs = [];

document.addEventListener("DOMContentLoaded", () => {
  renderCompletedJobs();
});

function renderCompletedJobs() {
  const container = document.getElementById("jobsContainer");

  if (!completedJobs || completedJobs.length === 0) {
    renderEmptyState(container, "No completed jobs yet.", "Jobs you finish will be listed here.");
    return;
  }

  container.innerHTML = completedJobs.map((job) => `
    <article class="item-card">
      <div class="item-card-top">
        <h3>${job.category}</h3>
        ${renderStatusBadge(job.status, REQUEST_STATUS_LABELS)}
      </div>
      <p class="meta">Location/general area: ${job.location}</p>
      <p class="meta">Completed: ${formatDate(job.completedAt)}</p>
    </article>
  `).join("");
}
