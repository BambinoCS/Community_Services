-- ============================================================
-- MIGRATION 003: DEVELOPER ACCOUNTS
-- ============================================================

create table if not exists public.developer_accounts (
    user_id uuid primary key
        references public.profiles(id)
        on delete cascade,

    created_at timestamptz not null default now()
);

alter table public.developer_accounts
enable row level security;

create policy "Developers can check own developer status"
on public.developer_accounts
for select
to authenticated
using (
    user_id = (select auth.uid())
);

-- IMPORTANT:
-- There are intentionally no INSERT, UPDATE, or DELETE policies.
-- Developer access must only be granted through trusted
-- administrative/database operations.s