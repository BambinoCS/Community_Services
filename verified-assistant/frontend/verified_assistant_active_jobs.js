/**
 * verified-assistant_active-jobs.js
 *
 * Jobs assigned to the current assistant (status: assigned or
 * in_progress). Start Job moves assigned -> in_progress; Complete
 * Job moves in_progress -> completed. Both use a confirmation dialog
 * since they change status. No backend exists yet, so state changes
 * only update the in-memory list and log the payload that would be
 * sent to the API.
 */

// TODO: replace with a real fetch() of this assistant's assigned
// `requests` (joined with `assignments`) once the backend exists.
let activeJobs = [];

document.addEventListener("DOMContentLoaded", () => {
  renderJobs();
});

function renderJobs() {
  const container = document.getElementById("jobsContainer");

  if (!activeJobs || activeJobs.length === 0) {
    renderEmptyState(container, "No active jobs.", "Jobs you accept from \"Available Requests\" will appear here.");
    return;
  }

  container.innerHTML = activeJobs.map((job) => `
    <article class="item-card">
      <div class="item-card-top">
        <h3>${job.category}</h3>
        ${renderStatusBadge(job.status, REQUEST_STATUS_LABELS)}
      </div>
      <p class="meta">${job.description}</p>
      <p class="meta">Location: ${job.location}</p>
      <div class="actions">
        ${job.status === "assigned" ? `<button class="btn btn-primary btn-sm" type="button" onclick="startJob('${job.id}')">Start Job</button>` : ""}
        ${job.status === "in_progress" ? `<button class="btn btn-success btn-sm" type="button" onclick="completeJob('${job.id}')">Complete Job</button>` : ""}
        <button class="btn btn-secondary btn-sm" type="button" onclick="viewJob('${job.id}')">View Details</button>
      </div>
    </article>
  `).join("");
}

function findJob(jobId) {
  return activeJobs.find((j) => j.id === jobId);
}

function startJob(jobId) {
  const job = findJob(jobId);
  if (!job) return;

  if (!confirmAction(`Start "${job.category}"? This will mark the job as In Progress.`)) return;

  job.status = "in_progress";

  // TODO: connect to PATCH /api/requests/:id once the backend exists.
  console.log("Job status update ready for backend:", { requestId: job.id, status: "in_progress" });

  renderJobs();
}

function completeJob(jobId) {
  const job = findJob(jobId);
  if (!job) return;

  if (!confirmAction(`Mark "${job.category}" as Completed? This cannot be undone from here.`)) return;

  // TODO: connect to PATCH /api/requests/:id once the backend exists.
  console.log("Job status update ready for backend:", { requestId: job.id, status: "completed" });

  activeJobs = activeJobs.filter((j) => j.id !== jobId);
  renderJobs();
}

function viewJob(jobId) {
  const job = findJob(jobId);
  if (!job) return;
  window.alert(`${job.category}\n\n${job.description}\n\nLocation: ${job.location}`);
}
