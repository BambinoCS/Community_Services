/**
 * community-user_browse-requests.js
 *
 * Loads open community requests from Supabase and lets donors filter them.
 *
 * Current privacy / matching rules:
 * - Only OPEN requests are shown.
 * - No requester name, phone, email, or UUID is displayed.
 * - Location is displayed and can be filtered.
 * - Location-based matching is NOT implemented yet.
 */

"use strict";

let allRequests = [];

document.addEventListener("DOMContentLoaded", () => {
  wireFilters();
  loadRequests();
});

// Your auth system also emits this after access is confirmed.
// This gives the page another chance to load once authentication is ready.
document.addEventListener("community:authenticated", loadRequests);

function wireFilters() {
  ["categoryFilter", "requestTypeFilter", "urgencyFilter"].forEach((id) => {
    const element = document.getElementById(id);

    if (element) {
      element.addEventListener("change", applyFilters);
    }
  });

  const locationFilter = document.getElementById("locationFilter");

  if (locationFilter) {
    locationFilter.addEventListener("input", applyFilters);
  }
}

async function loadRequests() {
  const container = document.getElementById("requestsContainer");

  if (!container) {
    console.error("requestsContainer was not found.");
    return;
  }

  renderLoadingState(container);

  try {
    const supabase = getSupabaseClient();

    // Confirm that the user still has a valid authenticated session.
    const {
      data: { user },
      error: userError
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      throw new Error("Your session has expired. Please sign in again.");
    }

    /*
     * Load open community requests.
     *
     * IMPORTANT:
     * This query will only work if your Supabase RLS policies allow
     * authenticated users to read these non-sensitive open requests.
     *
     * If RLS blocks this, do NOT disable RLS.
     * Later we can use a safe Supabase RPC that returns only approved fields.
     */
    const { data, error } = await supabase
      .from("requests")
      .select(`
        id,
        request_type,
        category,
        description,
        location,
        urgency,
        status,
        created_at
      `)
      .eq("status", "open")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    allRequests = (data || []).map(normalizeRequest);

    applyFilters();
  } catch (error) {
    console.error("Failed to load community requests:", error);

    renderErrorState(
      container,
      "Unable to load community requests.",
      getReadableError(error)
    );
  }
}

function normalizeRequest(request) {
  return {
    id: request.id,
    requestType: request.request_type || "",
    category: request.category || "",
    description: request.description || "",
    location: request.location || "",
    urgency: request.urgency || "",
    status: request.status || "",
    createdAt: request.created_at || ""
  };
}

function applyFilters() {
  const category = getValue("categoryFilter");
  const requestType = getValue("requestTypeFilter");
  const urgency = getValue("urgencyFilter");
  const location = getValue("locationFilter").toLowerCase();

  const filtered = allRequests.filter((request) => {
    const categoryMatches =
      !category || request.category === category;

    const typeMatches =
      !requestType || request.requestType === requestType;

    const urgencyMatches =
      !urgency || request.urgency === urgency;

    const locationMatches =
      !location ||
      String(request.location || "")
        .toLowerCase()
        .includes(location);

    return (
      categoryMatches &&
      typeMatches &&
      urgencyMatches &&
      locationMatches
    );
  });

  renderRequests(filtered);
}

function renderRequests(requests) {
  const container = document.getElementById("requestsContainer");

  if (!container) {
    return;
  }

  if (!requests || requests.length === 0) {
    renderEmptyState(
      container,
      "No community requests are currently available.",
      "Check back later, or adjust your filters."
    );

    return;
  }

  container.innerHTML = requests
    .map((request) => {
      return `
        <article class="item-card">
          <div class="item-card-top">

            <div>
              <h3>
                ${escapeHtml(formatLabel(request.category))}
              </h3>

              <p class="meta">
                ${escapeHtml(formatLabel(request.requestType))} request
              </p>
            </div>

            ${renderStatusBadge(
              request.status,
              REQUEST_STATUS_LABELS
            )}

          </div>

          <p class="meta">
            ${escapeHtml(request.description)}
          </p>

          ${
            request.location
              ? `
                <p class="meta">
                  <strong>Location:</strong>
                  ${escapeHtml(request.location)}
                </p>
              `
              : ""
          }

          ${
            request.urgency
              ? `
                <p class="meta">
                  <strong>Urgency:</strong>
                  ${escapeHtml(formatLabel(request.urgency))}
                </p>
              `
              : ""
          }

          <p class="meta">
            <strong>Date:</strong>
            ${escapeHtml(
              formatRequestDate(request.createdAt)
            )}
          </p>

        </article>
      `;
    })
    .join("");
}

function renderLoadingState(container) {
  if (typeof window.renderLoadingState === "function") {
    window.renderLoadingState(
      container,
      "Loading community requests..."
    );

    return;
  }

  container.innerHTML = `
    <div class="empty-state">
      <p>Loading community requests...</p>
    </div>
  `;
}

function renderErrorState(container, title, detail) {
  if (typeof window.renderErrorState === "function") {
    window.renderErrorState(
      container,
      title,
      detail
    );

    return;
  }

  container.innerHTML = `
    <div class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(detail)}</p>
    </div>
  `;
}

function getSupabaseClient() {
  /*
   * Your shared Supabase setup may expose the client through
   * getSupabaseClient().
   */
  if (typeof window.getSupabaseClient === "function") {
    return window.getSupabaseClient();
  }

  /*
   * Fallback in case your shared frontend exposes the initialized
   * client directly as window.supabaseClient.
   */
  if (window.supabaseClient) {
    return window.supabaseClient;
  }

  throw new Error(
    "Supabase is not ready. Check shared/frontend/supabase-client.js."
  );
}

function getValue(id) {
  return (
    document.getElementById(id)?.value || ""
  ).trim();
}

function formatRequestDate(value) {
  if (!value) {
    return "Unknown";
  }

  // Use your existing shared helper when available.
  if (typeof window.formatDate === "function") {
    return window.formatDate(value);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleDateString();
}

function formatLabel(value) {
  if (!value) {
    return "Other";
  }

  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
}

function getReadableError(error) {
  const message = String(
    error?.message || ""
  ).toLowerCase();

  /*
   * Supabase/PostgreSQL insufficient privilege / RLS.
   */
  if (
    error?.code === "42501" ||
    message.includes("row-level security")
  ) {
    return (
      "The current database security policy does not allow " +
      "this page to browse other users' open requests yet. " +
      "A safe read policy or sanitized Supabase RPC is required."
    );
  }

  if (
    message.includes("jwt") ||
    message.includes("session") ||
    message.includes("not authenticated")
  ) {
    return (
      "Your session may have expired. Please sign in again."
    );
  }

  return "Please refresh the page and try again.";
}

/*
 * Prevent user-entered database content from being interpreted as HTML.
 */
function escapeHtml(value) {
  const element = document.createElement("div");

  element.textContent = value ?? "";

  return element.innerHTML;
}
