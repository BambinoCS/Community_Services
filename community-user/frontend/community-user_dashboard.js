(function () {
  'use strict';

  const searchForm = document.getElementById('itemSearchForm');
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
    const requestLink = document.createElement('a');
    requestLink.href = 'community-user_request-help.html';
    requestLink.textContent = "Can't find what you need? Request it";
    card.appendChild(requestLink);
    return card;
  }

  async function searchAvailableItems() {
    if (busy) return;
    setBusy(true);
    setMessage('Searching available items…', false);
    resultsGrid.replaceChildren();
    try {
      const state = await CommunityAuth.state();
      if (!state) throw new Error('Please sign in to continue.');
      const db = CommunityAuth.getClient();
      const now = new Date().toISOString();
      let query = db.from('donations')
        .select('id,item_name,category,description,quantity,location,latitude,longitude,available_from,available_until,created_at')
        .eq('status', 'available')
        .or(`available_from.is.null,available_from.lte.${now}`)
        .or(`available_until.is.null,available_until.gte.${now}`)
        .order('created_at', { ascending: false })
        .limit(24);
      const term = searchInput.value.trim();
      if (term) {
        const safe = term.replace(/[%,()]/g, ' ').trim();
        if (safe) {
          query = query.or(`item_name.ilike.%${safe}%,description.ilike.%${safe}%,location.ilike.%${safe}%`);
        }
      }
      const { data: donations, error } = await query;
      if (error) throw error;
      const rows = donations || [];
      const imagesByDonation = new Map();
      if (rows.length) {
        const { data: images } = await db.from('donation_images')
          .select('donation_id,storage_path,sort_order')
          .in('donation_id', rows.map((row) => row.id))
          .order('sort_order', { ascending: true });
        for (const image of images || []) {
          if (!imagesByDonation.has(image.donation_id)) imagesByDonation.set(image.donation_id, image.storage_path);
        }
      }
      resultsGrid.replaceChildren(...rows.map((row) => renderCard(row, imagesByDonation.get(row.id))));
      if (rows.length) {
        setMessage(`${rows.length} item${rows.length === 1 ? '' : 's'} available. Contact the donor through the platform to arrange collection.`, false);
      } else {
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
