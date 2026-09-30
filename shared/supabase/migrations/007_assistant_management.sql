-- Apply after 006. Membership is requested by the owner; only real admins review it.
begin;
create table public.assistant_reviews (
    id uuid primary key default gen_random_uuid(),
    assistant_id uuid not null references public.assistants(id) on delete cascade,
    reviewer_id uuid not null references public.profiles(id),
    previous_verification text not null,
    verification_status text not null,
    previous_training text not null,
    training_status text not null,
    reason text not null default '',
    created_at timestamptz not null default now()
);
alter table public.assistant_reviews enable row level security;
revoke all on public.assistant_reviews from anon, authenticated;
grant select on public.assistant_reviews to authenticated;
create policy "Admins can read assistant review history" on public.assistant_reviews
for select to authenticated using ((select private.is_admin()));

create function public.apply_to_be_assistant()
returns public.assistants language plpgsql security definer set search_path = '' as $$
declare
    v_user uuid := auth.uid();
    v_row public.assistants%rowtype;
begin
    if v_user is null or not exists (
        select 1 from public.profiles where id = v_user and role in ('community_user', 'assistant')
    ) then
        raise exception 'Not permitted' using errcode = '42501';
    end if;
    insert into public.assistants(user_id) values (v_user)
    on conflict (user_id) do nothing;
    select * into v_row from public.assistants where user_id = v_user;
    return v_row;
end;
$$;

create function public.review_assistant(
    p_assistant_id uuid, p_verification text, p_training text,
    p_expected_verification text, p_expected_training text, p_reason text default ''
)
returns public.assistants language plpgsql security definer set search_path = '' as $$
declare
    v_before public.assistants%rowtype;
    v_after public.assistants%rowtype;
begin
    if auth.uid() is null or not private.is_admin() then
        raise exception 'Admin access required' using errcode = '42501';
    end if;
    if p_verification is null or p_verification not in ('pending','verified','rejected','suspended')
       or p_training is null or p_training not in ('not_started','in_progress','completed')
       or length(coalesce(p_reason, '')) > 1000
       or (p_verification in ('rejected','suspended') and length(trim(coalesce(p_reason, ''))) = 0) then
        raise exception 'Invalid review' using errcode = '22023';
    end if;
    select * into v_before from public.assistants where id = p_assistant_id for update;
    if not found then raise exception 'Assistant missing' using errcode = '22023'; end if;
    if v_before.verification_status is distinct from p_expected_verification
       or v_before.training_status is distinct from p_expected_training then
        raise exception 'Stale review' using errcode = '40001';
    end if;
    update public.assistants set verification_status = p_verification, training_status = p_training,
        availability = case when p_verification = 'verified' and p_training = 'completed'
                            then availability else 'unavailable' end,
        updated_at = now()
    where id = p_assistant_id returning * into v_after;
    insert into public.assistant_reviews(assistant_id, reviewer_id, previous_verification,
        verification_status, previous_training, training_status, reason)
    values (p_assistant_id, auth.uid(), v_before.verification_status, p_verification,
        v_before.training_status, p_training, trim(coalesce(p_reason, '')));
    return v_after;
end;
$$;
revoke all on function public.apply_to_be_assistant() from public, anon;
revoke all on function public.review_assistant(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.apply_to_be_assistant() to authenticated;
grant execute on function public.review_assistant(uuid,text,text,text,text,text) to authenticated;
commit;
