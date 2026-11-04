/**
 * Shop facts the location table cannot store. Keep these aligned with
 * lib/shop/toronto.ts. The regulatory address includes the country.
 */
const SHOP = {
  legalName: "OTOMOTO TORONTO MOTO INC.",
  address: "99 River Street, Toronto, ON M5A 3P4, Canada",
  phone: "647-424-1088",
  hours: "Mon–Fri 12:00–19:00, Sat 10:00–16:00, Sun closed",
};

const LEGAL_ENTITY_PATTERN = /otomoto\s+toronto\s+moto\s+inc\.?/i;
const MAX_BODY_CHARS = 150000;
const REQUIRED_FIELDS = [
  "work_order_number",
  "signer_name",
  "signed_at",
  "template_version",
  "template_title",
  "body_html",
];

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ");
}

function normalizeMotorcycle(value) {
  if (value == null || value === "") return { motorcycle: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "motorcycle must be an object." };
  }

  const motorcycle = {};
  for (const key of ["year", "make", "model", "vin"]) {
    if (value[key] == null || value[key] === "") continue;
    if (typeof value[key] !== "string" || value[key].trim().length > 80) {
      return { error: `motorcycle.${key} is invalid.` };
    }
    motorcycle[key] = value[key].trim();
  }
  return { motorcycle };
}

function composeDropOffAgreement(input) {
  const missing = REQUIRED_FIELDS.filter((key) => {
    const value = input[key];
    return typeof value !== "string" || value.trim() === "";
  });
  if (missing.length > 0) {
    return {
      statusCode: 400,
      body: { error: `Missing required parameters: ${missing.join(", ")}` },
    };
  }

  if (input.legal_name != null && String(input.legal_name).trim() !== "") {
    if (input.legal_name !== SHOP.legalName) {
      return {
        statusCode: 400,
        body: {
          error: `Contracts must use the legal entity ${SHOP.legalName}.`,
        },
      };
    }
  }

  const bodyHtml = input.body_html;
  if (bodyHtml.length > MAX_BODY_CHARS) {
    return {
      statusCode: 400,
      body: { error: "body_html exceeds the 150000 character limit." },
    };
  }
  if (/<script/i.test(bodyHtml) || /javascript:/i.test(bodyHtml)) {
    return {
      statusCode: 400,
      body: { error: "body_html contains disallowed markup." },
    };
  }
  if (!LEGAL_ENTITY_PATTERN.test(visibleText(bodyHtml))) {
    return {
      statusCode: 400,
      body: {
        error: `Contract body must name ${SHOP.legalName}. The trade name alone is not the contracting party.`,
      },
    };
  }

  const signedAt = input.signed_at.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(signedAt) ||
    Number.isNaN(Date.parse(signedAt))
  ) {
    return { statusCode: 400, body: { error: "signed_at must be an ISO date." } };
  }

  const workOrderNumber = input.work_order_number.trim();
  if (!/^WO-[A-Za-z0-9-]{1,40}$/.test(workOrderNumber)) {
    return { statusCode: 400, body: { error: "work_order_number is invalid." } };
  }

  const signerName = input.signer_name.trim();
  if (signerName.length > 200) {
    return { statusCode: 400, body: { error: "signer_name is too long." } };
  }

  const motorcycleResult = normalizeMotorcycle(input.motorcycle);
  if (motorcycleResult.error) {
    return { statusCode: 400, body: { error: motorcycleResult.error } };
  }

  const date = signedAt.slice(0, 10);
  const customerDocumentTitle = `Drop-off agreement — ${workOrderNumber} (${date})`;
  const issuer = {
    legalName: SHOP.legalName,
    address: SHOP.address,
    phone: SHOP.phone,
    hours: SHOP.hours,
  };

  return {
    statusCode: 200,
    body: {
      customerDocumentTitle,
      suggestedPdfFilename: `${customerDocumentTitle}.pdf`,
      issuer,
      documentGenerationData: {
        issuer,
        workOrderNumber,
        signerName,
        signedAt,
        templateVersion: input.template_version.trim(),
        templateTitle: input.template_title.trim(),
        motorcycle: motorcycleResult.motorcycle,
        bodyHtml,
      },
      pdf: null,
      pdfStatus: "merge_data_ready",
    },
  };
}

module.exports = {
  SHOP,
  composeDropOffAgreement,
};
