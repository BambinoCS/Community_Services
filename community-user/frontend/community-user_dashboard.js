document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("donationSearchForm");
  const input = document.getElementById("donationSearch");
  const results = document.getElementById("donationResults");
  const message = document.getElementById("donationSearchMessage");

  if (!form || !input || !results) return;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>\"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;"
    }[character]));
  }

  function renderResults(rows, query) {
    if (!rows.length) {
      if (!query) {
        results.innerHTML = "<p>No donated items are currently available.</p>";
        return;
      }

      const link = "community-user_request-new-item.html?item=" + encodeURIComponent(query);
      results.innerHTML =
        '<article class="donation-result">' +
        "<h4>No available item found</h4>" +
        "<p>We could not find “" + escapeHtml(query) + "” in currently available donations.</p>" +
        '<a href="' + link + '">Request this item instead →</a>' +
        "</article>";
      return;
    }

    results.innerHTML = rows.map((row) => {
      const itemLink = "community-user_request-new-item.html?item=" + encodeURIComponent(row.item_name || "");
      return (
        '<article class="donation-result">' +
        "<h4>" + escapeHtml(row.item_name) + "</h4>" +
        "<p>Category: " + escapeHtml(row.category) + "</p>" +
        "<p>Quantity: " + escapeHtml(row.quantity) + "</p>" +
        "<p>Location: " + escapeHtml(row.location || "Not specified") + "</p>" +
        '<a href="' + itemLink + '">Need this item? Request it →</a>' +
        "</article>"
      );
    }).join("");
  }

  async function search() {
    const query = input.value.trim();
    results.innerHTML = "<p>Searching…</p>";
    if (message) message.textContent = "";

    try {
      const rows = await CommunityAPI.searchAvailableDonations(query);
      renderResults(rows, query);
    } catch (error) {
      console.error(error);
      results.innerHTML = "";
      if (message) message.textContent = error.message || "Could not search available items.";
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void search();
  });
});
