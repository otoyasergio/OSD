alter table invoice_create_acknowledgement
  add column if not exists hold_revision integer not null default 1;

comment on column invoice_create_acknowledgement.hold_revision is
  'Increments when a failed intake retry stores a new Wix error and clears acknowledged_at. An acknowledge applies only when this still matches the revision staff saw.';
