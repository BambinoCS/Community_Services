(function () {
  'use strict';

  const donationForm = document.getElementById('donationForm');
  const imagesInput = document.getElementById('images');
  const previewGrid = document.getElementById('previewGrid');
  const browseRequestsButton = document.getElementById('browseRequestsButton');
  const message = document.getElementById('message');
  const submitButton = donationForm.querySelector('button[type="submit"]');
  const MAX_IMAGES = 6;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  function showMessage(text, kind) {
    message.textContent = text;
    message.className = 'message' + (kind ? ' ' + kind : '');
    message.style.display = 'block';
  }

  imagesInput.addEventListener('change', () => {
    previewGrid.replaceChildren();
    const files = Array.from(imagesInput.files);
    const rejected = [];
    const accepted = [];
    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        rejected.push(file.name + ' (use JPG, PNG, or WebP)');
      } else if (file.size > MAX_IMAGE_BYTES) {
        rejected.push(file.name + ' (larger than 10 MB)');
      } else if (accepted.length < MAX_IMAGES) {
        accepted.push(file);
      } else {
        rejected.push(file.name + ' (maximum ' + MAX_IMAGES + ' pictures)');
      }
    }
    if (files.length) {
      const dataTransfer = new DataTransfer();
      accepted.forEach((file) => dataTransfer.items.add(file));
      imagesInput.files = dataTransfer.files;
    }
    for (const file of accepted) {
      const reader = new FileReader();
      reader.addEventListener('load', (event) => {
        const image = document.createElement('img');
        image.src = event.target.result;
        image.alt = file.name;
        previewGrid.appendChild(image);
      });
      reader.readAsDataURL(file);
    }
    if (rejected.length) showMessage('Skipped: ' + rejected.join('; '), 'error');
  });

  function numberOrNull(value) {
    if (value === '' || value == null) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function storageSafeName(name) {
    return name.replace(/[^\w.\-]+/g, '_');
  }

  function friendlyError(error) {
    if (!error) return 'Your donation could not be saved. Check your connection and try again.';
    if (error.code === '42501') return 'Your account cannot add donations. Refresh to check your current access.';
    if (error.code === '23514') return 'Check the dates, quantity, and fields, then try again.';
    return 'Your donation could not be saved. Check your connection and try again.';
  }

  browseRequestsButton.addEventListener('click', () => {
    window.location.assign('community-user_browse-requests.html');
  });

  CommunityLocation.attachLocator(document.getElementById('donationLocateButton'), {
    locationInput: document.getElementById('location'),
    latInput: document.getElementById('donationLatitude'),
    lngInput: document.getElementById('donationLongitude'),
    statusEl: document.getElementById('donationLocateStatus')
  });

  donationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.style.display = 'none';

    const availableFrom = new Date(document.getElementById('availableFrom').value);
    const availableUntil = new Date(document.getElementById('availableUntil').value);
    if (Number.isNaN(availableFrom.getTime()) || Number.isNaN(availableUntil.getTime()) || availableUntil <= availableFrom) {
      showMessage('Available Until must be later than Available From.', 'error');
      return;
    }
    if (!donationForm.reportValidity()) return;

    submitButton.disabled = true;
    submitButton.textContent = 'Saving…';
    try {
      const state = await CommunityAuth.state();
      if (!state) throw new Error('Please sign in to continue.');
      const db = CommunityAuth.getClient();

      const { data: donation, error: insertError } = await db.from('donations').insert({
        donor_id: state.user.id,
        item_name: document.getElementById('itemName').value.trim(),
        category: document.getElementById('category').value,
        description: document.getElementById('description').value.trim(),
        quantity: Number(document.getElementById('quantity').value),
        location: document.getElementById('location').value.trim(),
        latitude: numberOrNull(document.getElementById('donationLatitude').value),
        longitude: numberOrNull(document.getElementById('donationLongitude').value),
        available_from: availableFrom.toISOString(),
        available_until: availableUntil.toISOString()
      }).select().single();
      if (insertError) throw insertError;

      const files = Array.from(imagesInput.files);
      for (const [index, file] of files.entries()) {
        const path = `${state.user.id}/${donation.id}/${crypto.randomUUID()}-${storageSafeName(file.name)}`;
        const { error: uploadError } = await db.storage
          .from('donation-images')
          .upload(path, file, { contentType: file.type });
        if (uploadError) throw uploadError;
        const { error: imageRowError } = await db.from('donation_images').insert({
          donation_id: donation.id,
          storage_path: path,
          sort_order: index
        });
        if (imageRowError) throw imageRowError;
      }

      donationForm.reset();
      previewGrid.replaceChildren();
      showMessage('Your donation has been listed. Community members can now find it in Search Available Items.', 'success');
    } catch (error) {
      showMessage(error.message === 'Please sign in to continue.'
        ? error.message
        : friendlyError(error), 'error');
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Upload Donation';
    }
  });
})();
