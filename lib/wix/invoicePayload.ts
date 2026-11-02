import type { HeaderField, PreTaxLine } from "@/lib/wix/invoiceRules";
import {
  bikeHeaderFields,
  centsToMoney,
  invoiceTitle,
  moneyToCents,
  preTaxLineItems,
  vinsFromInvoiceText,
} from "@/lib/wix/invoiceRules";

export type WixCustomField = { title?: string; value?: string };

export type WixInvoicePayment = {
  id?: string;
  amount?: string;
  paymentType?: string;
  regularPayment?: {
    paymentMethod?: string;
    paymentProvider?: string;
    paymentStatus?: string;
    offlinePayment?: boolean;
  };
};

export type WixInvoiceRecord = {
  id?: string;
  revision?: string;
  status?: string;
  statusQualifiers?: string[];
  title?: string;
  currency?: string;
  issueDate?: string;
  dueDate?: string;
  sourceReference?: { externalReferenceId?: string };
  numbering?: { number?: number; displayNumber?: string; prefix?: string; suffix?: string };
  customerInfo?: { contactId?: string; contactDetails?: { firstName?: string; lastName?: string } };
  customFields?: {
    headerCustomFields?: WixCustomField[];
    businessCustomFields?: WixCustomField[];
  };
  lineItems?: Array<{
    customItem?: { name?: string; description?: string; price?: string };
    lineItemType?: string;
  }>;
  payments?: WixInvoicePayment[];
  totals?: { total?: string; paidAmount?: string; tax?: string; balance?: string };
  dynamicInvoiceUrl?: string;
};

export type DraftInvoiceInput = {
  contactId: string;
  externalReferenceId?: string | null;
  issueDate: string;
  dueDate?: string | null;
  currency: string;
  title: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  lines: PreTaxLine[];
  creditCents?: number;
  header: HeaderField[];
  technicianName?: string | null;
};

export function buildDraftInvoiceBody(input: DraftInvoiceInput): Record<string, unknown> {
  const lines = preTaxLineItems(input.lines);
  const invoice: Record<string, unknown> = {
    issueDate: input.issueDate,
    currency: input.currency,
    title: input.title,
    reference: {
      referenceType: "STANDALONE",
      standaloneReference: {},
    },
    customerInfo: {
      contactId: input.contactId,
      contactDetails: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
      },
      ...(input.address?.trim()
        ? {
            billingAddress: {
              country: "CA",
              addressLine: input.address.trim().slice(0, 150),
            },
          }
        : {}),
    },
    lineItems: lines.map((line) => ({
      lineItemType: "CUSTOM",
      customItem: {
        name: line.name,
        quantity: String(line.quantity ?? 1),
        price: line.price.toFixed(2),
      },
    })),
    customFields: {
      headerCustomFields: input.header,
      businessCustomFields: input.technicianName?.trim()
        ? [{ title: "Technician", value: input.technicianName.trim().slice(0, 100) }]
        : [],
    },
  };

  if (input.dueDate) invoice.dueDate = input.dueDate;
  if (input.externalReferenceId) {
    invoice.sourceReference = { externalReferenceId: input.externalReferenceId };
  }
  if (input.creditCents && input.creditCents > 0) {
    invoice.discounts = [
      {
        name: "Customer credit",
        discountType: "FIXED",
        fixedDiscount: centsToMoney(input.creditCents),
      },
    ];
  }
  return { invoice };
}

export function buildLineUpdate(input: {
  revision: string;
  lines: PreTaxLine[];
  header: HeaderField[];
  title: string;
  technicianName?: string | null;
  dueDate?: string | null;
  creditCents?: number;
}): Record<string, unknown> {
  const lines = preTaxLineItems(input.lines);
  const invoice: Record<string, unknown> = {
    revision: input.revision,
    title: input.title,
    lineItems: lines.map((line) => ({
      lineItemType: "CUSTOM",
      customItem: {
        name: line.name,
        quantity: String(line.quantity ?? 1),
        price: line.price.toFixed(2),
      },
    })),
    customFields: {
      headerCustomFields: input.header,
      businessCustomFields: input.technicianName?.trim()
        ? [{ title: "Technician", value: input.technicianName.trim().slice(0, 100) }]
        : [],
    },
  };
  if (input.dueDate) invoice.dueDate = input.dueDate;
  if (input.creditCents && input.creditCents > 0) {
    invoice.discounts = [
      {
        name: "Customer credit",
        discountType: "FIXED",
        fixedDiscount: centsToMoney(input.creditCents),
      },
    ];
  }
  return { invoice };
}

export function invoiceTextBlob(invoice: WixInvoiceRecord): string {
  const header = (invoice.customFields?.headerCustomFields ?? [])
    .map((field) => `${field.title ?? ""} ${field.value ?? ""}`)
    .join(" ");
  const lines = (invoice.lineItems ?? [])
    .map((line) => `${line.customItem?.name ?? ""} ${line.customItem?.description ?? ""}`)
    .join(" ");
  return [invoice.title, header, lines].filter(Boolean).join("\n");
}

export function vinsOnInvoice(invoice: WixInvoiceRecord, modelYear: number | null = null): string[] {
  return vinsFromInvoiceText(invoiceTextBlob(invoice), modelYear);
}

export function headerValue(invoice: WixInvoiceRecord, title: string): string | null {
  const field = (invoice.customFields?.headerCustomFields ?? []).find(
    (item) => (item.title ?? "").trim().toLowerCase() === title.toLowerCase()
  );
  const value = field?.value?.trim();
  return value || null;
}

export function paymentMethod(payment: WixInvoicePayment): string {
  return (
    payment.regularPayment?.paymentMethod ||
    payment.regularPayment?.paymentProvider ||
    payment.paymentType ||
    "unknown"
  );
}

export function paymentCents(payment: WixInvoicePayment): number {
  return moneyToCents(payment.amount);
}

export function totalsCents(invoice: WixInvoiceRecord): { total: number; paid: number } {
  return {
    total: moneyToCents(invoice.totals?.total),
    paid: moneyToCents(invoice.totals?.paidAmount),
  };
}

export function payUrlFromInvoice(invoice: WixInvoiceRecord): string | null {
  const url = invoice.dynamicInvoiceUrl?.trim();
  if (url && /^https:\/\//i.test(url)) return url;
  return null;
}

export function draftHasDisplayNumber(invoice: WixInvoiceRecord): boolean {
  return Boolean(invoice.numbering?.displayNumber?.trim());
}

export { bikeHeaderFields, invoiceTitle };
