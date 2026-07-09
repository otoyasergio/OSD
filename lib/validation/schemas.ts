import { z } from "zod";

export const customerSchema = z
  .object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    phone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable().or(z.literal("")),
    notes: z.string().optional().nullable(),
  })
  .refine((v) => Boolean(v.phone?.trim() || v.email?.trim()), {
    message: "Phone or email is required",
    path: ["phone"],
  });

export const motorcycleSchema = z.object({
  customer_id: z.string().uuid(),
  year: z.number().int().min(1900).max(2100),
  make: z.string().min(1),
  model: z.string().min(1),
  vin: z.string().optional().nullable(),
  colour: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const serviceSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  standard_price: z.number().nonnegative().nullable().optional(),
  estimated_labour: z.number().nonnegative().nullable().optional(),
  active: z.boolean().default(true),
});

export const createWorkOrderSchema = z.object({
  motorcycle_id: z.string().uuid(),
  location_id: z.string().uuid(),
  external_invoice_number: z.string().optional().nullable(),
  mileage: z.number().int().nonnegative().optional().nullable(),
  estimated_completion: z.string().datetime().optional().nullable(),
  internal_notes: z.string().optional().nullable(),
  primary_technician_id: z.string().uuid().optional().nullable(),
  service_ids: z.array(z.string().uuid()).default([]),
});

export const approvalMethodSchema = z.enum([
  "phone",
  "email",
  "text",
  "in_person",
  "written_estimate",
  "other",
]);

export const addJobSchema = z.object({
  service_id: z.string().uuid(),
  require_approval: z.boolean().default(true),
});
