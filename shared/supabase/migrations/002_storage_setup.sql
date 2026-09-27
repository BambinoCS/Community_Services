-- ============================================================
-- COMMUNITY SERVICE DELIVERY PLATFORM
-- Migration 002: Supabase Storage
-- ============================================================


-- ============================================================
-- 1. CREATE STORAGE BUCKETS
-- ============================================================

-- Profile/avatar images.
-- Public so profile images can later be displayed easily.
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'avatars',
    'avatars',
    true,
    5242880, -- 5 MB
    array[
        'image/jpeg',
        'image/png',
        'image/webp'
    ]
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


-- Donation images.
-- Public because donation listings are intended to be browsable.
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'donation-images',
    'donation-images',
    true,
    10485760, -- 10 MB
    array[
        'image/jpeg',
        'image/png',
        'image/webp'
    ]
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


-- Assistant verification documents.
-- MUST remain private.
insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'verification-documents',
    'verification-documents',
    false,
    10485760, -- 10 MB
    array[
        'application/pdf',
        'image/jpeg',
        'image/png'
    ]
)
on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;


-- ============================================================
-- 2. AVATAR POLICIES
--
-- Required path format:
--
-- avatars/
--     USER_UUID/
--         avatar.jpg
--
-- A user can only upload/change/delete files inside their own
-- UUID folder.
-- ============================================================

create policy "Authenticated users can upload own avatar"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);


create policy "Users can update own avatar"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'avatars'
    and owner_id = (select auth.uid()::text)
)
with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);


create policy "Users can delete own avatar"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'avatars'
    and owner_id = (select auth.uid()::text)
);


-- ============================================================
-- 3. DONATION IMAGE POLICIES
--
-- Required path format:
--
-- donation-images/
--     USER_UUID/
--         DONATION_UUID/
--             image-file.jpg
--
-- Users can only upload/change/delete files under their own UUID.
-- ============================================================

create policy "Users can upload own donation images"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'donation-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);


create policy "Users can update own donation images"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'donation-images'
    and owner_id = (select auth.uid()::text)
)
with check (
    bucket_id = 'donation-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);


create policy "Users can delete own donation images"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'donation-images'
    and owner_id = (select auth.uid()::text)
);


-- ============================================================
-- 4. VERIFICATION DOCUMENT POLICIES
--
-- Required path format:
--
-- verification-documents/
--     USER_UUID/
--         document.pdf
--
-- These files are PRIVATE.
-- ============================================================

create policy "Users can upload own verification documents"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);


create policy "Users can view own verification documents"
on storage.objects
for select
to authenticated
using (
    bucket_id = 'verification-documents'
    and owner_id = (select auth.uid()::text)
);


create policy "Users can update own verification documents"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'verification-documents'
    and owner_id = (select auth.uid()::text)
)
with check (
    bucket_id = 'verification-documents'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
);


create policy "Users can delete own verification documents"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'verification-documents'
    and owner_id = (select auth.uid()::text)
);


-- ============================================================
-- MIGRATION 002 COMPLETE
-- ============================================================