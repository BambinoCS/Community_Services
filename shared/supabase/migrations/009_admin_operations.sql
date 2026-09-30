-- Administrator lists, accurate totals and controlled moderation. Apply after 008.
begin;
create table public.admin_report_reviews (
  report_id uuid primary key references public.reports(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  note text not null check(length(trim(note)) between 1 and 1000),
  reviewed_at timestamptz not null default now()
);
create table public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  record_type text not null check(record_type in ('request','donation','report')),
  record_id uuid not null,
  action text not null,
  note text not null,
  created_at timestamptz not null default now()
);
alter table public.admin_report_reviews enable row level security;
alter table public.admin_actions enable row level security;
revoke all on public.admin_report_reviews,public.admin_actions from anon,authenticated;
grant select on public.admin_report_reviews,public.admin_actions to authenticated;
create policy "Admins read report reviews" on public.admin_report_reviews for select to authenticated using ((select private.is_admin()));
create policy "Admins read moderation audit" on public.admin_actions for select to authenticated using ((select private.is_admin()));

create function public.admin_overview() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  return jsonb_build_object(
    'users',(select count(*) from public.profiles),
    'verified_assistants',(select count(*) from public.assistants where verification_status='verified' and training_status='completed'),
    'pending_assistants',(select count(*) from public.assistants where verification_status='pending'),
    'open_requests',(select count(*) from public.requests where status='open'),
    'active_requests',(select count(*) from public.requests where status in ('assigned','in_progress')),
    'completed_requests',(select count(*) from public.requests where status='completed'),
    'available_donations',(select count(*) from public.donations where status='available' and (available_from is null or available_from<=now()) and (available_until is null or available_until>=now())),
    'reports_to_review',(select count(*) from public.reports r where not exists(select 1 from public.admin_report_reviews v where v.report_id=r.id)),
    'waiting_deliveries',(select count(*) from public.item_handoffs where status='waiting_assistant')
  );
end;
$$;

create function public.admin_list_records(p_kind text,p_offset integer default 0,p_filters jsonb default '{}'::jsonb,p_search text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; start_at integer:=greatest(0,least(coalesce(p_offset,0),100000));
begin
  if not private.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('users','requests','donations','reports') or length(coalesce(p_search,''))>150 then
    raise exception 'Invalid query' using errcode='22023';
  end if;
  if p_kind='users' then
    select coalesce(jsonb_agg(data),'[]') into result from (
      select jsonb_build_object('id',p.id,'first_name',p.first_name,'last_name',p.last_name,'role',p.role,'created_at',p.created_at,'verification_status',a.verification_status,'training_status',a.training_status) as data
      from public.profiles p left join public.assistants a on a.user_id=p.id
      where (coalesce(p_filters->>'role','')='' or p.role=p_filters->>'role')
        and (coalesce(trim(p_search),'')='' or strpos(lower(concat_ws(' ',p.first_name,p.last_name)),lower(trim(p_search)))>0)
      order by p.created_at desc,p.id limit 50 offset start_at
    ) rows;
  elsif p_kind='requests' then
    select coalesce(jsonb_agg(data),'[]') into result from (
      select to_jsonb(r)-'user_id' as data from public.requests r
      where (coalesce(p_filters->>'status','')='' or r.status=p_filters->>'status')
        and (coalesce(p_filters->>'request_type','')='' or r.request_type=p_filters->>'request_type')
        and (coalesce(p_filters->>'urgency','')='' or r.urgency=p_filters->>'urgency')
      order by r.created_at desc,r.id limit 50 offset start_at
    ) rows;
  elsif p_kind='donations' then
    select coalesce(jsonb_agg(data),'[]') into result from (
      select to_jsonb(d)-'donor_id' as data from public.donations d
      where (coalesce(p_filters->>'status','')='' or d.status=p_filters->>'status')
        and (coalesce(p_filters->>'category','')='' or d.category=p_filters->>'category')
      order by d.created_at desc,d.id limit 50 offset start_at
    ) rows;
  else
    select coalesce(jsonb_agg(data),'[]') into result from (
      select (to_jsonb(r)-'user_id') || jsonb_build_object('reviewed_at',v.reviewed_at,'review_note',v.note) as data
      from public.reports r left join public.admin_report_reviews v on v.report_id=r.id
      where (coalesce(p_filters->>'category','')='' or r.category=p_filters->>'category')
        and (coalesce(p_filters->>'review','')='' or (p_filters->>'review'='reviewed' and v.report_id is not null) or (p_filters->>'review'='unreviewed' and v.report_id is null))
      order by r.created_at desc,r.id limit 50 offset start_at
    ) rows;
  end if;
  return result;
end;
$$;

create function public.admin_moderate_record(p_kind text,p_id uuid,p_note text) returns void
language plpgsql security definer set search_path='' as $$
declare current_status text;
begin
  if not private.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('request','donation','report') or p_note is null or length(trim(p_note)) not between 1 and 1000 then
    raise exception 'A review note is required' using errcode='22023';
  end if;
  if p_kind='request' then
    select status into current_status from public.requests where id=p_id for update;
    if not found or current_status<>'open' or exists(select 1 from public.assignments where request_id=p_id)
      or exists(select 1 from public.item_handoffs where resource_request_id=p_id and status<>'cancelled') then
      raise exception 'Only open unassigned requests can be cancelled' using errcode='P0001';
    end if;
    update public.requests set status='cancelled' where id=p_id;
  elsif p_kind='donation' then
    select status into current_status from public.donations where id=p_id for update;
    if not found or current_status<>'available' or exists(select 1 from public.item_handoffs where donation_id=p_id and status<>'cancelled') then
      raise exception 'Only unreserved available donations can be cancelled' using errcode='P0001';
    end if;
    update public.donations set status='cancelled' where id=p_id;
  else
    perform 1 from public.reports where id=p_id for update;
    if not found then raise exception 'Report missing' using errcode='P0001'; end if;
    insert into public.admin_report_reviews(report_id,reviewer_id,note) values(p_id,auth.uid(),trim(p_note))
      on conflict(report_id) do update set reviewer_id=auth.uid(),note=excluded.note,reviewed_at=now();
  end if;
  insert into public.admin_actions(actor_id,record_type,record_id,action,note)
    values(auth.uid(),p_kind,p_id,case when p_kind='report' then 'reviewed' else 'cancelled' end,trim(p_note));
end;
$$;
revoke all on function public.admin_overview() from public,anon,authenticated;
revoke all on function public.admin_list_records(text,integer,jsonb,text) from public,anon,authenticated;
revoke all on function public.admin_moderate_record(text,uuid,text) from public,anon,authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_list_records(text,integer,jsonb,text) to authenticated;
grant execute on function public.admin_moderate_record(text,uuid,text) to authenticated;
commit;
