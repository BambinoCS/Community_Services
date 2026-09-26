/**
 * shared/frontend/status.js
 *
 * Central place for official database status VALUES and their
 * user-friendly LABELS. Do not change the values below — they must
 * match the backend/Supabase schema documented in
 * MASTER_AI_TEAM_CONTEXT.txt. Only the labels are for display.
 */

const REQUEST_STATUS_LABELS = {
  open: "Open",
  assigned: "Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const DONATION_STATUS_LABELS = {
  available: "Available",
  reserved: "Reserved",
  collected: "Collected",
  expired: "Expired",
  cancelled: "Cancelled",
};

const VERIFICATION_STATUS_LABELS = {
  pending: "Pending",
  verified: "Verified",
  rejected: "Rejected",
  suspended: "Suspended",
};

const TRAINING_STATUS_LABELS = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
};

const AVAILABILITY_LABELS = {
  available: "Available",
  unavailable: "Unavailable",
};

const ROLE_LABELS = {
  community_user: "Community User",
  assistant: "Verified Assistant",
  admin: "Admin",
  organisation: "Organisation",
};

/**
 * Returns an HTML string for a status badge span.
 * `value` must be one of the official lowercase status values above.
 */
function renderStatusBadge(value, labelMap) {
  const labels = labelMap || REQUEST_STATUS_LABELS;
  const label = labels[value] || value || "Unknown";
  const safeValue = (value || "neutral").toString();
  return `<span class="badge badge-${safeValue}">${label}</span>`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
