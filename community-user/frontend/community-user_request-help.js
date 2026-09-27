/**
 * community-user_request-help.js
 *
 * Handles the three Request Help workflows (Report a Problem,
 * Request Service, Request New Items) plus the Helpline panel.
 *
 * NOTE: There is no backend/API yet. Every "submit" handler below
 * validates the form, builds the payload the backend will eventually
 * expect (see data contracts in MASTER_AI_TEAM_CONTEXT.txt), and then
 * shows a clear "validated, not yet submitted" message. Nothing here
 * pretends data was permanently saved.
 */

const MAX_DESCRIPTION_LENGTH = 1000;

document.addEventListener("DOMContentLoaded", () => {
  wireFeatureButtons();
  wireModalCloseControls();
  wireHelpline();
  wireReportProblemForm();
  wireRequestServiceForm();
  wireRequestItemsForm();
});

function wireFeatureButtons() {
  document.querySelectorAll("[data-feature]").forEach((button) => {
    button.addEventListener("click", () => {
      const feature = button.dataset.feature;
      if (feature === "report-problem") openModal(document.getElementById("reportProblemModal"));
      if (feature === "request-service") openModal(document.getElementById("requestServiceModal"));
      if (feature === "request-items") openModal(document.getElementById("requestItemsModal"));
    });
  });
}

function wireModalCloseControls() {
  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      closeModal(document.getElementById(button.dataset.closeModal));
    });
  });

  ["reportProblemModal", "requestServiceModal", "requestItemsModal", "helplineModal"].forEach((id) => {
    enableModalDismiss(document.getElementById(id));
  });
}

function wireHelpline() {
  document.getElementById("helplineButton").addEventListener("click", () => {
    openModal(document.getElementById("helplineModal"));
  });
}

/* ---------------------------- REPORT A PROBLEM ---------------------------- */

function wireReportProblemForm() {
  const form = document.getElementById("reportProblemForm");

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!validateReportProblemForm()) return;

    const reportData = collectReportProblemData();

    // TODO: connect to POST /api/reports once the backend exists.
    console.log("Report ready for backend submission:", reportData);

    showBanner(
      document.getElementById("reportProblemMessage"),
      backendNotConnectedMessage("Report submitted successfully"),
      "success"
    );
    form.reset();
  });
}

function validateReportProblemForm() {
  const type = document.getElementById("problemType");
  const description = document.getElementById("problemDescription");
  const location = document.getElementById("problemLocation");
  const urgency = document.getElementById("problemUrgency");

  let valid = true;
  valid = setFieldError(type, document.getElementById("problemTypeError"),
    isRequired(type.value) ? "" : "Please select a problem type.") && valid;

  valid = setFieldError(description, document.getElementById("problemDescriptionError"),
    !isRequired(description.value) ? "Please describe the problem."
      : !isWithinMaxLength(description.value, MAX_DESCRIPTION_LENGTH) ? `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`
      : "") && valid;

  valid = setFieldError(location, document.getElementById("problemLocationError"),
    isRequired(location.value) ? "" : "Please provide a location.") && valid;

  valid = setFieldError(urgency, document.getElementById("problemUrgencyError"),
    isRequired(urgency.value) ? "" : "Please select an urgency level.") && valid;

  return valid;
}

function collectReportProblemData() {
  return {
    problemType: document.getElementById("problemType").value,
    description: document.getElementById("problemDescription").value.trim(),
    location: document.getElementById("problemLocation").value.trim(),
    urgency: document.getElementById("problemUrgency").value,
    additionalInfo: document.getElementById("problemAdditional").value.trim(),
  };
}

/* ---------------------------- REQUEST SERVICE ---------------------------- */

function wireRequestServiceForm() {
  const form = document.getElementById("requestServiceForm");

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!validateRequestServiceForm()) return;

    const requestData = collectRequestServiceData();

    // TODO: connect to POST /api/requests once the backend exists.
    console.log("Service request ready for backend submission:", requestData);

    showBanner(
      document.getElementById("requestServiceMessage"),
      backendNotConnectedMessage("Service request submitted successfully"),
      "success"
    );
    form.reset();
  });
}

function validateRequestServiceForm() {
  const category = document.getElementById("serviceCategory");
  const description = document.getElementById("serviceDescription");
  const location = document.getElementById("serviceLocation");
  const date = document.getElementById("servicePreferredDate");
  const time = document.getElementById("servicePreferredTime");
  const urgency = document.getElementById("serviceUrgency");

  let valid = true;
  valid = setFieldError(category, document.getElementById("serviceCategoryError"),
    isRequired(category.value) ? "" : "Please select a service category.") && valid;

  valid = setFieldError(description, document.getElementById("serviceDescriptionError"),
    !isRequired(description.value) ? "Please describe what you need."
      : !isWithinMaxLength(description.value, MAX_DESCRIPTION_LENGTH) ? `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`
      : "") && valid;

  valid = setFieldError(location, document.getElementById("serviceLocationError"),
    isRequired(location.value) ? "" : "Please provide a location.") && valid;

  valid = setFieldError(date, document.getElementById("servicePreferredDateError"),
    !isRequired(date.value) ? "Please select a preferred date."
      : !isNotPastDate(date.value) ? "Preferred date cannot be in the past."
      : "") && valid;

  valid = setFieldError(time, document.getElementById("servicePreferredTimeError"),
    isRequired(time.value) ? "" : "Please select a preferred time.") && valid;

  valid = setFieldError(urgency, document.getElementById("serviceUrgencyError"),
    isRequired(urgency.value) ? "" : "Please select an urgency level.") && valid;

  return valid;
}

function collectRequestServiceData() {
  return {
    requestType: "service",
    category: document.getElementById("serviceCategory").value,
    description: document.getElementById("serviceDescription").value.trim(),
    location: document.getElementById("serviceLocation").value.trim(),
    preferredDate: document.getElementById("servicePreferredDate").value,
    preferredTime: document.getElementById("servicePreferredTime").value,
    urgency: document.getElementById("serviceUrgency").value,
    additionalInfo: document.getElementById("serviceAdditional").value.trim(),
  };
}

/* --------------------------- REQUEST NEW ITEMS ---------------------------- */

function wireRequestItemsForm() {
  const form = document.getElementById("requestItemsForm");

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!validateRequestItemsForm()) return;

    const requestData = collectRequestItemsData();

    // TODO: connect to POST /api/requests once the backend exists.
    console.log("Item request ready for backend submission:", requestData);

    showBanner(
      document.getElementById("requestItemsMessage"),
      backendNotConnectedMessage("Item request submitted successfully"),
      "success"
    );
    form.reset();
  });
}

function validateRequestItemsForm() {
  const category = document.getElementById("itemCategory");
  const description = document.getElementById("itemDescription");
  const quantity = document.getElementById("itemQuantity");
  const location = document.getElementById("itemLocation");
  const urgency = document.getElementById("itemUrgency");

  let valid = true;
  valid = setFieldError(category, document.getElementById("itemCategoryError"),
    isRequired(category.value) ? "" : "Please select an item category.") && valid;

  valid = setFieldError(description, document.getElementById("itemDescriptionError"),
    !isRequired(description.value) ? "Please describe what you need."
      : !isWithinMaxLength(description.value, MAX_DESCRIPTION_LENGTH) ? `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`
      : "") && valid;

  valid = setFieldError(quantity, document.getElementById("itemQuantityError"),
    isPositiveInteger(quantity.value) ? "" : "Quantity must be a whole number of at least 1.") && valid;

  valid = setFieldError(location, document.getElementById("itemLocationError"),
    isRequired(location.value) ? "" : "Please provide a location.") && valid;

  valid = setFieldError(urgency, document.getElementById("itemUrgencyError"),
    isRequired(urgency.value) ? "" : "Please select an urgency level.") && valid;

  return valid;
}

function collectRequestItemsData() {
  return {
    requestType: "resource",
    category: document.getElementById("itemCategory").value,
    description: document.getElementById("itemDescription").value.trim(),
    quantity: Number(document.getElementById("itemQuantity").value),
    location: document.getElementById("itemLocation").value.trim(),
    urgency: document.getElementById("itemUrgency").value,
    additionalInfo: document.getElementById("itemAdditional").value.trim(),
  };
}