import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { canAdminHelpCreateRecords } from "@/lib/permissions";
import { customerSchema } from "@/lib/validation/schemas";

export type CustomerAccountType = "retail" | "fleet" | "commercial";

export type Customer = {
  customer_id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  account_type: CustomerAccountType;
  created_at: string;
  updated_at: string;
};

export type CustomerInput = {
  first_name: string;
  last_name: string;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  account_type?: CustomerAccountType;
};

export const CUSTOMER_ACCOUNT_TYPE_LABELS: Record<CustomerAccountType, string> =
  {
    retail: "Retail",
    fleet: "Fleet",
    commercial: "Commercial",
  };

const CUSTOMER_COLUMNS =
  "customer_id, first_name, last_name, phone, email, notes, account_type, created_at, updated_at";

/**
 * PostgREST `or()` uses commas and parentheses as syntax, so those characters are
 * removed rather than escaped. Wildcards are escaped so a literal `%` stays literal.
 */
export function escapeSearchTerm(term: string): string {
  return term
    .trim()
    .replace(/[,()]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/[%_]/g, (char) => `\\${char}`);
}

export function buildCustomerSearchOrFilter(term: string): string {
  const pattern = `%${escapeSearchTerm(term)}%`;
  return [
    `first_name.ilike.${pattern}`,
    `last_name.ilike.${pattern}`,
    `phone.ilike.${pattern}`,
    `email.ilike.${pattern}`,
  ].join(",");
}

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function countCustomers(): Promise<number> {
  await requireUser();
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("customer")
    .select("customer_id", { count: "exact", head: true });

  if (error) throw error;
  return count ?? 0;
}

export async function searchCustomers(
  term: string,
  options?: { account_type?: CustomerAccountType }
): Promise<Customer[]> {
  await requireUser();
  const supabase = await createClient();

  let query = supabase.from("customer").select(CUSTOMER_COLUMNS);
  const cleaned = escapeSearchTerm(term);
  if (cleaned) {
    query = query.or(buildCustomerSearchOrFilter(term));
  }
  if (options?.account_type) {
    query = query.eq("account_type", options.account_type);
  }

  const { data, error } = await query
    .order("last_name")
    .order("first_name")
    .limit(50);

  if (error) throw error;
  return (data ?? []) as Customer[];
}

export async function getCustomerById(
  customerId: string
): Promise<Customer | null> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("customer")
    .select(CUSTOMER_COLUMNS)
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error) throw error;
  return (data as Customer) ?? null;
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const user = await requireUser();
  if (!canAdminHelpCreateRecords(user.role)) throw new Error("FORBIDDEN");

  const parsed = customerSchema.parse({
    ...input,
    phone: normalizeOptional(input.phone),
    email: normalizeOptional(input.email),
    notes: normalizeOptional(input.notes),
  });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer")
    .insert({
      first_name: parsed.first_name,
      last_name: parsed.last_name,
      phone: normalizeOptional(parsed.phone),
      email: normalizeOptional(parsed.email),
      notes: normalizeOptional(parsed.notes),
      account_type: parsed.account_type,
    })
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error) throw error;
  const customer = data as Customer;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "customer_created",
    entity_type: "customer",
    entity_id: customer.customer_id,
    description: `Customer ${customer.first_name} ${customer.last_name} created`,
    new_value: customer,
  });

  return customer;
}

export async function updateCustomer(
  customerId: string,
  input: CustomerInput
): Promise<Customer> {
  const user = await requireUser();
  if (!canAdminHelpCreateRecords(user.role)) throw new Error("FORBIDDEN");

  const parsed = customerSchema.parse({
    ...input,
    phone: normalizeOptional(input.phone),
    email: normalizeOptional(input.email),
    notes: normalizeOptional(input.notes),
  });

  const supabase = await createClient();
  const previous = await getCustomerById(customerId);
  if (!previous) throw new Error("CUSTOMER_NOT_FOUND");

  const { data, error } = await supabase
    .from("customer")
    .update({
      first_name: parsed.first_name,
      last_name: parsed.last_name,
      phone: normalizeOptional(parsed.phone),
      email: normalizeOptional(parsed.email),
      notes: normalizeOptional(parsed.notes),
      account_type: parsed.account_type,
      updated_at: new Date().toISOString(),
    })
    .eq("customer_id", customerId)
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error) throw error;
  const customer = data as Customer;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "customer_updated",
    entity_type: "customer",
    entity_id: customerId,
    description: `Customer ${customer.first_name} ${customer.last_name} updated`,
    old_value: previous,
    new_value: customer,
  });

  return customer;
}
