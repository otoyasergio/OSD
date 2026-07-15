alter table if exists public.motorcycle
add column if not exists plate_number text;

comment on column public.motorcycle.plate_number is
  'Optional licence plate number, normalized to uppercase by the application.';
