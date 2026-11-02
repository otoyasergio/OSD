-- Wix invoice ledger. Square records money only.
-- Front office may read. Writes go through the service role.
-- Licence number and expiry stay on customer_private_profile and are never
-- synced to Wix or used in a promotion send.

alter table work_order
  add column if not exists invoice_number_int bigint
  generated always as (
    case
      when work_order_number ~ '^[0-9]{1,12}$' then work_order_number::bigint
      else null
    end
  ) stored;

create index if not exists work_order_invoice_number_int_idx
  on work_order (invoice_number_int)
  where invoice_number_int is not null;

create table if not exists wix_invoice (
  wix_invoice_id text primary key,
  revision text not null default '1',
  display_number text not null,
  invoice_number integer not null,
  status text not null,
  status_qualifiers text[] not null default '{}',
  total_cents integer not null default 0,
  paid_cents integer not null default 0,
  currency text not null default 'CAD',
  issue_date timestamptz,
  due_date timestamptz,
  customer_id uuid references customer (customer_id) on delete set null,
  motorcycle_id uuid references motorcycle (motorcycle_id) on delete set null,
  vin_snapshot text,
  work_order_id uuid references work_order (work_order_id) on delete set null,
  pending_work_order_id uuid,
  voided boolean not null default false,
  title text,
  contact_id text,
  pay_url text,
  exclude_from_square boolean not null default false,
  credit_applied_cents integer not null default 0,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wix_invoice_display_number_unique unique (display_number)
);

create index if not exists wix_invoice_customer_idx on wix_invoice (customer_id);
create index if not exists wix_invoice_motorcycle_idx on wix_invoice (motorcycle_id);
create index if not exists wix_invoice_work_order_idx on wix_invoice (work_order_id);
create index if not exists wix_invoice_vin_idx on wix_invoice (vin_snapshot);
create index if not exists wix_invoice_number_idx on wix_invoice (invoice_number);
create unique index if not exists wix_invoice_pending_work_order_idx
  on wix_invoice (pending_work_order_id)
  where pending_work_order_id is not null;

create table if not exists wix_invoice_payment (
  wix_invoice_payment_id uuid primary key default gen_random_uuid(),
  wix_payment_id text not null,
  wix_invoice_id text not null references wix_invoice (wix_invoice_id) on delete cascade,
  amount_cents integer not null,
  method text not null,
  kind text not null default 'payment' check (kind in ('payment', 'refund')),
  square_status text not null default 'unasked'
    check (square_status in ('unasked', 'not_yet', 'squared', 'skipped_void')),
  square_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wix_invoice_payment_wix_id_unique unique (wix_payment_id)
);

create unique index if not exists wix_invoice_payment_square_id_unique
  on wix_invoice_payment (square_payment_id)
  where square_payment_id is not null;

create index if not exists wix_invoice_payment_unasked_idx
  on wix_invoice_payment (square_status)
  where square_status in ('unasked', 'not_yet');

create table if not exists invoice_create_acknowledgement (
  acknowledgement_id uuid primary key default gen_random_uuid(),
  work_order_id uuid references work_order (work_order_id) on delete cascade,
  customer_id uuid not null references customer (customer_id) on delete cascade,
  motorcycle_id uuid not null references motorcycle (motorcycle_id) on delete cascade,
  staff_user_id uuid not null references app_user (user_id),
  wix_error_text text not null,
  wix_invoice_id text,
  pending_work_order_id uuid,
  acknowledged_at timestamptz,
  cleared_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists invoice_ack_open_customer_idx
  on invoice_create_acknowledgement (customer_id, motorcycle_id)
  where cleared_at is null;

create index if not exists invoice_ack_open_work_order_idx
  on invoice_create_acknowledgement (work_order_id)
  where cleared_at is null and acknowledged_at is null;

create table if not exists customer_private_profile (
  customer_id uuid primary key references customer (customer_id) on delete cascade,
  licence_number text,
  licence_expiry date,
  scanned_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table wix_invoice enable row level security;
alter table wix_invoice_payment enable row level security;
alter table invoice_create_acknowledgement enable row level security;
alter table customer_private_profile enable row level security;

drop policy if exists wix_invoice_select on wix_invoice;
create policy wix_invoice_select on wix_invoice
  for select to authenticated
  using (
    is_active_app_user()
    and current_app_user_role() in ('owner', 'manager', 'service_advisor', 'admin')
  );

drop policy if exists wix_invoice_payment_select on wix_invoice_payment;
create policy wix_invoice_payment_select on wix_invoice_payment
  for select to authenticated
  using (
    is_active_app_user()
    and current_app_user_role() in ('owner', 'manager', 'service_advisor', 'admin')
  );

drop policy if exists invoice_create_acknowledgement_select on invoice_create_acknowledgement;
create policy invoice_create_acknowledgement_select on invoice_create_acknowledgement
  for select to authenticated
  using (
    is_active_app_user()
    and current_app_user_role() in ('owner', 'manager', 'service_advisor', 'admin')
  );

drop policy if exists customer_private_profile_select on customer_private_profile;
create policy customer_private_profile_select on customer_private_profile
  for select to authenticated
  using (
    is_active_app_user()
    and current_app_user_role() in ('owner', 'manager', 'service_advisor', 'admin')
  );

-- No insert/update/delete policies. Service role bypasses RLS.
