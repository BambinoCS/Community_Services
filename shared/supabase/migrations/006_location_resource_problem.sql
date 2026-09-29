-- Location coordinates for requests, donations, and reports.
-- Apply after migrations 001-005 using a trusted database administrator.
begin;

-- ============================================================
-- 1. COORDINATES
-- Text location stays the source users type; latitude/longitude are
-- captured from the browser so assistants and collectors can navigate.
-- ============================================================

alter table public.requests
    add column if not exists latitude double precision,
    add column if not exists longitude double precision,
    add constraint requests_latitude_valid check (latitude is null or latitude between -90 and 90),
    add constraint requests_longitude_valid check (longitude is null or longitude between -180 and 180);

alter table public.donations
    add column if not exists latitude double precision,
    add column if not exists longitude double precision,
    add constraint donations_latitude_valid check (latitude is null or latitude between -90 and 90),
    add constraint donations_longitude_valid check (longitude is null or longitude between -180 and 180);

alter table public.reports
    add column if not exists latitude double precision,
    add column if not exists longitude double precision,
    add constraint reports_latitude_valid check (latitude is null or latitude between -90 and 90),
    add constraint reports_longitude_valid check (longitude is null or longitude between -180 and 180),
    add constraint reports_urgency_valid check (urgency is null or urgency in ('low', 'medium', 'high'));

-- ============================================================
-- 2. OPEN ITEM (RESOURCE) REQUESTS ARE VISIBLE TO MEMBERS
-- Donors deciding what to give must see open resource requests. Only
-- non-sensitive columns are selected by the frontend.
-- ============================================================

drop policy if exists "Users can view own requests" on public.requests;
create policy "Users can view own requests" on public.requests
for select to authenticated using (
    user_id = (select auth.uid())
    or (request_type = 'service' and status = 'open'
        and (select private.is_verified_assistant()))
    or (request_type = 'resource' and status = 'open')
    or private.is_assigned_to_request(id)
    or (select private.is_admin())
);

-- Resource requests are inserted directly under the migration 005 policy,
-- so members must also be able to store the coordinates they captured.
grant insert (latitude, longitude) on public.requests to authenticated;

-- ============================================================
-- 3. SERVICE REQUESTS NOW ACCEPT COORDINATES
-- Same validation, problems addressed, and idempotent retry as migration
-- 005, plus optional latitude/longitude for directions. The old overload
-- is dropped so 9-argument calls cannot bypass the range checks.
-- ============================================================

drop function if exists public.create_service_request(text, text, text, date, time, text, text, uuid, text[]);

create or replace function public.create_service_request(
    p_category text,
    p_description text,
    p_location text,
    p_preferred_date date,
    p_preferred_time time,
    p_urgency text,
    p_additional_info text default null,
    p_request_id uuid default pg_catalog.gen_random_uuid(),
    p_problems_addressed text[] default null,
    p_latitude double precision default null,
    p_longitude double precision default null
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
        'donated_resource_delivery', 'other_approved_service',
        'elderly_vulnerable_assistance', 'public_transport_accompaniment', 'healthcare_access'
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
    p_problems_addressed := coalesce(p_problems_addressed, array[]::text[]);
    if not (p_problems_addressed <@ array['food_access','water_access','transport_access',
        'healthcare_access','elderly_vulnerable_support','resource_delivery','other']::text[])
        or pg_catalog.cardinality(p_problems_addressed) > 7
        or pg_catalog.array_position(p_problems_addressed, null) is not null then
        raise exception using errcode = '22023', message = 'Choose valid problems addressed.';
    end if;
    if (p_latitude is not null and not (p_latitude between -90 and 90))
        or (p_longitude is not null and not (p_longitude between -180 and 180)) then
        raise exception using errcode = '22023', message = 'Choose a valid location.';
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
                and v_request.additional_info is not distinct from p_additional_info
                and coalesce(v_request.problems_addressed, array[]::text[]) = p_problems_addressed
                and v_request.latitude is not distinct from p_latitude
                and v_request.longitude is not distinct from p_longitude then
                return v_request;
            end if;
            raise exception using errcode = 'P0001', message = 'This request reference cannot be reused. Start a new request.';
        end if;

        if p_preferred_date < (pg_catalog.timezone('Africa/Johannesburg', pg_catalog.now()))::date then
            raise exception using errcode = '22023', message = 'Choose today or a future preferred date.';
        end if;
        insert into public.requests (
            id, user_id, request_type, category, description, location,
            preferred_date, preferred_time, urgency, additional_info, status, problems_addressed,
            latitude, longitude
        ) values (
            p_request_id, v_user_id, 'service', p_category, p_description, p_location,
            p_preferred_date, p_preferred_time, p_urgency, p_additional_info, 'open', p_problems_addressed,
            p_latitude, p_longitude
        ) on conflict (id) do nothing returning * into v_request;
        if found then return v_request; end if;
    end loop;
    raise exception using errcode = 'P0001', message = 'The request could not be saved. Please try again.';
end;
$$;

revoke all on function public.create_service_request(text, text, text, date, time, text, text, uuid, text[], double precision, double precision) from public, anon, authenticated;
grant execute on function public.create_service_request(text, text, text, date, time, text, text, uuid, text[], double precision, double precision) to authenticated;

commit;
