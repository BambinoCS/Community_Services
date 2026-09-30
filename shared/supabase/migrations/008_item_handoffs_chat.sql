-- Donation/item-request conversations and delivery assistance. Apply after 007.
begin;

create table public.item_handoffs (
    id uuid primary key,
    donation_id uuid references public.donations(id),
    resource_request_id uuid references public.requests(id),
    initiator_id uuid not null references public.profiles(id),
    donor_id uuid not null references public.profiles(id),
    recipient_id uuid not null references public.profiles(id),
    assistant_id uuid references public.assistants(id),
    title text not null,
    quantity integer not null check (quantity > 0),
    transport_mode text not null check (transport_mode in ('self_collect','self_deliver','assistance')),
    pickup_location text not null,
    delivery_location text not null default '',
    status text not null check (status in ('waiting_assistant','arranged','completed','cancelled')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (num_nonnulls(donation_id,resource_request_id)=1),
    check (donor_id <> recipient_id)
);
create unique index one_handoff_per_donation on public.item_handoffs(donation_id) where status <> 'cancelled';
create unique index one_handoff_per_request on public.item_handoffs(resource_request_id) where status <> 'cancelled';
create unique index one_active_delivery_per_assistant on public.item_handoffs(assistant_id) where status = 'arranged';
create index handoff_donor_inbox on public.item_handoffs(donor_id,created_at desc);
create index handoff_recipient_inbox on public.item_handoffs(recipient_id,created_at desc);

create table public.chat_messages (
    id bigint generated always as identity primary key,
    handoff_id uuid not null references public.item_handoffs(id),
    sender_id uuid not null references public.profiles(id),
    sender_name text not null,
    client_id uuid not null unique,
    body text not null check (length(trim(body)) between 1 and 2000),
    created_at timestamptz not null default now()
);
create index chat_history on public.chat_messages(handoff_id,id desc);
alter table public.item_handoffs enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.item_handoffs,public.chat_messages from anon,authenticated;
grant select on public.item_handoffs,public.chat_messages to authenticated;

create function private.can_read_handoff(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
    select exists(select 1 from public.item_handoffs h where h.id=p_id and (
      auth.uid() in (h.donor_id,h.recipient_id)
      or exists(select 1 from public.assistants a where a.id=h.assistant_id
        and a.user_id=auth.uid() and a.verification_status='verified' and a.training_status='completed')
    ));
$$;
revoke all on function private.can_read_handoff(uuid) from public,anon,authenticated;
grant execute on function private.can_read_handoff(uuid) to authenticated;
create policy "Only conversation participants can read arrangements" on public.item_handoffs
for select to authenticated using (private.can_read_handoff(id));
create policy "Only conversation participants can read messages" on public.chat_messages
for select to authenticated using (private.can_read_handoff(handoff_id));

create function public.item_handoff_participants(p_id uuid)
returns table(participant_role text,display_name text,eligible boolean)
language plpgsql security definer set search_path='' as $$
declare h public.item_handoffs%rowtype;
begin
    if not private.can_read_handoff(p_id) then raise exception 'Participant required' using errcode='42501'; end if;
    select * into h from public.item_handoffs where id=p_id;
    return query select 'Donor'::text,coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),'Community member'),true from public.profiles p where p.id=h.donor_id
    union all select 'Recipient'::text,coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),'Community member'),true from public.profiles p where p.id=h.recipient_id
    union all select 'Assistant'::text,coalesce(nullif(trim(concat_ws(' ',p.first_name,p.last_name)),''),'Community assistant'),a.verification_status='verified' and a.training_status='completed'
      from public.assistants a join public.profiles p on p.id=a.user_id where a.id=h.assistant_id;
end;
$$;
revoke all on function public.item_handoff_participants(uuid) from public,anon,authenticated;
grant execute on function public.item_handoff_participants(uuid) to authenticated;

-- Lock the assistant when selecting so simultaneous deliveries choose different people.
create function private.match_delivery(p_id uuid) returns public.item_handoffs
language plpgsql security definer set search_path='' as $$
declare h public.item_handoffs%rowtype; chosen uuid;
begin
    select * into h from public.item_handoffs where id=p_id;
    if h.status <> 'waiting_assistant' then return h; end if;
    select a.id into chosen from public.assistants a
    where a.verification_status='verified' and a.training_status='completed' and a.availability='available'
      and a.user_id not in (h.donor_id,h.recipient_id)
      and not exists(select 1 from public.assignments j where j.assistant_id=a.id and j.status in ('assigned','in_progress'))
      and not exists(select 1 from public.item_handoffs other where other.assistant_id=a.id and other.status='arranged')
    order by a.updated_at,a.id limit 1 for update of a skip locked;
    if chosen is not null then
      update public.item_handoffs set assistant_id=chosen,status='arranged',updated_at=now() where id=p_id returning * into h;
    end if;
    return h;
end;
$$;
revoke all on function private.match_delivery(uuid) from public,anon,authenticated;

create function public.start_item_handoff(p_id uuid,p_source_type text,p_source_id uuid,p_mode text,p_location text default '')
returns public.item_handoffs language plpgsql security definer set search_path='' as $$
declare
    who uuid := auth.uid(); h public.item_handoffs%rowtype;
    d public.donations%rowtype; r public.requests%rowtype;
    donor uuid; recipient uuid; title text; qty integer; pickup text; delivery text;
begin
    if who is null or not exists(select 1 from public.profiles where id=who) then
      raise exception 'Sign in required' using errcode='42501';
    end if;
    if p_id is null or p_source_id is null or p_source_type is null or p_source_type not in ('donation','request')
      or p_mode is null or p_mode not in ('self_collect','self_deliver','assistance')
      or length(coalesce(p_location,''))>500 then raise exception 'Invalid arrangement' using errcode='22023'; end if;
    if (p_source_type='donation' and p_mode='self_deliver') or (p_source_type='request' and p_mode='self_collect') then
      raise exception 'Invalid transport choice' using errcode='22023';
    end if;
    if (p_mode='assistance' or p_source_type='request') and length(trim(coalesce(p_location,'')))=0 then
      raise exception 'Location required' using errcode='22023';
    end if;
    -- Serialize creation for the source before checking a retried nonce.
    if p_source_type='donation' then perform 1 from public.donations where id=p_source_id for update;
    else perform 1 from public.requests where id=p_source_id for update; end if;
    select * into h from public.item_handoffs where id=p_id;
    if found then
      if h.initiator_id<>who or h.transport_mode<>p_mode
        or coalesce(h.donation_id,h.resource_request_id)<>p_source_id
        or (p_source_type='donation') <> (h.donation_id is not null)
        or (p_source_type='request' and h.pickup_location<>trim(p_location))
        or (p_source_type='donation' and h.delivery_location<>trim(coalesce(p_location,''))) then
        raise exception 'Retry does not match' using errcode='22023';
      end if;
      return h;
    end if;
    if p_source_type='donation' then
      select * into d from public.donations where id=p_source_id for update;
      if not found or d.status<>'available' or d.available_from>now() or d.available_until<now() then
        raise exception 'Item unavailable' using errcode='P0001';
      end if;
      donor:=d.donor_id; recipient:=who; title:=d.item_name; qty:=d.quantity;
      pickup:=d.location; delivery:=trim(coalesce(p_location,''));
    else
      select * into r from public.requests where id=p_source_id and request_type='resource' for update;
      if not found or r.status<>'open' then raise exception 'Request unavailable' using errcode='P0001'; end if;
      donor:=who; recipient:=r.user_id; title:=coalesce(r.item_name,r.category); qty:=coalesce(r.quantity,1);
      pickup:=trim(p_location); delivery:=coalesce(r.location,'');
    end if;
    if donor=recipient then raise exception 'Cannot arrange your own item' using errcode='42501'; end if;
    insert into public.item_handoffs(id,donation_id,resource_request_id,initiator_id,donor_id,recipient_id,
      title,quantity,transport_mode,pickup_location,delivery_location,status)
    values(p_id,d.id,r.id,who,donor,recipient,title,qty,p_mode,pickup,delivery,
      case when p_mode='assistance' then 'waiting_assistant' else 'arranged' end) returning * into h;
    if d.id is not null then update public.donations set status='reserved' where id=d.id;
    else update public.requests set status='assigned' where id=r.id; end if;
    if p_mode='assistance' then h:=private.match_delivery(h.id); end if;
    return h;
end;
$$;

-- Waiting queue exposes only the item description, never participants or addresses.
create function public.waiting_item_deliveries(p_offset integer default 0)
returns table(id uuid,title text,quantity integer,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
    if not exists(select 1 from public.assistants a where a.user_id=auth.uid()
      and a.verification_status='verified' and a.training_status='completed' and a.availability='available') then
      raise exception 'Available verified assistant required' using errcode='42501';
    end if;
    return query select h.id,h.title,h.quantity,h.created_at from public.item_handoffs h
      where h.status='waiting_assistant' and auth.uid() not in (h.donor_id,h.recipient_id)
      order by h.created_at,h.id limit 50 offset greatest(0,least(coalesce(p_offset,0),100000));
end;
$$;

create function public.claim_item_delivery(p_id uuid) returns public.item_handoffs
language plpgsql security definer set search_path='' as $$
declare h public.item_handoffs%rowtype; a public.assistants%rowtype;
begin
    select * into a from public.assistants where user_id=auth.uid()
      and verification_status='verified' and training_status='completed' and availability='available' for update;
    if not found then raise exception 'Not eligible' using errcode='42501'; end if;
    select * into h from public.item_handoffs where id=p_id for update;
    if not found then raise exception 'Delivery unavailable' using errcode='P0001'; end if;
    if h.assistant_id=a.id and h.status='arranged' then return h; end if;
    if h.status<>'waiting_assistant' then raise exception 'Already matched' using errcode='P0001'; end if;
    if auth.uid() in (h.donor_id,h.recipient_id) then raise exception 'Cannot claim own delivery' using errcode='42501'; end if;
    if exists(select 1 from public.assignments where assistant_id=a.id and status in ('assigned','in_progress'))
      or exists(select 1 from public.item_handoffs where assistant_id=a.id and status='arranged') then
      raise exception 'Finish current jobs first' using errcode='P0001';
    end if;
    update public.item_handoffs set assistant_id=a.id,status='arranged',updated_at=now() where id=p_id returning * into h;
    return h;
end;
$$;

create function public.finish_item_handoff(p_id uuid,p_action text) returns public.item_handoffs
language plpgsql security definer set search_path='' as $$
declare h public.item_handoffs%rowtype;
begin
    select * into h from public.item_handoffs where id=p_id for update;
    if not found or auth.uid() is null or auth.uid() not in (h.donor_id,h.recipient_id) then
      raise exception 'Participant required' using errcode='42501';
    end if;
    if p_action is null or p_action not in ('completed','cancelled') then raise exception 'Invalid action' using errcode='22023'; end if;
    if p_action='completed' and auth.uid()<>h.recipient_id then raise exception 'Recipient must confirm receipt' using errcode='42501'; end if;
    if h.status=p_action then return h; end if;
    if h.status in ('completed','cancelled') or (p_action='completed' and h.status<>'arranged') then
      raise exception 'Arrangement changed' using errcode='P0001';
    end if;
    update public.item_handoffs set status=p_action,updated_at=now() where id=p_id returning * into h;
    if h.donation_id is not null then
      update public.donations set status=case when p_action='completed' then 'collected' else 'available' end where id=h.donation_id;
    else
      update public.requests set status=case when p_action='completed' then 'completed' else 'open' end where id=h.resource_request_id;
    end if;
    return h;
end;
$$;

create function public.send_chat_message(p_handoff_id uuid,p_client_id uuid,p_body text)
returns public.chat_messages language plpgsql security definer set search_path='' as $$
declare h public.item_handoffs%rowtype; m public.chat_messages%rowtype; sender text;
begin
    -- Serialize send with cancellation/completion and duplicate retries.
    select * into h from public.item_handoffs where id=p_handoff_id for update;
    if not found or not private.can_read_handoff(p_handoff_id) then raise exception 'Participant required' using errcode='42501'; end if;
    if p_client_id is null or p_body is null or length(trim(p_body)) not between 1 and 2000 then
      raise exception 'Message must be 1 to 2000 characters' using errcode='22023';
    end if;
    select * into m from public.chat_messages where client_id=p_client_id;
    if found then
      if m.sender_id<>auth.uid() or m.handoff_id<>p_handoff_id or m.body<>trim(p_body) then
        raise exception 'Retry mismatch' using errcode='22023';
      end if;
      return m;
    end if;
    if h.status in ('completed','cancelled') then raise exception 'Conversation closed' using errcode='P0001'; end if;
    select coalesce(nullif(trim(concat_ws(' ',first_name,last_name)),''),'Community member') into sender
      from public.profiles where id=auth.uid();
    insert into public.chat_messages(handoff_id,sender_id,sender_name,client_id,body)
      values(p_handoff_id,auth.uid(),sender,p_client_id,trim(p_body)) returning * into m;
    return m;
end;
$$;

-- An owner must cancel the arrangement before editing a reserved donation.
create function private.protect_reserved_donation() returns trigger
language plpgsql set search_path='' as $$
begin
    if current_user in ('authenticated','anon') and exists(select 1 from public.item_handoffs
      where donation_id=old.id and status<>'cancelled') then
      raise exception 'Manage this donation through its arrangement' using errcode='42501';
    end if;
    return new;
end;
$$;
revoke all on function private.protect_reserved_donation() from public,anon,authenticated;
create trigger protect_reserved_donation before update on public.donations
for each row execute function private.protect_reserved_donation();

revoke all on function public.start_item_handoff(uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.waiting_item_deliveries(integer) from public,anon,authenticated;
revoke all on function public.claim_item_delivery(uuid) from public,anon,authenticated;
revoke all on function public.finish_item_handoff(uuid,text) from public,anon,authenticated;
revoke all on function public.send_chat_message(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.start_item_handoff(uuid,text,uuid,text,text) to authenticated;
grant execute on function public.waiting_item_deliveries(integer) to authenticated;
grant execute on function public.claim_item_delivery(uuid) to authenticated;
grant execute on function public.finish_item_handoff(uuid,text) to authenticated;
grant execute on function public.send_chat_message(uuid,uuid,text) to authenticated;
commit;
