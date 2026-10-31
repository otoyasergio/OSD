import { z } from "zod";

const publicText = z.string().trim().min(1).max(500);
const publicShortText = z.string().trim().min(1).max(120);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const passportMileageSchema = z
  .object({
    value: z.number().finite().nonnegative(),
    unit: z.enum(["km", "mi"]),
  })
  .strict();

const passportPartSchema = z
  .object({
    description: publicShortText,
    part_number: publicShortText.nullable(),
    quantity: z.number().finite().positive(),
  })
  .strict();

const passportServiceEntrySchema = z
  .object({
    service_date: isoDate,
    work_order_reference: publicShortText,
    mileage: passportMileageSchema.nullable(),
    location: publicShortText,
    source_label: z.literal("OTOMOTO performed"),
    completed_services: z.array(publicText).min(1).max(100),
    installed_parts: z.array(passportPartSchema).max(250),
  })
  .strict();

export const passportSnapshotSchema = z
  .object({
    schema_version: z.literal(1),
    passport_number: z.string().regex(/^OTO-[A-Z0-9]{8}$/),
    report_version: z.number().int().positive(),
    issued_at: z.string().datetime(),
    coverage_through: z.string().datetime(),
    issuer: z
      .object({
        legal_name: publicShortText,
        address: publicText,
        phone: publicShortText,
      })
      .strict(),
    vehicle: z
      .object({
        year: z.number().int().min(1885).max(2200),
        make: publicShortText,
        model: publicShortText,
        vin: publicShortText.nullable(),
        colour: publicShortText.nullable(),
      })
      .strict(),
    service_entries: z.array(passportServiceEntrySchema).min(1).max(500),
    limitations: z.array(publicText).min(1).max(20),
  })
  .strict();

export type PassportSnapshotPayload = z.infer<typeof passportSnapshotSchema>;
