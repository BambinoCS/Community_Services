/**
 * shared/frontend/validation.js
 *
 * Small, dependency-free validation helpers reused across
 * community-user, verified-assistant and admin forms.
 */

function isRequired(value) {
  return typeof value === "string" ? value.trim().length > 0 : value !== null && value !== undefined && value !== "";
}

function isWithinMaxLength(value, max) {
  return (value || "").toString().trim().length <= max;
}

function isPositiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1;
}

function isNotPastDate(dateString) {
  if (!dateString) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateString);
  return date >= today;
}

function isDateRangeValid(fromString, untilString) {
  if (!fromString || !untilString) return false;
  return new Date(untilString) > new Date(fromString);
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

function isAllowedImageType(file) {
  return ALLOWED_IMAGE_TYPES.includes(file.type);
}

function isAllowedImageSize(file) {
  return file.size <= MAX_IMAGE_SIZE_BYTES;
}

/**
 * Shows/hides a field-level error message and toggles the
 * `invalid` class on the input. `errorEl` and `inputEl` are DOM nodes.
 */
function setFieldError(inputEl, errorEl, message) {
  if (message) {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.add("show");
    }
    if (inputEl) inputEl.classList.add("invalid");
    return false;
  }
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.remove("show");
  }
  if (inputEl) inputEl.classList.remove("invalid");
  return true;
}
