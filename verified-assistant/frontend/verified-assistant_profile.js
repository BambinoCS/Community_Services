/**
 * verified-assistant_profile.js
 *
 * Assistant profile form + read-only verification/training/
 * availability status. Verification DOCUMENTS are never shown here —
 * only status labels — per the master prompt's privacy rule.
 */

// TODO: replace with a real fetch() of the signed-in assistant's
// `profiles` + `assistants` rows once Supabase is connected.
const assistantProfile = {
  firstName: "",
  lastName: "",
  phone: "",
  verificationStatus: "pending",
  trainingStatus: "in_progress",
  availability: "unavailable",
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("firstName").value = assistantProfile.firstName;
  document.getElementById("lastName").value = assistantProfile.lastName;
  document.getElementById("phone").value = assistantProfile.phone;

  document.getElementById("identityStatus").innerHTML =
    renderStatusBadge(assistantProfile.verificationStatus, VERIFICATION_STATUS_LABELS);
  document.getElementById("trainingStatus").innerHTML =
    renderStatusBadge(assistantProfile.trainingStatus, TRAINING_STATUS_LABELS);
  document.getElementById("availabilityStatus").innerHTML =
    renderStatusBadge(assistantProfile.availability, AVAILABILITY_LABELS);

  document.getElementById("profileForm").addEventListener("submit", handleSubmit);
  document.getElementById("profilePicture").addEventListener("change", handlePictureChange);
});

function handlePictureChange(event) {
  const file = event.target.files[0];
  const errorEl = document.getElementById("profilePictureError");
  if (!file) {
    setFieldError(event.target, errorEl, "");
    return;
  }
  if (!isAllowedImageType(file)) {
    setFieldError(event.target, errorEl, "Unsupported file type.");
    return;
  }
  if (!isAllowedImageSize(file)) {
    setFieldError(event.target, errorEl, "File is larger than 5MB.");
    return;
  }
  setFieldError(event.target, errorEl, "");
}

function handleSubmit(event) {
  event.preventDefault();

  if (!validateProfileForm()) return;

  const profileData = {
    firstName: document.getElementById("firstName").value.trim(),
    lastName: document.getElementById("lastName").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    serviceCategories: Array.from(document.getElementById("serviceCategories").selectedOptions).map((o) => o.value),
  };

  // TODO: connect to PATCH /api/profiles/:id once the backend exists.
  console.log("Profile update ready for backend:", profileData);

  showBanner(document.getElementById("profileMessage"), backendNotConnectedMessage("Profile saved"), "success");
}

function validateProfileForm() {
  const firstName = document.getElementById("firstName");
  const lastName = document.getElementById("lastName");
  const phone = document.getElementById("phone");

  let valid = true;
  valid = setFieldError(firstName, document.getElementById("firstNameError"),
    isRequired(firstName.value) ? "" : "First name is required.") && valid;
  valid = setFieldError(lastName, document.getElementById("lastNameError"),
    isRequired(lastName.value) ? "" : "Last name is required.") && valid;
  valid = setFieldError(phone, document.getElementById("phoneError"),
    isRequired(phone.value) ? "" : "Phone number is required.") && valid;

  return valid;
}
