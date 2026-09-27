/**
 * admin_requests.js
 *
 * Read/filter view of platform requests. Only "View Details" and
 * "Cancel" (a defined workflow transition to `cancelled`) are
 * implemented — arbitrary status changes are intentionally NOT
 * offered here, per the master prompt's instruction not to implement
 * arbitrary status changes outside a defined workflow.
 */

// TODO: replace with a real fetch() of the `requests` table once
// the backend exists.
let requests = [];

document.addEventListener("DOMContentLoaded", () => {
  renderTable(requests);
  ["statusFilter", "typeFilter", "urgencyFilter"].forEach((id) => {
    document.getElementById(id).addEventListener("change", applyFilters);
  });
});

function applyFilters() {
  const status = document.getElementById("statusFilter").value;
  const type = document.getElementById("typeFilter").value;
  const urgency = document.getElementById("urgencyFilter").value;

  const filtered = requests.filter((r) =>
    (!status || r.status === status) && (!type || r.requestType === type) && (!urgency || r.urgency === urgency)
  );

  renderTable(filtered);
}

function renderTable(rows) {
  const tbody = document.getElementById("requestsTableBody");
  const emptyContainer = document.getElementById("emptyStateContainer");

  if (!rows || rows.length === 0) {
    tbody.innerHTML = "";
    renderEmptyState(emptyContainer, "No requests found.", "Community requests will appear here once submitted.");
    return;
  }

  emptyContainer.innerHTML = "";
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${r.id}</td>
      <td>${r.requestType}</td>
      <td>${r.category}</td>
      <td>${renderStatusBadge(r.status, REQUEST_STATUS_LABELS)}</td>
      <td>${r.location}</td>
      <td>${formatDate(r.createdAt)}</td>
      <td>
        <div class="actions">
          <button class="btn btn-secondary btn-sm" type="button" onclick="viewRequest('${r.id}')">View</button>
          ${r.status !== "cancelled" && r.status !== "completed" ? `<button class="btn btn-danger btn-sm" type="button" onclick="cancelRequest('${r.id}')">Cancel</button>` : ""}
        </div>
      </td>
    </tr>
  `).join("");
}

function viewRequest(id) {
  const request = requests.find((r) => r.id === id);
  if (!request) return;
  window.alert(`${request.category}\n\n${request.description}\n\nLocation: ${request.location}\nStatus: ${REQUEST_STATUS_LABELS[request.status]}`);
}

function cancelRequest(id) {
  const request = requests.find((r) => r.id === id);
  if (!request) return;

  if (!confirmAction(`Cancel this request (${request.category})? This action changes its status to Cancelled.`)) return;

  request.status = "cancelled";

  // TODO: connect to PATCH /api/requests/:id once the backend exists.
  console.log("Request status update ready for backend:", { requestId: id, status: "cancelled" });

  applyFilters();
}
