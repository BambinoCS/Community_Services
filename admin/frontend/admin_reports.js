/**
 * admin_reports.js
 *
 * Reports/moderation queue. Report STATUS values are not yet agreed
 * with the backend team (see master prompt section 29), so this page
 * displays whatever status string comes back as a neutral badge
 * rather than inventing an official set of statuses or a status filter.
 */

const REPORT_TYPE_LABELS = {
  community_issue: "Community Issue",
  platform_issue: "Platform Issue",
  safety_issue: "Safety Issue",
  service_issue: "Service Issue",
  other: "Other",
};

// TODO: replace with a real fetch() of the `reports` table once the
// backend exists.
let reports = [];

document.addEventListener("DOMContentLoaded", () => {
  renderReports(reports);
  document.getElementById("typeFilter").addEventListener("change", applyFilters);
});

function applyFilters() {
  const type = document.getElementById("typeFilter").value;
  const filtered = reports.filter((r) => !type || r.problemType === type);
  renderReports(filtered);
}

function renderReports(rows) {
  const container = document.getElementById("reportsContainer");

  if (!rows || rows.length === 0) {
    renderEmptyState(container, "No reports to review.", "Reports submitted through \"Report a Problem\" will appear here.");
    return;
  }

  container.innerHTML = rows.map((r) => `
    <article class="item-card">
      <div class="item-card-top">
        <h3>${REPORT_TYPE_LABELS[r.problemType] || r.problemType}</h3>
        <span class="badge badge-neutral">${r.status || "Unreviewed"}</span>
      </div>
      <p class="meta">${r.description}</p>
      <p class="meta">Date: ${formatDate(r.createdAt)}</p>
      ${r.relatedRequestId ? `<p class="meta">Related request: ${r.relatedRequestId}</p>` : ""}
    </article>
  `).join("");
}
