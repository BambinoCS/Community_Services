-- ============================================================
-- COMMUNITY SERVICE DELIVERY PLATFORM
-- Initial Supabase Database Schema
-- ============================================================


-- ============================================================
-- 1. PRIVATE SCHEMA
-- Internal helper functions used by RLS live here so they are
-- not exposed through the public Data API.
-- ============================================================

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;


-- ============================================================
-- 2. PROFILES
-- One profile for every Supabase Auth user.
-- ============================================================

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,

    first_name text,
    last_name text,
    phone text,

    role text not null default 'community_user'
        check (role in (
            'community_user',
            'assistant',
            'admin',
            'organisation'
        )),

    avatar_path text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 3. ASSISTANTS
-- Extra information for users who become assistants.
-- ============================================================

create table if not exists public.assistants (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null unique
        references public.profiles(id)
        on delete cascade,

    verification_status text not null default 'pending'
        check (verification_status in (
            'pending',
            'verified',
            'rejected',
            'suspended'
        )),

    training_status text not null default 'not_started'
        check (training_status in (
            'not_started',
            'in_progress',
            'completed'
        )),

    availability text not null default 'unavailable'
        check (availability in (
            'available',
            'unavailable'
        )),

    rating numeric(3,2)
        check (
            rating is null
            or (rating >= 0 and rating <= 5)
        ),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 4. REQUESTS
-- Community requests: resource, service, or problem.
-- ============================================================

create table if not exists public.requests (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    request_type text not null
        check (request_type in (
            'resource',
            'service',
            'problem'
        )),

    category text not null,

    description text not null,

    location text,

    preferred_date date,

    preferred_time time,

    urgency text,

    additional_info text,

    status text not null default 'open'
        check (status in (
            'open',
            'assigned',
            'in_progress',
            'completed',
            'cancelled'
        )),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 5. DONATIONS
-- Items donated by community users.
-- ============================================================

create table if not exists public.donations (
    id uuid primary key default gen_random_uuid(),

    donor_id uuid not null
        references public.profiles(id)
        on delete cascade,

    item_name text not null,

    category text not null,

    description text not null,

    quantity integer not null
        check (quantity >= 1),

    location text not null,

    available_from timestamptz,

    available_until timestamptz,

    status text not null default 'available'
        check (status in (
            'available',
            'reserved',
            'collected',
            'expired',
            'cancelled'
        )),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint valid_donation_date_range
        check (
            available_from is null
            or available_until is null
            or available_until > available_from
        )
);


-- ============================================================
-- 6. DONATION IMAGES
-- Multiple images can belong to one donation.
-- Store Storage paths here, not binary image data.
-- ============================================================

create table if not exists public.donation_images (
    id uuid primary key default gen_random_uuid(),

    donation_id uuid not null
        references public.donations(id)
        on delete cascade,

    storage_path text not null,

    sort_order integer not null default 0
        check (sort_order >= 0),

    created_at timestamptz not null default now()
);


-- ============================================================
-- 7. ASSIGNMENTS
-- Connects a request to the assistant handling it.
-- ============================================================

create table if not exists public.assignments (
    id uuid primary key default gen_random_uuid(),

    request_id uuid not null
        references public.requests(id)
        on delete cascade,

    assistant_id uuid not null
        references public.assistants(id)
        on delete cascade,

    status text not null default 'assigned'
        check (status in (
            'assigned',
            'in_progress',
            'completed',
            'cancelled'
        )),

    accepted_at timestamptz not null default now(),

    completed_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- Only one active assignment row per request for this initial design.
create unique index if not exists assignments_request_id_unique
on public.assignments(request_id);


-- ============================================================
-- 8. REPORTS
-- Report statuses intentionally kept simple because the previous
-- frontend team noted that official report statuses were not yet
-- agreed.
-- ============================================================

create table if not exists public.reports (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    category text not null,

    description text not null,

    location text,

    status text not null default 'open',

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);


-- ============================================================
-- 9. NOTIFICATIONS
-- ============================================================

create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),

    user_id uuid not null
        references public.profiles(id)
        on delete cascade,

    title text not null,

    message text not null,

    type text,

    is_read boolean not null default false,

    created_at timestamptz not null default now(),
    read_at timestamptz
);


-- ============================================================
-- 10. INDEXES
-- ============================================================

create index if not exists profiles_role_idx
    on public.profiles(role);

create index if not exists assistants_user_id_idx
    on public.assistants(user_id);

create index if not exists assistants_verification_status_idx
    on public.assistants(verification_status);

create index if not exists assistants_availability_idx
    on public.assistants(availability);

create index if not exists requests_user_id_idx
    on public.requests(user_id);

create index if not exists requests_status_idx
    on public.requests(status);

create index if not exists requests_type_status_idx
    on public.requests(request_type, status);

create index if not exists donations_donor_id_idx
    on public.donations(donor_id);

create index if not exists donations_status_idx
    on public.donations(status);

create index if not exists donation_images_donation_id_idx
    on public.donation_images(donation_id);

create index if not exists assignments_assistant_id_idx
    on public.assignments(assistant_id);

create index if not exists assignments_status_idx
    on public.assignments(status);

create index if not exists reports_user_id_idx
    on public.reports(user_id);

create index if not exists reports_status_idx
    on public.reports(status);

create index if not exists notifications_user_id_idx
    on public.notifications(user_id);

create index if not exists notifications_user_read_idx
    on public.notifications(user_id, is_read);


-- ============================================================
-- 11. AUTOMATIC updated_at
-- ============================================================

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;


create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function private.set_updated_at();


create trigger assistants_set_updated_at
before update on public.assistants
for each row
execute function private.set_updated_at();


create trigger requests_set_updated_at
before update on public.requests
for each row
execute function private.set_updated_at();


create trigger donations_set_updated_at
before update on public.donations
for each row
execute function private.set_updated_at();


create trigger assignments_set_updated_at
before update on public.assignments
for each row
execute function private.set_updated_at();


create trigger reports_set_updated_at
before update on public.reports
for each row
execute function private.set_updated_at();


-- ============================================================
-- 12. AUTOMATIC PROFILE CREATION
--
-- Registration metadata may contain first_name / last_name / phone.
--
-- IMPORTANT:
-- Public signup NEVER controls the role.
-- Every normal signup begins as community_user.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin

    insert into public.profiles (
        id,
        first_name,
        last_name,
        phone,
        role
    )
    values (
        new.id,
        nullif(trim(new.raw_user_meta_data ->> 'first_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'last_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
        'community_user'
    );

    return new;

end;
$$;


revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;


drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();


-- ============================================================
-- 13. PRIVATE AUTHORIZATION HELPERS
-- ============================================================

create or replace function private.current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select p.role
    from public.profiles p
    where p.id = (select auth.uid())
    limit 1;
$$;


create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(
        (
            select p.role = 'admin'
            from public.profiles p
            where p.id = (select auth.uid())
            limit 1
        ),
        false
    );
$$;


create or replace function private.is_verified_assistant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.assistants a
        where a.user_id = (select auth.uid())
          and a.verification_status = 'verified'
          and a.training_status = 'completed'
    );
$$;


revoke all on function private.current_user_role() from public;
revoke all on function private.current_user_role() from anon;
revoke all on function private.current_user_role() from authenticated;

revoke all on function private.is_admin() from public;
revoke all on function private.is_admin() from anon;
revoke all on function private.is_admin() from authenticated;

revoke all on function private.is_verified_assistant() from public;
revoke all on function private.is_verified_assistant() from anon;
revoke all on function private.is_verified_assistant() from authenticated;


-- Policies still need permission to invoke the helper functions.
grant usage on schema private to authenticated;

grant execute on function private.current_user_role()
to authenticated;

grant execute on function private.is_admin()
to authenticated;

grant execute on function private.is_verified_assistant()
to authenticated;


-- ============================================================
-- 14. ENABLE ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.assistants enable row level security;
alter table public.requests enable row level security;
alter table public.donations enable row level security;
alter table public.donation_images enable row level security;
alter table public.assignments enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;


-- ============================================================
-- 15. MINIMUM TABLE GRANTS
-- Remove broad default API permissions, then grant only operations
-- the browser application actually needs.
-- ============================================================

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.assistants from anon, authenticated;
revoke all on table public.requests from anon, authenticated;
revoke all on table public.donations from anon, authenticated;
revoke all on table public.donation_images from anon, authenticated;
revoke all on table public.assignments from anon, authenticated;
revoke all on table public.reports from anon, authenticated;
revoke all on table public.notifications from anon, authenticated;


grant select, update
on public.profiles
to authenticated;

grant select, update
on public.assistants
to authenticated;

grant select, insert, update
on public.requests
to authenticated;

grant select, insert, update
on public.donations
to authenticated;

grant select, insert, delete
on public.donation_images
to authenticated;

grant select
on public.assignments
to authenticated;

grant select, insert
on public.reports
to authenticated;

grant select, update
on public.notifications
to authenticated;


-- ============================================================
-- 16. PROFILES RLS
-- ============================================================

create policy "Users can view own profile"
on public.profiles
for select
to authenticated
using (
    (select auth.uid()) = id
    or (select private.is_admin())
);


create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (
    (select auth.uid()) = id
    or (select private.is_admin())
)
with check (
    (select auth.uid()) = id
    or (select private.is_admin())
);


-- Prevent normal users from changing protected columns such as role.
revoke update on table public.profiles from authenticated;

grant update (
    first_name,
    last_name,
    phone,
    avatar_path
)
on public.profiles
to authenticated;


-- ============================================================
-- 17. ASSISTANTS RLS
-- ============================================================

create policy "Assistants can view own assistant record"
on public.assistants
for select
to authenticated
using (
    user_id = (select auth.uid())
    or (select private.is_admin())
);


create policy "Assistants can update own assistant record"
on public.assistants
for update
to authenticated
using (
    user_id = (select auth.uid())
    or (select private.is_admin())
)
with check (
    user_id = (select auth.uid())
    or (select private.is_admin())
);


-- Normal assistants may only change availability themselves.
revoke update on table public.assistants from authenticated;

grant update (availability)
on public.assistants
to authenticated;


-- ============================================================
-- 18. REQUESTS RLS
-- ============================================================

create policy "Users can view own requests"
on public.requests
for select
to authenticated
using (
    user_id = (select auth.uid())

    or (
        request_type = 'service'
        and status = 'open'
        and (select private.is_verified_assistant())
    )

    or exists (
        select 1
        from public.assignments ass
        join public.assistants a
          on a.id = ass.assistant_id
        where ass.request_id = requests.id
          and a.user_id = (select auth.uid())
    )

    or (select private.is_admin())
);


create policy "Community users can create own requests"
on public.requests
for insert
to authenticated
with check (
    user_id = (select auth.uid())
    and (select private.current_user_role()) = 'community_user'
    and status = 'open'
);


create policy "Users can update own requests"
on public.requests
for update
to authenticated
using (
    user_id = (select auth.uid())
    or (select private.is_admin())
)
with check (
    user_id = (select auth.uid())
    or (select private.is_admin())
);


-- ============================================================
-- 19. DONATIONS RLS
-- ============================================================

create policy "Authenticated users can view available donations"
on public.donations
for select
to authenticated
using (
    status = 'available'
    or donor_id = (select auth.uid())
    or (select private.is_admin())
);


create policy "Users can create own donations"
on public.donations
for insert
to authenticated
with check (
    donor_id = (select auth.uid())
);


create policy "Users can update own donations"
on public.donations
for update
to authenticated
using (
    donor_id = (select auth.uid())
    or (select private.is_admin())
)
with check (
    donor_id = (select auth.uid())
    or (select private.is_admin())
);


-- ============================================================
-- 20. DONATION IMAGE RLS
-- ============================================================

create policy "Users can view permitted donation images"
on public.donation_images
for select
to authenticated
using (
    exists (
        select 1
        from public.donations d
        where d.id = donation_images.donation_id
          and (
              d.status = 'available'
              or d.donor_id = (select auth.uid())
              or (select private.is_admin())
          )
    )
);


create policy "Users can add images to own donations"
on public.donation_images
for insert
to authenticated
with check (
    exists (
        select 1
        from public.donations d
        where d.id = donation_images.donation_id
          and d.donor_id = (select auth.uid())
    )
);


create policy "Users can delete images from own donations"
on public.donation_images
for delete
to authenticated
using (
    exists (
        select 1
        from public.donations d
        where d.id = donation_images.donation_id
          and d.donor_id = (select auth.uid())
    )
);


-- ============================================================
-- 21. ASSIGNMENTS RLS
--
-- Creation/status transitions will later go through controlled
-- backend/database operations so users cannot fabricate assignments.
-- ============================================================

create policy "Relevant users can view assignments"
on public.assignments
for select
to authenticated
using (

    exists (
        select 1
        from public.assistants a
        where a.id = assignments.assistant_id
          and a.user_id = (select auth.uid())
    )

    or exists (
        select 1
        from public.requests r
        where r.id = assignments.request_id
          and r.user_id = (select auth.uid())
    )

    or (select private.is_admin())
);


-- ============================================================
-- 22. REPORTS RLS
-- ============================================================

create policy "Users can view own reports"
on public.reports
for select
to authenticated
using (
    user_id = (select auth.uid())
    or (select private.is_admin())
);


create policy "Users can create own reports"
on public.reports
for insert
to authenticated
with check (
    user_id = (select auth.uid())
    and status = 'open'
);


-- ============================================================
-- 23. NOTIFICATIONS RLS
-- ============================================================

create policy "Users can view own notifications"
on public.notifications
for select
to authenticated
using (
    user_id = (select auth.uid())
    or (select private.is_admin())
);


create policy "Users can update own notifications"
on public.notifications
for update
to authenticated
using (
    user_id = (select auth.uid())
)
with check (
    user_id = (select auth.uid())
);


-- Users should only change read state from the browser.
revoke update on table public.notifications from authenticated;

grant update (
    is_read,
    read_at
)
on public.notifications
to authenticated;


-- ============================================================
-- INITIAL DATABASE SCHEMA COMPLETE
-- ============================================================