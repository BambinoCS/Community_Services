/**
 * admin_dashboard.js
 *
 * Platform statistics. No database is connected yet, so every stat
 * shows "No statistics available yet." instead of an invented number
 * (per the master prompt: do not create fake statistics).
 */

// TODO: replace with real aggregate queries once the backend/Supabase
// is connected (e.g. count(*) on profiles/assistants/requests/donations/reports).
const stats = [
  { label: "Total Users", value: null },
  { label: "Verified Assistants", value: null },
  { label: "Pending Assistant Verification", value: null },
  { label: "Open Requests", value: null },
  { label: "Active Requests", value: null },
  { label: "Completed Requests", value: null },
  { label: "Available Donations", value: null },
  { label: "Reported Problems", value: null },
];

document.addEventListener("DOMContentLoaded", () => {
  renderStats();
});

function renderStats() {
  const container = document.getElementById("statsContainer");

  container.innerHTML = stats.map((stat) => `
    <article class="stat-card">
      <div class="stat-value">${stat.value === null ? "—" : stat.value}</div>
      <div class="stat-label">${stat.label}</div>
      ${stat.value === null ? '<p class="hint" style="margin-top:6px;">No statistics available yet.</p>' : ""}
    </article>
  `).join("");
}
