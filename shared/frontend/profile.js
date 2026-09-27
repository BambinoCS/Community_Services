(function () {
  'use strict';
  const form = document.getElementById('profile-form');
  const fields = form.querySelector('fieldset');
  const status = document.getElementById('profile-message');
  const photo = document.getElementById('profile-photo');
  const initials = document.getElementById('profile-initials');
  const picker = document.getElementById('avatar');
  const submit = document.getElementById('save-profile');
  const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  let owner = null, saved = null, selected = null, preview = null, removePhoto = false;
  let busy = false, selectionVersion = 0;

  function showPhoto(url) {
    photo.hidden = !url; initials.hidden = !!url;
    if (url) photo.src = url;
    else photo.removeAttribute('src');
  }
  photo.addEventListener('error', () => showPhoto(null));
  function savedPhoto() {
    // Only the owner's storage path is ever rendered, never an arbitrary URL.
    const objectPath = saved?.avatar_path;
    const valid = typeof objectPath === 'string' && objectPath.startsWith(owner + '/') &&
      !objectPath.split('/').includes('..');
    showPhoto(valid ? CommunityAuth.getClient().storage.from('avatars').getPublicUrl(objectPath).data.publicUrl : null);
  }
  function clearSelection() {
    selectionVersion++;
    selected = null; removePhoto = false; picker.value = '';
    if (preview) URL.revokeObjectURL(preview);
    preview = null;
  }
  function populate() {
    form.elements.first_name.value = saved.first_name || '';
    form.elements.last_name.value = saved.last_name || '';
    form.elements.phone.value = saved.phone || '';
    initials.textContent = ((saved.first_name?.[0] || '') + (saved.last_name?.[0] || '')).toUpperCase() || 'You';
    clearSelection(); savedPhoto();
  }
  document.addEventListener('community:authenticated', (event) => {
    const state = event.detail;
    document.getElementById('back-dashboard').href = AppNavigation.url(CommunityAuth.destination(state));
    // Focus/visibility checks must not overwrite unsaved form edits or file selections.
    if (owner === state.user.id) return;
    owner = state.user.id; saved = state.profile;
    form.elements.email.value = state.user.email || '';
    populate(); fields.disabled = false;
  });
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    clearSelection(); savedPhoto(); status.textContent = '';
    if (!file) return;
    if (!types[file.type] || file.size === 0 || file.size > 5 * 1024 * 1024) {
      status.textContent = 'Choose a JPG, PNG or WebP image no larger than 5 MB.'; return;
    }
    const version = selectionVersion;
    const candidate = URL.createObjectURL(file);
    const image = new Image(); image.src = candidate;
    submit.disabled = true;
    try {
      await image.decode();
      if (version !== selectionVersion) { URL.revokeObjectURL(candidate); return; }
      selected = file; preview = candidate; showPhoto(preview);
      status.textContent = 'Photo selected. Save changes to upload it.';
    } catch {
      URL.revokeObjectURL(candidate);
      if (version === selectionVersion) status.textContent = 'This image could not be read. Choose another photo.';
    } finally { if (version === selectionVersion) submit.disabled = false; }
  });
  document.getElementById('remove-photo').addEventListener('click', () => {
    clearSelection(); submit.disabled = false; removePhoto = true; showPhoto(null);
    status.textContent = 'Save changes to remove your profile picture.';
  });
  document.getElementById('cancel-profile').addEventListener('click', () => {
    populate(); submit.disabled = false; status.textContent = 'Unsaved changes discarded.';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || submit.disabled || !form.reportValidity()) return;
    const first_name = form.elements.first_name.value.trim();
    const last_name = form.elements.last_name.value.trim();
    if (!first_name || !last_name) { status.textContent = 'Enter your first and last name.'; return; }
    const changes = { first_name, last_name, phone: form.elements.phone.value.trim() || null };
    busy = true; fields.disabled = true; submit.textContent = 'Saving…'; status.textContent = '';
    try {
      const user = await CommunityAuth.user();
      if (user.id !== owner) throw new Error('Your account changed. Reload this page before saving.');
      const db = CommunityAuth.getClient();
      if (selected) {
        const objectPath = `${user.id}/${crypto.randomUUID()}.${types[selected.type]}`;
        const { error } = await db.storage.from('avatars').upload(objectPath, selected, {
          contentType: selected.type, cacheControl: '3600', upsert: false
        });
        if (error) throw new Error('Your photo could not be uploaded. Check your connection and try again.');
        changes.avatar_path = objectPath;
      } else if (removePhoto) changes.avatar_path = null;
      const { data, error } = await db.from('profiles').update(changes).eq('id', user.id)
        .select('id,first_name,last_name,phone,avatar_path').single();
      if (error || !data) throw new Error('Your profile could not be saved. Please retry.');
      saved = data; populate();
      document.querySelectorAll('[data-auth-name]').forEach(el => { el.textContent = `${data.first_name} ${data.last_name}`; });
      status.textContent = 'Your profile has been saved.';
    } catch (error) { status.textContent = CommunityAuth.message(error); }
    finally { busy = false; fields.disabled = false; submit.textContent = 'Save changes'; }
  });
})();
