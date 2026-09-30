(function () {
  'use strict';
  const tbody = document.getElementById('assistantsTableBody');
  const empty = document.getElementById('emptyStateContainer');
  const feedback = document.getElementById('review-message');
  const filter = document.getElementById('statusFilter');
  const dialog = document.getElementById('review-dialog');
  const form = document.getElementById('review-form');
  const refresh = document.getElementById('refresh-assistants');
  const previous = document.getElementById('previous-assistants');
  const next = document.getElementById('next-assistants');
  let rows = [], offset = 0, selected = null, busy = false, sequence = 0, ready = false;
  function text(tag, value) { const node = document.createElement(tag); node.textContent = value; return node; }
  function render() {
    tbody.replaceChildren(); empty.textContent = rows.length ? '' : 'No assistants match this status.';
    for (const row of rows) {
      const tr = document.createElement('tr');
      const name = [row.profiles?.first_name, row.profiles?.last_name].filter(Boolean).join(' ') || 'Community member';
      tr.append(text('td', name), text('td', new Date(row.created_at).toLocaleDateString()),
        text('td', AssistantAPI.label(row.training_status)), text('td', AssistantAPI.label(row.verification_status)));
      const cell = document.createElement('td'); const button = text('button', 'Review');
      button.type = 'button'; button.className = 'btn btn-secondary btn-sm'; button.setAttribute('aria-label', 'Review ' + name);
      button.addEventListener('click', () => {
        selected = row; document.getElementById('review-name').textContent = name;
        form.elements.verification.value = row.verification_status;
        form.elements.training.value = row.training_status;
        form.elements.reason.value = ''; document.getElementById('dialog-message').textContent = '';
        dialog.showModal();
      });
      cell.append(button); tr.append(cell);
      [...tr.children].forEach((td,index)=>{td.dataset.label=['Assistant','Registered','Training','Verification','Actions'][index];});
      tbody.append(tr);
    }
    previous.disabled = offset === 0; next.disabled = rows.length < 50;
    document.getElementById('assistant-page').textContent = 'Page ' + (offset / 50 + 1);
  }
  async function load() {
    const version = ++sequence;
    refresh.disabled = previous.disabled = next.disabled = true;
    empty.textContent = 'Loading assistant applications…'; tbody.replaceChildren();
    try {
      const data = await AssistantAPI.list(offset, filter.value);
      if (version !== sequence) return;
      rows = data || []; render();
    } catch (error) {
      if (version !== sequence) return;
      rows = []; empty.textContent = 'Could not load assistants. Please refresh and try again.';
      feedback.textContent = AssistantAPI.message(error);
      previous.disabled = offset === 0;
    } finally { if (version === sequence) refresh.disabled = false; }
  }
  document.addEventListener('community:authenticated', ({detail:state}) => {
    const permitted = state.profile.role === 'admin';
    refresh.disabled = filter.disabled = !permitted;
    if (!permitted) { empty.textContent = 'Assistant reviews require a real administrator account. Developer view does not grant review permissions.'; return; }
    if (!ready) { ready = true; void load(); }
  });
  refresh.addEventListener('click', () => { feedback.textContent = ''; void load(); });
  filter.addEventListener('change', () => { offset = 0; feedback.textContent = ''; void load(); });
  previous.addEventListener('click', () => { offset = Math.max(0, offset - 50); void load(); });
  next.addEventListener('click', () => { offset += 50; void load(); });
  document.getElementById('close-review').addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !selected || !form.reportValidity()) return;
    const verification = form.elements.verification.value, training = form.elements.training.value;
    const reason = form.elements.reason.value.trim();
    const status = document.getElementById('dialog-message');
    if (['rejected', 'suspended'].includes(verification) && !reason) { status.textContent = 'Include a reason for rejection or suspension.'; form.elements.reason.focus(); return; }
    busy = true; form.querySelector('fieldset').disabled = true; status.textContent = 'Saving review…';
    try {
      await AssistantAPI.review(selected, verification, training, reason);
      dialog.close(); feedback.textContent = 'Assistant review saved.'; await load();
    } catch (error) { status.textContent = AssistantAPI.message(error); }
    finally { busy = false; form.querySelector('fieldset').disabled = false; }
  });
})();
