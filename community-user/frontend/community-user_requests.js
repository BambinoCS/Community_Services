/**
 * community-user_requests.js
 *
 * "My Requests" list. No backend/API is connected yet, so this
 * starts from an empty data set and shows the standard empty state
 * rather than inventing fake completed requests.
 */

// TODO: replace with a real fetch() of the current user's requests
// once the API/Supabase `requests` table is connected.
let allRequests = [];

document.addEventListener("DOMContentLoaded", () => {
  renderRequests(allRequests);

  document.getElementById("statusFilter").addEventListener("change", applyFilters);
  document.getElementById("typeFilter").addEventListener("change", applyFilters);
});

function applyFilters() {
  const status = document.getElementById("statusFilter").value;
  const type = document.getElementById("typeFilter").value;

  const filtered = allRequests.filter((request) => {
    return (!status || request.status === status) && (!type || request.requestType === type);
  });

  renderRequests(filtered);
}

function renderRequests(requests) {
  const container = document.getElementById("requestsContainer");

  if (!requests || requests.length === 0) {
    renderEmptyState(
      container,
      "No requests yet.",
      "Requests you submit through \"Request Help\" will appear here."
    );
    return;
  }

  container.innerHTML = requests.map((request) => `
    <article class="item-card">
      <div class="item-card-top">
        <h3>${request.category}</h3>
        ${renderStatusBadge(request.status, REQUEST_STATUS_LABELS)}
      </div>
      <p class="meta">Type: ${request.requestType}</p>
      <p class="meta">Location: ${request.location}</p>
      <p class="meta">Date: ${formatDate(request.createdAt)}</p>
    </article>
  `).join("");
}
