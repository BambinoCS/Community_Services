(function () {
  'use strict';

  const container = document.getElementById('requestsContainer');
  const message = document.getElementById('browseMessage');
  const refreshButton = document.getElementById('refreshRequests');
  const categoryFilter = document.getElementById('categoryFilter');
  const urgencyFilter = document.getElementById('urgencyFilter');
  const locationFilter = document.getElementById('locationFilter');
  let rows = [];
  let sequence = 0;
  let loading = false;

  function setMessage(text, kind) {
    message.textContent = text;
    message.className = 'message-banner' + (text ? ' show' : '') + (kind ? ' ' + kind : '');
  }

  function textElement(tag, text, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function matches(row) {
    if (categoryFilter.value && row.category !== categoryFilter.value) return false;
    if (urgencyFilter.value && row.urgency !== urgencyFilter.value) return false;
    const area = locationFilter.value.trim().toLowerCase();
    if (area && !(row.location || '').toLowerCase().includes(area)) return false;
    return true;
  }

  function render() {
    container.replaceChildren();
    const filtered = rows.filter(matches);
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const heading = document.createElement('h3');
      heading.textContent = rows.length ? 'No matching requests' : 'No open item requests right now';
      const body = document.createElement('p');
      body.textContent = rows.length
        ? 'Try widening the filters to see more requests.'
        : 'When community members request items, they will appear here so you can decide what to donate.';
      empty.append(heading, body);
      container.append(empty);
      return;
    }
    for (const row of filtered) {
      const card = document.createElement('article');
      card.className = 'item-card';
      const top = document.createElement('div');
      top.className = 'item-card-top';
      top.append(textElement('h3', ServiceRequests.categoryLabel('resource', row.category)));
      top.append(textElement('span', 'Open', 'badge badge-open'));
      card.append(top);
      card.append(textElement('p', row.description, 'meta'));
      if (row.quantity != null) card.append(textElement('p', 'Quantity needed: ' + row.quantity, 'meta'));
      card.append(textElement('p', 'Location: ' + (row.location || 'Not provided'), 'meta'));
      if (row.urgency) card.append(textElement('p', 'Urgency: ' + row.urgency, 'meta'));
      if (row.additional_info) card.append(textElement('p', row.additional_info, 'meta'));
      card.append(textElement('p', 'Requested: ' + new Date(row.created_at).toLocaleString(), 'meta'));
      const directions = CommunityLocation.directionsUrl({ latitude: row.latitude, longitude: row.longitude, address: row.location });
      if (directions) {
        const link = document.createElement('a');
        link.href = directions;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'btn btn-secondary btn-sm';
        link.textContent = 'Get Directions';
        card.append(link);
      }
      const donate = document.createElement('a');
      donate.href = 'community-user_donate.html';
      donate.className = 'btn btn-primary btn-sm';
      donate.textContent = 'Donate This Item';
      card.append(donate);
      container.append(card);
    }
  }

  async function load() {
    const version = ++sequence;
    loading = true;
    refreshButton.disabled = true;
    container.replaceChildren(textElement('p', 'Loading community requests…', 'loading-state'));
    setMessage('');
    try {
      const state = await CommunityAuth.state();
      if (!state) throw new Error('Please sign in to continue.');
      const db = CommunityAuth.getClient();
      const { data, error } = await db.from('requests')
        .select('id,category,description,quantity,location,latitude,longitude,urgency,additional_info,status,created_at')
        .eq('request_type', 'resource')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      if (version !== sequence) return;
      rows = data || [];
      loading = false;
      refreshButton.disabled = false;
      render();
      if (rows.length) setMessage(rows.length + ' open request' + (rows.length === 1 ? '' : 's') + '. Donate what you can from the Donate page.', 'info');
    } catch (error) {
      if (version !== sequence) return;
      loading = false;
      refreshButton.disabled = false;
      rows = [];
      container.replaceChildren();
      setMessage(error.message === 'Please sign in to continue.'
        ? error.message
        : 'Requests are unavailable right now. Check your connection and try again.', 'error');
    }
  }

  refreshButton.addEventListener('click', () => { if (!loading) void load(); });
  categoryFilter.addEventListener('change', render);
  urgencyFilter.addEventListener('change', render);
  locationFilter.addEventListener('input', render);

  document.addEventListener('community:authenticated', () => { if (!loading && !rows.length) void load(); });
})();
