jest.mock("@adobe/aio-sdk", () => ({
  Core: {
    Logger: jest.fn(),
  },
}));

const { Core } = require("@adobe/aio-sdk");
const action = require("../../../actions/compose-drop-off-agreement/index.js");

const SECRET = "test-action-secret";
const LEGAL_BODY =
  "<p>This agreement is made between the Client and OTOMOTO TORONTO MOTO INC.</p>";

function validParams(overrides = {}) {
  return {
    LOG_LEVEL: "info",
    ACTION_SECRET: SECRET,
    __ow_headers: { "x-otomoto-action-secret": SECRET },
    work_order_number: "WO-1042",
    signer_name: "Ada Lovelace",
    signed_at: "2026-07-12T15:04:00.000Z",
    template_version: "2026-07-12-legal",
    template_title: "Legal Terms and Conditions",
    body_html: LEGAL_BODY,
    ...overrides,
  };
}

describe("compose-drop-off-agreement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Core.Logger.mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    });
  });

  test("returns 200 with the legal entity and customer-document title", async () => {
    const result = await action.main(
      validParams({ legal_name: "OTOMOTO TORONTO MOTO INC." })
    );

    expect(result.statusCode).toBe(200);
    expect(result.headers["Content-Type"]).toBe("application/json");
    expect(result.body.issuer.legalName).toBe("OTOMOTO TORONTO MOTO INC.");
    expect(result.body.issuer.address).toBe(
      "99 River Street, Toronto, ON M5A 3P4, Canada"
    );
    expect(result.body.issuer.phone).toBe("647-424-1088");
    expect(result.body.customerDocumentTitle).toBe(
      "Drop-off agreement — WO-1042 (2026-07-12)"
    );
    expect(result.body.suggestedPdfFilename).toBe(
      "Drop-off agreement — WO-1042 (2026-07-12).pdf"
    );
    expect(result.body.documentGenerationData.signerName).toBe("Ada Lovelace");
    expect(result.body.pdf).toBeNull();
    expect(result.body.pdfStatus).toBe("merge_data_ready");
  });

  test("returns 400 when required params are missing", async () => {
    const result = await action.main(
      validParams({
        signer_name: " ",
        body_html: undefined,
      })
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error).toContain("Missing required parameters");
    expect(result.body.error).toContain("signer_name");
    expect(result.body.error).toContain("body_html");
  });

  test("returns 400 when the contract names only the trade name", async () => {
    const result = await action.main(
      validParams({
        body_html:
          "<h2>Toronto Moto — Drop-Off Agreement</h2><p>Service at Toronto Moto.</p>",
      })
    );

    expect(result.statusCode).toBe(400);
    expect(result.body.error).toContain("OTOMOTO TORONTO MOTO INC.");
    expect(result.body.error).toContain("trade name");
  });

  test("accepts the legal entity when markup splits the name", async () => {
    const result = await action.main(
      validParams({
        body_html:
          "<p>Otomoto <strong>Toronto</strong>&nbsp;Moto Inc. stores the motorcycle.</p>",
        motorcycle: { year: "2020", make: "Honda", model: "CBR600RR", vin: "" },
      })
    );

    expect(result.statusCode).toBe(200);
    expect(result.body.documentGenerationData.motorcycle).toEqual({
      year: "2020",
      make: "Honda",
      model: "CBR600RR",
    });
  });

  test("returns 400 for script markup, a bad date, a bad work order, and a bad motorcycle", async () => {
    const script = await action.main(
      validParams({
        body_html: "<script>alert(1)</script><p>OTOMOTO TORONTO MOTO INC.</p>",
      })
    );
    expect(script.statusCode).toBe(400);
    expect(script.body.error).toContain("disallowed markup");

    const date = await action.main(validParams({ signed_at: "July 12" }));
    expect(date.statusCode).toBe(400);
    expect(date.body.error).toContain("ISO date");

    const workOrder = await action.main(validParams({ work_order_number: "1042" }));
    expect(workOrder.statusCode).toBe(400);
    expect(workOrder.body.error).toContain("work_order_number");

    const motorcycle = await action.main(validParams({ motorcycle: "Honda" }));
    expect(motorcycle.statusCode).toBe(400);
    expect(motorcycle.body.error).toContain("motorcycle");
  });

  test("returns 400 when the signer or contract body is too long", async () => {
    const signer = await action.main(validParams({ signer_name: "A".repeat(201) }));
    expect(signer.statusCode).toBe(400);
    expect(signer.body.error).toContain("signer_name");

    const body = await action.main(validParams({ body_html: "x".repeat(150001) }));
    expect(body.statusCode).toBe(400);
    expect(body.body.error).toContain("150000");
  });

  test("returns 400 when the caller supplies a different legal name", async () => {
    const result = await action.main(validParams({ legal_name: "Toronto Moto" }));

    expect(result.statusCode).toBe(400);
    expect(result.body.error).toContain("OTOMOTO TORONTO MOTO INC.");
  });

  test("reads document fields from __ow_body and ignores a body secret", async () => {
    const params = validParams();
    const body = {
      work_order_number: params.work_order_number,
      signer_name: params.signer_name,
      signed_at: params.signed_at,
      template_version: params.template_version,
      template_title: params.template_title,
      body_html: params.body_html,
      ACTION_SECRET: "attacker-controlled-secret",
      work_order_number_from_params_should_lose: true,
    };
    delete params.signer_name;

    const result = await action.main({
      ...params,
      __ow_body: JSON.stringify(body),
    });

    expect(result.statusCode).toBe(200);
    expect(result.body.documentGenerationData.signerName).toBe("Ada Lovelace");
  });

  test("returns 401 when the action secret header is missing", async () => {
    const result = await action.main(validParams({ __ow_headers: {} }));

    expect(result.statusCode).toBe(401);
    expect(result.body.error).toBe("Unauthorized");
  });

  test("returns 401 when the action secret does not match", async () => {
    const result = await action.main(
      validParams({
        __ow_headers: { "X-Otomoto-Action-Secret": "xxxx-action-secret" },
      })
    );

    expect(result.statusCode).toBe(401);
    expect(result.body.error).toBe("Unauthorized");
  });

  test("returns 400 when the JSON body is not an object", async () => {
    const listed = await action.main(validParams({ __ow_body: "[1]" }));
    expect(listed.statusCode).toBe(400);
    expect(listed.body.error).toContain("JSON object");

    const broken = await action.main(validParams({ __ow_body: "{" }));
    expect(broken.statusCode).toBe(400);
    expect(broken.body.error).toContain("JSON object");
  });

  test("returns 500 when the action secret is not configured", async () => {
    const result = await action.main(validParams({ ACTION_SECRET: "" }));

    expect(result.statusCode).toBe(500);
    expect(result.body.error).toBe("Action secret is not configured");
  });

  test("returns 500 on unexpected SDK failure", async () => {
    Core.Logger.mockImplementationOnce(() => {
      throw new Error("SDK init failed");
    });

    const result = await action.main(validParams());

    expect(result.statusCode).toBe(500);
    expect(result.body.error).toBe("server error");
  });

  test("does not log the signer name or the action secret", async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    Core.Logger.mockReturnValue(logger);

    await action.main(validParams());

    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain("Ada Lovelace");
    expect(logged).not.toContain(SECRET);
    expect(logged).toContain("WO-1042");
  });
});
