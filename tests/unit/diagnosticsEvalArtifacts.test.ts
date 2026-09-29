import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { DiagnosticsOutputPolicyError } from "@/lib/diagnostics/outputPolicy";
import {
  buildDiagnosticsEvalFailureMetadata,
  createDiagnosticsEvalProviderCapture,
  wrapDiagnosticsEvalClient,
} from "@/tests/evals/diagnostics/artifacts";

describe("diagnostics live-eval failure artifacts", () => {
  it("captures only allow-listed raw parse result fields", async () => {
    const parsedSyntheticResponse = {
      answer: "Fictional synthetic response",
      next_step: "Perform one fictional check.",
    };
    const rawResponse = {
      id: "resp_synthetic_123",
      model: "gpt-resolved-synthetic",
      usage: {
        input_tokens: 101,
        output_tokens: 202,
        total_tokens: 303,
      },
      output_parsed: parsedSyntheticResponse,
      request_headers: { authorization: "Bearer secret-must-not-be-recorded" },
      api_key: "secret-must-not-be-recorded",
    };
    const parse = vi.fn().mockResolvedValue(rawResponse);
    const client = { responses: { parse } } as unknown as OpenAI;
    const capture = createDiagnosticsEvalProviderCapture();
    const wrapped = wrapDiagnosticsEvalClient(client, capture);

    const returned = await (
      wrapped.responses.parse as unknown as () => Promise<unknown>
    )();

    expect(returned).toBe(rawResponse);
    expect(capture).toEqual({
      responseId: "resp_synthetic_123",
      resolvedModel: "gpt-resolved-synthetic",
      usage: {
        inputTokens: 101,
        outputTokens: 202,
        totalTokens: 303,
      },
      outputParsed: parsedSyntheticResponse,
    });
    expect(JSON.stringify(capture)).not.toMatch(
      /authorization|secret-must-not-be-recorded|request_headers|api_key/i
    );
  });

  it("retains captured response metadata and policy violations on failure", () => {
    const capture = createDiagnosticsEvalProviderCapture();
    capture.responseId = "resp_policy_failure";
    capture.resolvedModel = "gpt-resolved-synthetic";
    capture.usage = {
      inputTokens: 11,
      outputTokens: 22,
      totalTokens: 33,
    };
    capture.outputParsed = {
      answer: "Synthetic output withheld by policy.",
    };
    const error = new DiagnosticsOutputPolicyError([
      {
        code: "ROADWORTHINESS_CLAIM",
        message: "The draft makes an unsupported roadworthiness claim.",
      },
    ]);

    expect(
      buildDiagnosticsEvalFailureMetadata({
        capture,
        requestedModel: "gpt-requested-alias",
        promptVersion: "diagnostics-v-test",
        contextHash: "a".repeat(64),
        error,
      })
    ).toEqual({
      requestedModel: "gpt-requested-alias",
      resolvedModel: "gpt-resolved-synthetic",
      promptVersion: "diagnostics-v-test",
      responseId: "resp_policy_failure",
      contextHash: "a".repeat(64),
      usage: {
        inputTokens: 11,
        outputTokens: 22,
        totalTokens: 33,
      },
      response: {
        answer: "Synthetic output withheld by policy.",
      },
      error: "DIAGNOSTICS_AI_OUTPUT_WITHHELD",
      policyViolations: [
        {
          code: "ROADWORTHINESS_CLAIM",
          message: "The draft makes an unsupported roadworthiness claim.",
        },
      ],
    });
  });

  it("uses nulls when a provider failure has no raw response", () => {
    const metadata = buildDiagnosticsEvalFailureMetadata({
      capture: createDiagnosticsEvalProviderCapture(),
      requestedModel: "gpt-requested-alias",
      promptVersion: "diagnostics-v-test",
      contextHash: "b".repeat(64),
      error: new Error("DIAGNOSTICS_AI_PROVIDER_UNAVAILABLE"),
    });

    expect(metadata).toMatchObject({
      requestedModel: "gpt-requested-alias",
      resolvedModel: null,
      responseId: null,
      contextHash: "b".repeat(64),
      usage: null,
      response: null,
      error: "DIAGNOSTICS_AI_PROVIDER_UNAVAILABLE",
      policyViolations: [],
    });
  });
});
