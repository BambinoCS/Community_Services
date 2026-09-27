/**
 * admin_users.js
 *
 * User management list with search + role filter. Only non-sensitive
 * fields (name, role, created date, status) are shown, per the
 * master prompt's instruction not to accidentally expose sensitive
 * user information here.
 */

// TODO: replace with a real fetch() of the `profiles` table once
// the backend exists.
let users = [];

document.addEventListener("DOMContentLoaded", () => {
  renderTable(users);
  document.getElementById("searchInput").addEventListener("input", applyFilters);
  document.getElementById("roleFilter").addEventListener("change", applyFilters);
});

function applyFilters() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const role = document.getElementById("roleFilter").value;

  const filtered = users.filter((u) =>
    (!search || u.name.toLowerCase().includes(search)) && (!role || u.role === role)
  );

  renderTable(filtered);
}

function renderTable(rows) {
  const tbody = document.getElementById("usersTableBody");
  const emptyContainer = document.getElementById("emptyStateContainer");

  if (!rows || rows.length === 0) {
    tbody.innerHTML = "";
    renderEmptyState(emptyContainer, "No users found.", "Registered users will appear here once the backend is connected.");
    return;
  }

  emptyContainer.innerHTML = "";
  tbody.innerHTML = rows.map((u) => `
    <tr>
      <td>${u.name}</td>
      <td>${ROLE_LABELS[u.role] || u.role}</td>
      <td>${formatDate(u.createdAt)}</td>
      <td><span class="badge badge-neutral">${u.status || "Active"}</span></td>
    </tr>
  `).join("");
}
