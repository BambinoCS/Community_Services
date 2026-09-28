(function () {
  'use strict';

  const dialog = document.getElementById('requestServiceModal');
  const form = document.getElementById('requestServiceForm');
  const fields = document.getElementById('service-fields');
  const submit = document.getElementById('submit-service-request');
  const close = document.getElementById('close-service-dialog');
  const message = document.getElementById('requestServiceMessage');
  const notice = document.getElementById('notice');
  const accountNotice = document.getElementById('service-account-notice');
  const saving = document.getElementById('service-saving-message');
  const date = form.elements.preferredDate;
  let owner = null;
  let canSubmit = false;
  let busy = false;
  let requestId = null;

  function today() {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = (type) => parts.find((item) => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  function showNotice(text, includeRequestsLink = false) {
    notice.replaceChildren(document.createTextNode(text));
    if (includeRequestsLink) {
      const link = document.createElement('a');
      link.href = 'community-user_requests.html';
      link.textContent = 'View My Requests';
      notice.append(document.createTextNode(' '), link);
    }
    notice.hidden = false;
    notice.focus();
  }

  function showError(text) {
    message.textContent = text;
    message.hidden = false;
    message.focus();
  }

  function updateControls() {
    fields.disabled = busy || !canSubmit;
    close.disabled = busy;
    submit.textContent = busy ? 'Submitting…' : 'Submit request';
    form.setAttribute('aria-busy', String(busy));
    saving.hidden = !busy;
  }

  document.addEventListener('community:authenticated', (event) => {
    const state = event.detail;
    if (owner !== state.user.id) {
      form.reset();
      requestId = null;
      message.hidden = true;
      notice.hidden = true;
    }
    owner = state.user.id;
    canSubmit = state.profile.role === 'community_user';
    accountNotice.hidden = canSubmit;
    accountNotice.textContent = canSubmit ? '' : 'You are viewing the community interface. Creating a service request requires a community user account; switching interfaces does not change your account role.';
    date.min = today();
    updateControls();
  });

  document.querySelectorAll('[data-feature]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.feature === 'request-service') {
        date.min = today();
        dialog.showModal();
      } else {
        showNotice(button.dataset.feature === 'report-problem'
          ? 'Problem reporting is coming later. No report has been submitted.'
          : 'Requests for items are coming later. No item request has been submitted.');
      }
    });
  });

  function closeDialog() {
    if (!busy) dialog.close();
  }
  close.addEventListener('click', closeDialog);
  document.getElementById('cancel-service-request').addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => {
    if (busy) event.preventDefault();
  });
  document.getElementById('helplineButton').addEventListener('click', () => {
    showNotice('Helpline information is not available yet. This platform does not provide emergency response.');
  });

  // Retry unchanged data with the same ID so a lost response cannot create a duplicate.
  function edited() {
    if (!busy) requestId = null;
    for (const field of form.querySelectorAll('input, textarea')) field.setCustomValidity('');
  }
  form.addEventListener('input', edited);
  form.addEventListener('change', edited);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!owner || !canSubmit) {
      showError('Sign in with a community user account to submit a service request.');
      return;
    }
    date.min = today();
    const description = form.elements.description;
    const location = form.elements.location;
    description.setCustomValidity(description.value.trim() ? '' : 'Describe the assistance you need.');
    location.setCustomValidity(location.value.trim() ? '' : 'Enter an area or meeting point.');
    if (!form.reportValidity()) return;

    const payload = {
      category: form.elements.category.value,
      description: description.value.trim(),
      location: location.value.trim(),
      preferredDate: date.value,
      preferredTime: form.elements.preferredTime.value,
      urgency: form.elements.urgency.value,
      additionalInfo: form.elements.additionalInfo.value.trim()
    };
    const submittingOwner = owner;
    busy = true;
    message.hidden = true;
    updateControls();
    try {
      requestId ||= crypto.randomUUID();
      const result = await ServiceRequests.create(payload, requestId);
      if (!result?.id) throw new Error('Your request could not be confirmed. Retry with the same details.');
      if (owner !== submittingOwner) return;
      form.reset();
      requestId = null;
      dialog.close();
      showNotice('Your service request has been saved. Follow its progress in My Requests.', true);
    } catch (error) {
      if (owner === submittingOwner) showError(ServiceRequests.message(error));
    } finally {
      busy = false;
      updateControls();
    }
  });
})();
