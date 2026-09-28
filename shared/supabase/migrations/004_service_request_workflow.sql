-- Service requests: validated creation and atomic assignment/status changes.
-- Apply after migrations 001-003 using a trusted database administrator.
-- All browser writes to requests/assignments now use the RPCs below.
begin;

-- Avoid requests -> assignments -> requests recursive SELECT policies.
-- Helpers inspect only the signed-in identity, never a supplied user/role.
create or replace function private.owns_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.requests r
        where r.id = p_request_id and r.user_id = (select auth.uid())
    );
$$;

create or replace function private.is_assigned_to_request(p_request_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.assignments ass
        join public.assistants a on a.id = ass.assistant_id
        where ass.request_id = p_request_id and a.user_id = (select auth.uid())
    );
$$;

revoke all on function private.owns_request(uuid) from public, anon, authenticated;
revoke all on function private.is_assigned_to_request(uuid) from public, anon, authenticated;
grant execute on function private.owns_request(uuid) to authenticated;
grant execute on function private.is_assigned_to_request(uuid) to authenticated;

drop policy if exists "Users can view own requests" on public.requests;
create policy "Users can view own requests" on public.requests
for select to authenticated using (
    user_id = (select auth.uid())
    or (request_type = 'service' and status = 'open'
        and (select private.is_verified_assistant()))
    or private.is_assigned_to_request(id)
    or (select private.is_admin())
);

drop policy if exists "Relevant users can view assignments" on public.assignments;
create policy "Relevant users can view assignments" on public.assignments
for select to authenticated using (
    private.owns_request(request_id)
    or private.is_assigned_to_request(request_id)
    or (select private.is_admin())
);

-- A requester must not forge status, assignment, owner or timestamps by
-- bypassing the UI. Unimplemented resource/problem writes need their own RPCs.
drop policy if exists "Community users can create own requests" on public.requests;
drop policy if exists "Users can update own requests" on public.requests;
revoke all on table public.requests, public.assignments from public, anon, authenticated;
grant select on table public.requests, public.assignments to authenticated;

create or replace function public.create_service_request(
    p_category text,
    p_description text,
    p_location text,
    p_preferred_date date,
    p_preferred_time time,
    p_urgency text,
    p_additional_info text default null,
    p_request_id uuid default pg_catalog.gen_random_uuid()
)
returns public.requests language plpgsql security definer set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_role text;
    v_request public.requests%rowtype;
    v_attempt integer;
begin
    if v_user_id is null then
        raise exception using errcode = '42501', message = 'Sign in to create a service request.';
    end if;
    select p.role into v_role from public.profiles p
        where p.id = v_user_id for share;
    if v_role is distinct from 'community_user' then
        raise exception using errcode = '42501', message = 'Only community members can create service requests.';
    end if;

    p_category := pg_catalog.btrim(p_category);
    p_description := pg_catalog.btrim(p_description);
    p_location := pg_catalog.btrim(p_location);
    p_urgency := pg_catalog.btrim(p_urgency);
    p_additional_info := nullif(pg_catalog.btrim(p_additional_info), '');

    if p_category is null or p_category not in (
        'food_water_delivery', 'grocery_collection', 'elderly_assistance',
        'public_transport_assistance', 'healthcare_facility_assistance',
        'donated_resource_delivery', 'other_approved_service'
    ) then
        raise exception using errcode = '22023', message = 'Choose a valid service category.';
    end if;
    if p_description is null or pg_catalog.char_length(p_description) not between 1 and 1000 then
        raise exception using errcode = '22023', message = 'Enter a description of 1 to 1000 characters.';
    end if;
    if p_location is null or pg_catalog.char_length(p_location) not between 1 and 200 then
        raise exception using errcode = '22023', message = 'Enter a location of 1 to 200 characters.';
    end if;
    if pg_catalog.char_length(p_additional_info) > 1000 then
        raise exception using errcode = '22023', message = 'Additional information must be 1000 characters or fewer.';
    end if;
    if p_urgency is null or p_urgency not in ('low', 'medium', 'high') then
        raise exception using errcode = '22023', message = 'Choose low, medium or high urgency.';
    end if;
    if p_request_id is null or p_preferred_date is null or not pg_catalog.isfinite(p_preferred_date)
        or p_preferred_time is null or p_preferred_time >= time '24:00' then
        raise exception using errcode = '22023', message = 'Enter a valid request reference, preferred date and time.';
    end if;

    -- A retry with the same UUID returns the existing request only when the
    -- caller owns it and all input fields match. Past-date checks apply to new
    -- requests, so a response lost yesterday can still be recovered today.
    -- The second iteration handles a concurrent INSERT with the same UUID.
    for v_attempt in 1..2 loop
        select r.* into v_request from public.requests r
            where r.id = p_request_id for update;
        if found then
            if v_request.user_id = v_user_id and v_request.request_type = 'service'
                and v_request.category = p_category
                and v_request.description = p_description
                and v_request.location = p_location
                and v_request.preferred_date = p_preferred_date
                and v_request.preferred_time = p_preferred_time
                and v_request.urgency = p_urgency
                and v_request.additional_info is not distinct from p_additional_info then
                return v_request;
            end if;
            raise exception using errcode = 'P0001', message = 'This request reference cannot be reused. Start a new request.';
        end if;

        if p_preferred_date < (pg_catalog.timezone('Africa/Johannesburg', pg_catalog.now()))::date then
            raise exception using errcode = '22023', message = 'Choose today or a future preferred date.';
        end if;
        insert into public.requests (
            id, user_id, request_type, category, description, location,
            preferred_date, preferred_time, urgency, additional_info, status
        ) values (
            p_request_id, v_user_id, 'service', p_category, p_description, p_location,
            p_preferred_date, p_preferred_time, p_urgency, p_additional_info, 'open'
        ) on conflict (id) do nothing returning * into v_request;
        if found then return v_request; end if;
    end loop;
    raise exception using errcode = 'P0001', message = 'The request could not be saved. Please try again.';
end;
$$;

create or replace function public.accept_service_request(p_request_id uuid)
returns public.requests language plpgsql security definer set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_assistant_id uuid;
    v_assignment_id uuid;
    v_request public.requests%rowtype;
begin
    if v_user_id is null then
        raise exception using errcode = '42501', message = 'Sign in to accept a service request.';
    end if;
    -- Lock eligibility while acting, so concurrent suspension cannot be ignored.
    select a.id into v_assistant_id from public.assistants a
        where a.user_id = v_user_id and a.verification_status = 'verified'
        and a.training_status = 'completed' for share;
    if not found then
        raise exception using errcode = '42501', message = 'Only verified assistants who completed training can accept requests.';
    end if;
    select r.* into v_request from public.requests r
        where r.id = p_request_id and r.request_type = 'service' for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'This service request is unavailable. Refresh the list.';
    end if;
    if v_request.user_id = v_user_id then
        raise exception using errcode = '42501', message = 'You cannot accept your own request.';
    end if;
    if v_request.status <> 'open' then
        raise exception using errcode = 'P0001', message = 'This service request is unavailable. Refresh the list.';
    end if;

    -- Request row lock + existing unique request_id index ensure one winner.
    insert into public.assignments (request_id, assistant_id, status)
        values (p_request_id, v_assistant_id, 'assigned')
        on conflict (request_id) do nothing returning id into v_assignment_id;
    if v_assignment_id is null then
        raise exception using errcode = 'P0001', message = 'This service request is unavailable. Refresh the list.';
    end if;
    update public.requests set status = 'assigned' where id = p_request_id
        returning * into v_request;
    return v_request;
end;
$$;

create or replace function public.cancel_service_request(p_request_id uuid)
returns public.requests language plpgsql security definer set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_request public.requests%rowtype;
begin
    if v_user_id is null then
        raise exception using errcode = '42501', message = 'Sign in to cancel a service request.';
    end if;
    select r.* into v_request from public.requests r
        where r.id = p_request_id and r.user_id = v_user_id
        and r.request_type = 'service' for update;
    if not found then
        raise exception using errcode = '42501', message = 'You can only cancel your own service requests.';
    end if;
    if v_request.status <> 'open' or exists (
        select 1 from public.assignments ass where ass.request_id = p_request_id
    ) then
        raise exception using errcode = 'P0001', message = 'Only open requests can be cancelled. Refresh the list.';
    end if;
    update public.requests set status = 'cancelled' where id = p_request_id
        returning * into v_request;
    return v_request;
end;
$$;

-- Private implementation keeps start/complete authorization and locks identical.
-- Browser roles cannot execute it directly or supply arbitrary next statuses.
create or replace function private.advance_service_request(p_request_id uuid, p_next_status text)
returns public.requests language plpgsql security definer set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
    v_assistant_id uuid;
    v_expected_status text;
    v_request public.requests%rowtype;
    v_assignment public.assignments%rowtype;
begin
    if v_user_id is null then
        raise exception using errcode = '42501', message = 'Sign in to update a service request.';
    end if;
    if p_next_status is null or p_next_status not in ('in_progress', 'completed') then
        raise exception using errcode = '22023', message = 'Invalid service request status.';
    end if;
    v_expected_status := case when p_next_status = 'in_progress' then 'assigned' else 'in_progress' end;
    select a.id into v_assistant_id from public.assistants a
        where a.user_id = v_user_id and a.verification_status = 'verified'
        and a.training_status = 'completed' for share;
    if not found then
        raise exception using errcode = '42501', message = 'Only verified assistants who completed training can update jobs.';
    end if;
    select r.* into v_request from public.requests r
        where r.id = p_request_id and r.request_type = 'service' for update;
    select ass.* into v_assignment from public.assignments ass
        where ass.request_id = p_request_id and ass.assistant_id = v_assistant_id for update;
    if v_request.id is null or not found then
        raise exception using errcode = '42501', message = 'Only the assigned assistant can update this job.';
    end if;
    if v_request.status <> v_expected_status or v_assignment.status <> v_expected_status then
        raise exception using errcode = 'P0001', message = 'This job status has changed. Refresh the list.';
    end if;

    update public.assignments set status = p_next_status,
        completed_at = case when p_next_status = 'completed' then pg_catalog.now() else null end
        where id = v_assignment.id;
    update public.requests set status = p_next_status where id = p_request_id
        returning * into v_request;
    return v_request;
end;
$$;

create or replace function public.start_service_request(p_request_id uuid)
returns public.requests language plpgsql security definer set search_path = ''
as $$
begin
    return private.advance_service_request(p_request_id, 'in_progress');
end;
$$;

create or replace function public.complete_service_request(p_request_id uuid)
returns public.requests language plpgsql security definer set search_path = ''
as $$
begin
    return private.advance_service_request(p_request_id, 'completed');
end;
$$;

revoke all on function private.advance_service_request(uuid, text) from public, anon, authenticated;
revoke all on function public.create_service_request(text, text, text, date, time, text, text, uuid) from public, anon, authenticated;
revoke all on function public.accept_service_request(uuid) from public, anon, authenticated;
revoke all on function public.cancel_service_request(uuid) from public, anon, authenticated;
revoke all on function public.start_service_request(uuid) from public, anon, authenticated;
revoke all on function public.complete_service_request(uuid) from public, anon, authenticated;
grant execute on function public.create_service_request(text, text, text, date, time, text, text, uuid) to authenticated;
grant execute on function public.accept_service_request(uuid) to authenticated;
grant execute on function public.cancel_service_request(uuid) to authenticated;
grant execute on function public.start_service_request(uuid) to authenticated;
grant execute on function public.complete_service_request(uuid) to authenticated;

commit;
