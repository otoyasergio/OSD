const crypto = require("node:crypto");
const { Core } = require("@adobe/aio-sdk");
const { composeDropOffAgreement } = require("./compose");

const MIN_SECRET_LENGTH = 16;

function header(params, name) {
  const headers = params.__ow_headers || {};
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function secretsMatch(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  if (providedBytes.length === 0 || providedBytes.length !== expectedBytes.length)
    return false;
  return crypto.timingSafeEqual(providedBytes, expectedBytes);
}

function requestFields(params) {
  if (typeof params.__ow_body !== "string" || params.__ow_body.length === 0) {
    return { fields: params };
  }
  try {
    const parsed = JSON.parse(params.__ow_body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "Request body must be a JSON object." };
    }
    return { fields: parsed };
  } catch {
    return { error: "Request body must be a JSON object." };
  }
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body,
  };
}

async function main(params) {
  let logger;
  try {
    logger = Core.Logger("compose-drop-off-agreement", {
      level: params.LOG_LEVEL || "info",
    });

    const configured = params.ACTION_SECRET;
    if (typeof configured !== "string" || configured.length < MIN_SECRET_LENGTH) {
      logger.error("ACTION_SECRET is not configured");
      return jsonResponse(500, { error: "Action secret is not configured" });
    }

    const provided = header(params, "x-otomoto-action-secret");
    if (!secretsMatch(provided, configured)) {
      logger.info("Rejected request: missing or invalid action secret");
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const request = requestFields(params);
    if (request.error) {
      logger.info("Rejected request: malformed JSON body");
      return jsonResponse(400, { error: request.error });
    }

    const workOrderNumber = request.fields.work_order_number;
    logger.info("Composing drop-off agreement packet", {
      workOrderNumber: typeof workOrderNumber === "string" ? workOrderNumber : undefined,
      templateVersion:
        typeof request.fields.template_version === "string"
          ? request.fields.template_version
          : undefined,
    });

    const result = composeDropOffAgreement(request.fields);
    if (result.statusCode !== 200) {
      logger.info("Rejected agreement packet", { statusCode: result.statusCode });
    }
    return jsonResponse(result.statusCode, result.body);
  } catch (error) {
    if (logger) logger.error(error);
    return jsonResponse(500, { error: "server error" });
  }
}

exports.main = main;
