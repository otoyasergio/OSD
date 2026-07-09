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

export const inspectionTemplateItemSchema = z.object({
  category: z.string().min(1, "Category is required"),
  item_name: z.string().min(1, "Item name is required"),
  display_order: z.number().int(),
  requires_measurement: z.boolean().default(false),
  active: z.boolean().default(true),
});

export const saveInspectionResultSchema = z.object({
  status: z
    .enum(["ok", "future_attention", "immediate_attention"])
    .nullable()
    .optional(),
  measurement: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const recommendationSchema = z.object({
  description: z.string().min(1, "Description is required"),
  severity: z.enum([
    "future_attention",
    "immediate_attention",
    "safety_critical",
  ]),
  notes: z.string().nullable().optional(),
  inspection_result_id: z.string().uuid().nullable().optional(),
});

export const partSchema = z.object({
  part_name: z.string().min(1, "Part name is required"),
  part_number: z.string().nullable().optional(),
  supplier: z.string().nullable().optional(),
  quantity: z.number().positive().default(1),
  notes: z.string().nullable().optional(),
});

export const partStatusSchema = z.enum([
  "needed",
  "in_stock",
  "ordered",
  "installed",
  "not_required",
  "cancelled",
]);

export const photoCategorySchema = z.enum([
  "front",
  "rear",
  "left_side",
  "right_side",
  "odometer",
  "vin",
  "damage",
  "accessories",
  "fuel_level",
  "other",
]);

export const intakePhotoSchema = z.object({
  category: photoCategorySchema,
  notes: z.string().nullable().optional(),
});

export const technicianNoteTypeSchema = z.enum([
  "general",
  "diagnostic_finding",
  "customer_concern_confirmed",
  "customer_concern_not_found",
  "parts_issue",
  "road_test",
  "quality_check",
  "internal_warning",
]);

export const technicianNoteSchema = z.object({
  note: z.string().min(1, "Note is required"),
  note_type: technicianNoteTypeSchema.default("general"),
  job_id: z.string().uuid().nullable().optional(),
});
