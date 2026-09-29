(function () {
  'use strict';
  const statuses = { open: 'Open', assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
  const empty = { mine: 'No requests yet. Submit one from Request Help.', available: 'No available requests right now.',
    active: 'No active jobs. Accepted requests will appear here.', completed: 'No completed jobs yet.' };
  const labels = { accept: 'Accept request', cancel: 'Cancel request', cancelResource: 'Cancel request', start: 'Start job', complete: 'Complete job' };
  const confirmations = { accept: 'Accept this request? You will be responsible for this job.',
    cancel: 'Cancel this open request?', cancelResource: 'Cancel this open item request?', start: 'Start this job now?', complete: 'Mark this job as completed? This cannot be undone here.' };
  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function mount(mode) {
    const container = document.getElementById(mode === 'mine' || mode === 'available' ? 'requestsContainer' : 'jobsContainer');
    const status = element('p', '', 'message-banner show');
    status.id = 'service-message'; status.setAttribute('role', 'status');
    const toolbar = element('div', undefined, 'actions');
    const refresh = element('button', 'Refresh', 'btn btn-secondary'); refresh.type = 'button';
    const previous = element('button', 'Previous', 'btn btn-secondary'); previous.type = 'button';
    const next = element('button', 'Next', 'btn btn-secondary'); next.type = 'button';
    const page = element('span');
    toolbar.append(refresh, previous, page, next);
    container.before(toolbar, status);
    let state = null, rows = [], offset = 0, sequence = 0, busy = false, loading = false;
    const filters = ['statusFilter', 'typeFilter', 'categoryFilter', 'urgencyFilter'].map(id => document.getElementById(id)).filter(Boolean);
    function allowedAction(row) {
      if (mode === 'mine' && row.status === 'open') {
        if (row.request_type === 'service') return 'cancel';
        if (row.request_type === 'resource') return 'cancelResource';
      }
      if (!AuthPolicy.verified(state)) return null;
      if (mode === 'available' && row.status === 'open' && row.user_id !== state.user.id) return 'accept';
      if (mode === 'active') return row.status === 'assigned' ? 'start' : row.status === 'in_progress' ? 'complete' : null;
      return null;
    }
    function render() {
      if (loading) return;
      container.replaceChildren();
      const filtered = rows.filter(row => filters.every(filter => !filter.value || row[{
        statusFilter: 'status', typeFilter: 'request_type', categoryFilter: 'category', urgencyFilter: 'urgency'
      }[filter.id]] === filter.value));
      if (!filtered.length) container.append(element('p', rows.length ? 'No matching requests on this page.' : empty[mode], 'empty-state'));
      for (const row of filtered) {
        const card = element('article', undefined, 'item-card');
        const top = element('div', undefined, 'item-card-top');
        top.append(element('h3', row.item_name || ServiceRequests.categories[row.category] || row.category));
        top.append(element('span', statuses[row.status] || 'Unknown', 'badge badge-' + (Object.hasOwn(statuses, row.status) ? row.status : 'neutral')));
        card.append(top, element('p', row.description, 'meta'), element('p', 'Location: ' + (row.location || 'Not provided'), 'meta'));
        if (row.preferred_date) card.append(element('p', 'Preferred: ' + row.preferred_date + ' ' + (row.preferred_time || '').slice(0, 5), 'meta'));
        if (row.quantity) card.append(element('p', 'Quantity: ' + row.quantity, 'meta'));
        if (row.problems_addressed?.length) card.append(element('p', 'Problems addressed: ' + row.problems_addressed.join(', ').replaceAll('_', ' '), 'meta'));
        if (row.urgency) card.append(element('p', 'Urgency: ' + row.urgency, 'meta'));
        if (row.additional_info) card.append(element('p', row.additional_info, 'meta'));
        if (row.completed_at) card.append(element('p', 'Completed: ' + new Date(row.completed_at).toLocaleString(), 'meta'));
        const action = allowedAction(row);
        if (action) {
          const button = element('button', labels[action], 'btn btn-primary btn-sm');
          button.type = 'button'; button.disabled = busy;
          button.addEventListener('click', () => act(action, row.id)); card.append(button);
        }
        container.append(card);
      }
      previous.disabled = busy || offset === 0;
      next.disabled = busy || rows.length < ServiceRequests.pageSize;
      refresh.disabled = busy;
      page.textContent = `Page ${Math.floor(offset / ServiceRequests.pageSize) + 1}`;
    }
    async function load() {
      const version = ++sequence;
      loading = true;
      filters.forEach(filter => { filter.disabled = true; });
      container.replaceChildren(element('p', 'Loading service requests…', 'loading-state'));
      refresh.disabled = previous.disabled = next.disabled = true;
      status.textContent = '';
      try {
        const data = await ServiceRequests.list(mode, offset);
        if (version !== sequence) return;
        loading = false; filters.forEach(filter => { filter.disabled = false; });
        rows = data; render();
        if (mode !== 'mine' && !AuthPolicy.verified(state)) status.textContent = 'Your real account needs verified assistant status and completed training to work on requests. Developer Mode only changes the interface.';
      } catch (error) {
        if (version !== sequence) return;
        loading = false;
        filters.forEach(filter => { filter.disabled = false; });
        rows = []; container.replaceChildren();
        status.textContent = ServiceRequests.message(error);
        refresh.disabled = false; previous.disabled = offset === 0; next.disabled = true;
      }
    }
    async function act(action, id) {
      if (busy || loading || !window.confirm(confirmations[action])) return;
      busy = true; sequence++; render(); status.textContent = 'Saving…';
      try {
        await ServiceRequests.transition(action, id);
        busy = false;
        await load();
        // A failed refresh must keep its error instead of claiming a successful reload.
        if (!status.textContent) status.textContent = ({ accept: 'Request accepted. Open Active Jobs to start it.', cancel: 'Request cancelled.', cancelResource: 'Request cancelled.',
          start: 'Job started.', complete: 'Job completed. You can find it in Completed Jobs.' })[action];
      } catch (error) {
        busy = false; render(); status.textContent = ServiceRequests.message(error);
      }
    }
    refresh.addEventListener('click', () => { if (!busy) void load(); });
    previous.addEventListener('click', () => { if (!busy) { offset = Math.max(0, offset - ServiceRequests.pageSize); void load(); } });
    next.addEventListener('click', () => { if (!busy) { offset += ServiceRequests.pageSize; void load(); } });
    filters.forEach(filter => filter.addEventListener('change', render));
    document.addEventListener('community:authenticated', event => {
      state = event.detail;
      if (!busy) void load();
    });
  }
  window.ServiceRequestPage = Object.freeze({ mount });
})();
