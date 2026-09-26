/**
 * admin_donations.js
 *
 * Read/filter view of donations with a View Details action.
 */

// TODO: replace with a real fetch() of the `donations` table once
// the backend exists.
let donations = [];

document.addEventListener("DOMContentLoaded", () => {
  renderTable(donations);
  document.getElementById("statusFilter").addEventListener("change", applyFilters);
  document.getElementById("categoryFilter").addEventListener("change", applyFilters);
});

function applyFilters() {
  const status = document.getElementById("statusFilter").value;
  const category = document.getElementById("categoryFilter").value;

  const filtered = donations.filter((d) =>
    (!status || d.status === status) && (!category || d.category === category)
  );

  renderTable(filtered);
}

function renderTable(rows) {
  const tbody = document.getElementById("donationsTableBody");
  const emptyContainer = document.getElementById("emptyStateContainer");

  if (!rows || rows.length === 0) {
    tbody.innerHTML = "";
    renderEmptyState(emptyContainer, "No donations found.", "Donated items will appear here once listed.");
    return;
  }

  emptyContainer.innerHTML = "";
  tbody.innerHTML = rows.map((d) => `
    <tr>
      <td>${d.itemName}</td>
      <td>${d.category}</td>
      <td>${d.quantity}</td>
      <td>${d.location}</td>
      <td>${renderStatusBadge(d.status, DONATION_STATUS_LABELS)}</td>
      <td>${formatDate(d.availableUntil)}</td>
      <td><button class="btn btn-secondary btn-sm" type="button" onclick="viewDonation('${d.id}')">View</button></td>
    </tr>
  `).join("");
}

function viewDonation(id) {
  const donation = donations.find((d) => d.id === id);
  if (!donation) return;
  window.alert(`${donation.itemName}\n\n${donation.description}\n\nQuantity: ${donation.quantity}\nLocation: ${donation.location}\nAvailable: ${formatDate(donation.availableFrom)} – ${formatDate(donation.availableUntil)}`);
}
