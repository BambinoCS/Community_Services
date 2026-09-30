(function () {
  'use strict';

  const searchForm = document.getElementById('donationSearchForm');
  const searchInput = document.getElementById('itemSearchInput');
  const searchButton = document.getElementById('itemSearchButton');
  const resultsGrid = document.getElementById('searchResults');
  const searchMessage = document.getElementById('searchMessage');
  let busy = false;
  let loaded = false;

  function setMessage(text, isError) {
    searchMessage.textContent = text;
    searchMessage.hidden = !text;
    searchMessage.classList.toggle('error', !!isError && !!text);
  }

  function setBusy(value) {
    busy = value;
    searchButton.disabled = value;
    searchButton.textContent = value ? 'Searching…' : 'Search';
  }

  function textElement(tag, text, className) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function formatWindow(from, until) {
    const options = { dateStyle: 'medium', timeStyle: 'short' };
    const fromText = from ? new Date(from).toLocaleString(undefined, options) : 'now';
    const untilText = until ? new Date(until).toLocaleString(undefined, options) : 'ongoing';
    return `Available ${fromText} – ${untilText}`;
  }

  function imageUrl(path) {
    return CommunityAuth.getClient().storage.from('donation-images').getPublicUrl(path).data.publicUrl;
  }

  function requestItemLink(donation) {
    const link = document.createElement('a');
    link.href = AppNavigation.url('chat.html') + '?donation=' + encodeURIComponent(donation.id);
    link.textContent = 'Request this item · collection or assistance →';
    return link;
  }

  function renderCard(donation, firstImagePath) {
    const card = document.createElement('article');
    card.className = 'result-card';
    if (firstImagePath) {
      const image = document.createElement('img');
      image.src = imageUrl(firstImagePath);
      image.alt = donation.item_name;
      card.appendChild(image);
    }
    card.appendChild(textElement('h4', donation.item_name));
    card.appendChild(textElement('p',
      `${ServiceRequests.resourceCategories[donation.category] || donation.category} · Qty ${donation.quantity}`));
    card.appendChild(textElement('p', donation.description, 'meta'));
    card.appendChild(textElement('p', `Collection: ${donation.location}`, 'meta'));
    card.appendChild(textElement('p', formatWindow(donation.available_from, donation.available_until), 'meta'));
    const directions = CommunityLocation.directionsUrl(donation);
    if (directions) {
      const link = document.createElement('a');
      link.href = directions;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = 'Get Directions';
      card.appendChild(link);
    }
    card.appendChild(requestItemLink(donation));
    return card;
  }

  function renderNoMatch(term) {
    const card = document.createElement('article');
    card.className = 'result-card';
    card.appendChild(textElement('h4', 'No available item found'));
    card.appendChild(textElement('p', `We could not find “${term}” in currently available donations.`, 'meta'));
    const link = document.createElement('a');
    link.href = 'community-user_request-new-item.html?item=' + encodeURIComponent(term);
    link.textContent = 'Request this item instead →';
    card.appendChild(link);
    resultsGrid.appendChild(card);
  }

  async function searchAvailableItems() {
    if (busy) return;
    setBusy(true);
    setMessage('Searching available items…', false);
    resultsGrid.replaceChildren();
    try {
      const term = searchInput.value.trim();
      const rows = await CommunityAPI.searchAvailableDonations(term);
      resultsGrid.replaceChildren(...rows.map((row) => renderCard(row, row.first_image_path)));
      if (rows.length) {
        setMessage(`${rows.length} item${rows.length === 1 ? '' : 's'} available. Contact the donor through the platform to arrange collection.`, false);
      } else {
        if (term) renderNoMatch(term);
        setMessage(term ? 'No available items match your search.' : 'No available items right now.', false);
      }
    } catch (error) {
      setMessage(error.message === 'Please sign in to continue.'
        ? error.message
        : 'Search is unavailable right now. Check your connection and try again.', true);
    } finally {
      setBusy(false);
    }
  }

  searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    loaded = true;
    void searchAvailableItems();
  });

  document.addEventListener('community:authenticated', () => {
    if (!loaded) {
      loaded = true;
      void searchAvailableItems();
    }
  });
})();
