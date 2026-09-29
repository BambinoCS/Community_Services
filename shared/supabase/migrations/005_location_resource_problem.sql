-- Location coordinates, item (resource) requests, and report extras.
-- Apply after migrations 001-004 using a trusted database administrator.
begin;

-- ============================================================
-- 1. COORDINATES + QUANTITY
-- Text location stays the source users type; latitude/longitude are
-- captured from the browser so assistants and collectors can navigate.
-- ============================================================

alter table public.requests
    add column if not exists latitude double precision,
    add column if not exists longitude double precision,
    add column if not exists quantity integer,
    add constraint requests_latitude_valid check (latitude is null or latitude between -90 and 90),
    add constraint requests_longitude_valid check (longitude is null or longitude between -180 and 180),
    add constraint requests_quantity_valid check (quantity is null or quantity >= 1);

alter table public.donations
    add column if not exists latitude double precision,
    add column if not exists longitude double precision,
    add constraint donations_latitude_valid check (latitude is null or latitude between -90 and 90),
    add constraint donations_longitude_valid check (longitude is null or longitude between -180 and 180);

alter table public.reports
    add column if not exists latitude double precision,
    add column if not exists longitude double precision,
    add column if not exists urgency text,
    add column if not exists additional_info text,
    add constraint reports_latitude_valid check (latitude is null or latitude between -90 and 90),
    add constraint reports_longitude_valid check (longitude is null or longitude between -180 and 180),
    add constraint reports_urgency_valid check (urgency is null or urgency in ('low', 'medium', 'high'));

-- ============================================================
-- 2. BROWSE OPEN ITEM REQUESTS
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

-- ============================================================
-- 3. SERVICE REQUESTS NOW ACCEPT COORDINATES
-- Same validation and idempotent retry as migration 004, plus optional
-- latitude/longitude for directions.
-- ============================================================

drop function if exists public.create_service_request(text, text, text, date, time, text, text, uuid);

create or replace function public.create_service_request(
    p_category text,
    p_description text,
    p_location text,
    p_preferred_date date,
    p_preferred_time time,
    p_urgency text,
    p_additional_info text default null,
    p_request_id uuid default pg_catalog.gen_random_uuid(),
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
            preferred_date, preferred_time, urgency, additional_info, status,
            latitude, longitude
        ) values (
            p_request_id, v_user_id, 'service', p_category, p_description, p_location,
            p_preferred_date, p_preferred_time, p_urgency, p_additional_info, 'open',
            p_latitude, p_longitude
        ) on conflict (id) do nothing returning * into v_request;
        if found then return v_request; end if;
    end loop;
    raise exception using errcode = 'P0001', message = 'The request could not be saved. Please try again.';
end;
$$;

-- ============================================================
-- 4. ITEM (RESOURCE) REQUESTS
-- Same idempotent retry design as service requests, without scheduling.
-- ============================================================

create or replace function public.create_resource_request(
    p_category text,
    p_description text,
    p_quantity integer,
    p_location text,
    p_urgency text,
    p_additional_info text default null,
    p_request_id uuid default pg_catalog.gen_random_uuid(),
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
        raise exception using errcode = '42501', message = 'Sign in to create an item request.';
    end if;
    select p.role into v_role from public.profiles p
        where p.id = v_user_id for share;
    if v_role is distinct from 'community_user' then
        raise exception using errcode = '42501', message = 'Only community members can request items.';
    end if;

    p_category := pg_catalog.btrim(p_category);
    p_description := pg_catalog.btrim(p_description);
    p_location := pg_catalog.btrim(p_location);
    p_urgency := pg_catalog.btrim(p_urgency);
    p_additional_info := nullif(pg_catalog.btrim(p_additional_info), '');

    if p_category is null or p_category not in (
        'food', 'water', 'clothing', 'school_supplies', 'household_goods', 'other'
    ) then
        raise exception using errcode = '22023', message = 'Choose a valid item category.';
    end if;
    if p_description is null or pg_catalog.char_length(p_description) not between 1 and 1000 then
        raise exception using errcode = '22023', message = 'Enter a description of 1 to 1000 characters.';
    end if;
    if p_quantity is null or p_quantity < 1 then
        raise exception using errcode = '22023', message = 'Quantity must be at least 1.';
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
    if p_request_id is null then
        raise exception using errcode = '22023', message = 'Enter a valid request reference.';
    end if;

    for v_attempt in 1..2 loop
        select r.* into v_request from public.requests r
            where r.id = p_request_id for update;
        if found then
            if v_request.user_id = v_user_id and v_request.request_type = 'resource'
                and v_request.category = p_category
                and v_request.description = p_description
                and v_request.quantity is not distinct from p_quantity
                and v_request.location = p_location
                and v_request.urgency = p_urgency
                and v_request.additional_info is not distinct from p_additional_info
                and v_request.latitude is not distinct from p_latitude
                and v_request.longitude is not distinct from p_longitude then
                return v_request;
            end if;
            raise exception using errcode = 'P0001', message = 'This request reference cannot be reused. Start a new request.';
        end if;

        insert into public.requests (
            id, user_id, request_type, category, description, quantity, location,
            urgency, additional_info, status, latitude, longitude
        ) values (
            p_request_id, v_user_id, 'resource', p_category, p_description, p_quantity, p_location,
            p_urgency, p_additional_info, 'open', p_latitude, p_longitude
        ) on conflict (id) do nothing returning * into v_request;
        if found then return v_request; end if;
    end loop;
    raise exception using errcode = 'P0001', message = 'The request could not be saved. Please try again.';
end;
$$;

-- ============================================================
-- 5. CANCELLATION ALSO COVERS ITEM REQUESTS
-- ============================================================

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
        and r.request_type in ('service', 'resource') for update;
    if not found then
        raise exception using errcode = '42501', message = 'You can only cancel your own requests.';
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

revoke all on function public.create_service_request(text, text, text, date, time, text, text, uuid, double precision, double precision) from public, anon, authenticated;
revoke all on function public.create_resource_request(text, text, integer, text, text, text, uuid, double precision, double precision) from public, anon, authenticated;
revoke all on function public.cancel_service_request(uuid) from public, anon, authenticated;
grant execute on function public.create_service_request(text, text, text, date, time, text, text, uuid, double precision, double precision) to authenticated;
grant execute on function public.create_resource_request(text, text, integer, text, text, text, uuid, double precision, double precision) to authenticated;
grant execute on function public.cancel_service_request(uuid) to authenticated;

commit;
