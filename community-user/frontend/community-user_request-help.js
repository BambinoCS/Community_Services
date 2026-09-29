(function () {
  'use strict';

  const notice = document.getElementById('notice');

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

  function showError(messageEl, text) {
    messageEl.textContent = text;
    messageEl.hidden = false;
    messageEl.focus();
  }

  function numberOrNull(value) {
    if (value === '' || value == null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function coordinates(form) {
    return { latitude: numberOrNull(form.elements.latitude?.value),
      longitude: numberOrNull(form.elements.longitude?.value) };
  }

  function setupDialog(config) {
    const dialog = document.getElementById(config.dialogId);
    const form = document.getElementById(config.formId);
    const fields = document.getElementById(config.fieldsId);
    const submit = document.getElementById(config.submitId);
    const close = document.getElementById(config.closeId);
    const message = document.getElementById(config.messageId);
    const saving = document.getElementById(config.savingId);
    const accountNotice = config.accountNoticeId ? document.getElementById(config.accountNoticeId) : null;

    let owner = null;
    let canSubmit = false;
    let busy = false;
    let requestId = null;

    function updateControls() {
      fields.disabled = busy || !canSubmit;
      close.disabled = busy;
      submit.textContent = busy ? 'Submitting…' : config.submitLabel;
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
      if (accountNotice) {
        accountNotice.hidden = canSubmit;
        accountNotice.textContent = canSubmit ? '' : 'You are viewing the community interface. Submitting requires a community user account; switching interfaces does not change your account role.';
      }
      config.onAuth?.(form);
      updateControls();
    });

    function closeDialog() {
      if (!busy) dialog.close();
    }
    close.addEventListener('click', closeDialog);
    document.getElementById(config.cancelId).addEventListener('click', closeDialog);
    dialog.addEventListener('cancel', (event) => {
      if (busy) event.preventDefault();
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
        showError(message, 'Sign in with a community user account to continue.');
        return;
      }
      config.beforeValidate?.(form);
      const description = form.elements.description;
      description.setCustomValidity(description.value.trim() ? '' : config.descriptionPrompt);
      const location = form.elements.location;
      location.setCustomValidity(location.value.trim() ? '' : 'Enter an area or meeting point.');
      if (!form.reportValidity()) return;

      const payload = config.buildPayload(form);
      const submittingOwner = owner;
      busy = true;
      message.hidden = true;
      updateControls();
      try {
        requestId ||= crypto.randomUUID();
        const result = await config.submit(payload, requestId);
        if (!result?.id) throw new Error('Your request could not be confirmed. Retry with the same details.');
        if (owner !== submittingOwner) return;
        form.reset();
        requestId = null;
        dialog.close();
        showNotice(config.successText, true);
      } catch (error) {
        if (owner === submittingOwner) showError(message, ServiceRequests.message(error));
      } finally {
        busy = false;
        updateControls();
      }
    });

    return { open() { dialog.showModal(); } };
  }

  const serviceDialog = setupDialog({
    dialogId: 'requestServiceModal', formId: 'requestServiceForm', fieldsId: 'service-fields',
    submitId: 'submit-service-request', closeId: 'close-service-dialog', cancelId: 'cancel-service-request',
    messageId: 'requestServiceMessage', savingId: 'service-saving-message',
    accountNoticeId: 'service-account-notice', submitLabel: 'Submit request',
    descriptionPrompt: 'Describe the assistance you need.',
    successText: 'Your service request has been saved. Follow its progress in My Requests.',
    onAuth: (form) => { form.elements.preferredDate.min = today(); },
    beforeValidate: (form) => { form.elements.preferredDate.min = today(); },
    buildPayload: (form) => ({
      category: form.elements.category.value,
      description: form.elements.description.value,
      location: form.elements.location.value,
      preferredDate: form.elements.preferredDate.value,
      preferredTime: form.elements.preferredTime.value,
      urgency: form.elements.urgency.value,
      additionalInfo: form.elements.additionalInfo.value,
      ...coordinates(form)
    }),
    submit: (payload, requestId) => ServiceRequests.create(payload, requestId)
  });

  const problemDialog = setupDialog({
    dialogId: 'reportProblemModal', formId: 'reportProblemForm', fieldsId: 'problem-fields',
    submitId: 'submit-problem-report', closeId: 'close-problem-dialog', cancelId: 'cancel-problem-report',
    messageId: 'reportProblemMessage', savingId: 'problem-saving-message',
    submitLabel: 'Submit report',
    descriptionPrompt: 'Describe the problem.',
    successText: 'Your report has been submitted. The support team will review it.',
    buildPayload: (form) => ({
      problemType: form.elements.problemType.value,
      description: form.elements.description.value,
      location: form.elements.location.value,
      urgency: form.elements.urgency.value,
      additionalInfo: form.elements.additionalInfo.value,
      ...coordinates(form)
    }),
    submit: (payload) => ServiceRequests.report(payload)
  });

  const itemsDialog = setupDialog({
    dialogId: 'requestItemsModal', formId: 'requestItemsForm', fieldsId: 'items-fields',
    submitId: 'submit-items-request', closeId: 'close-items-dialog', cancelId: 'cancel-items-request',
    messageId: 'requestItemsMessage', savingId: 'items-saving-message',
    submitLabel: 'Submit request',
    descriptionPrompt: 'Describe what you need.',
    successText: 'Your item request has been saved. Verified assistants and donors can now see it.',
    buildPayload: (form) => ({
      category: form.elements.category.value,
      description: form.elements.description.value,
      quantity: Number(form.elements.quantity.value),
      location: form.elements.location.value,
      urgency: form.elements.urgency.value,
      additionalInfo: form.elements.additionalInfo.value,
      ...coordinates(form)
    }),
    submit: (payload, requestId) => ServiceRequests.createResource(payload, requestId)
  });

  const dialogs = {
    'report-problem': problemDialog,
    'request-service': serviceDialog,
    'request-items': itemsDialog
  };
  document.querySelectorAll('[data-feature]').forEach((button) => {
    button.addEventListener('click', () => dialogs[button.dataset.feature]?.open());
  });

  document.getElementById('helplineButton').addEventListener('click', () => {
    showNotice('Helpline information is not available yet. This platform does not provide emergency response.');
  });

  CommunityLocation.attachLocator(document.getElementById('serviceLocateButton'), {
    locationInput: document.getElementById('serviceLocation'),
    latInput: document.getElementById('serviceLatitude'),
    lngInput: document.getElementById('serviceLongitude'),
    statusEl: document.getElementById('serviceLocateStatus')
  });
  CommunityLocation.attachLocator(document.getElementById('problemLocateButton'), {
    locationInput: document.getElementById('problemLocation'),
    latInput: document.getElementById('problemLatitude'),
    lngInput: document.getElementById('problemLongitude'),
    statusEl: document.getElementById('problemLocateStatus')
  });
  CommunityLocation.attachLocator(document.getElementById('itemLocateButton'), {
    locationInput: document.getElementById('itemLocation'),
    latInput: document.getElementById('itemLatitude'),
    lngInput: document.getElementById('itemLongitude'),
    statusEl: document.getElementById('itemLocateStatus')
  });
})();
