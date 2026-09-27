/**
 * community-user_browse-requests.js
 *
 * Lets donors browse open community requests. No backend/API is
 * connected yet, so this starts empty and shows the required
 * "No community requests are currently available." message rather
 * than inventing fake requests. Only non-sensitive fields (category,
 * description, general location, urgency, date, status) are shown —
 * no requester personal information.
 */

// TODO: replace with a real fetch() of open `requests` once the
// API/Supabase is connected.
let allRequests = [];

document.addEventListener("DOMContentLoaded", () => {
  renderRequests(allRequests);

  ["categoryFilter", "requestTypeFilter", "urgencyFilter"].forEach((id) => {
    document.getElementById(id).addEventListener("change", applyFilters);
  });
  document.getElementById("locationFilter").addEventListener("input", applyFilters);
});

function applyFilters() {
  const category = document.getElementById("categoryFilter").value;
  const requestType = document.getElementById("requestTypeFilter").value;
  const urgency = document.getElementById("urgencyFilter").value;
  const location = document.getElementById("locationFilter").value.trim().toLowerCase();

  const filtered = allRequests.filter((request) => {
    return (!category || request.category === category)
      && (!requestType || request.requestType === requestType)
      && (!urgency || request.urgency === urgency)
      && (!location || request.location.toLowerCase().includes(location));
  });

  renderRequests(filtered);
}

function renderRequests(requests) {
  const container = document.getElementById("requestsContainer");

  if (!requests || requests.length === 0) {
    renderEmptyState(
      container,
      "No community requests are currently available.",
      "Check back later, or browse again once more requests are submitted."
    );
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
      <p class="meta">Date: ${formatDate(request.createdAt)}</p>
    </article>
  `).join("");
}
