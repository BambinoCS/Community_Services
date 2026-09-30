-- Apply after 009. Service acceptance and delivery matching share the assistant lock.
begin;

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
    -- An exclusive lock serializes this action with match_delivery/claim_item_delivery.
    select a.id into v_assistant_id from public.assistants a
        where a.user_id = v_user_id and a.verification_status = 'verified'
        and a.training_status = 'completed' for update;
    if not found then
        raise exception using errcode = '42501', message = 'Only verified assistants who completed training can accept requests.';
    end if;
    if exists (select 1 from public.item_handoffs h
        where h.assistant_id = v_assistant_id and h.status = 'arranged') then
        raise exception using errcode = '55000', message = 'Finish your current delivery before accepting a service request.';
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
revoke all on function public.accept_service_request(uuid) from public, anon;
grant execute on function public.accept_service_request(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
