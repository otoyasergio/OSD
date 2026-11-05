-- Ready-for-pickup customer links use purpose 'pickup'.
-- That page shows auction prices and bike valuation, not shop estimates.

alter table customer_portal_token
  drop constraint if exists customer_portal_token_purpose_check;

alter table customer_portal_token
  add constraint customer_portal_token_purpose_check
  check (purpose in ('full', 'estimate', 'payment', 'inspection', 'contract', 'pickup'));
