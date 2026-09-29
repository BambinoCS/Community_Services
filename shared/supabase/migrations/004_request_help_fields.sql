-- Community Service Delivery Platform
-- 004_request_help_fields.sql
-- Adds structured optional fields required by the Request Help workflows.

alter table public.requests
  add column if not exists item_name text,
  add column if not exists quantity integer,
  add column if not exists problems_addressed text[];

alter table public.requests
  drop constraint if exists requests_quantity_positive_chk;
alter table public.requests
  add constraint requests_quantity_positive_chk
  check (quantity is null or quantity >= 1);

alter table public.reports
  add column if not exists urgency text,
  add column if not exists additional_info text;

create index if not exists requests_item_name_idx on public.requests(item_name);
create index if not exists reports_urgency_idx on public.reports(urgency);
