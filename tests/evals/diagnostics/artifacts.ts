import type OpenAI from "openai";
import {
  DiagnosticsOutputPolicyError,
  type DiagnosticsPolicyViolation,
} from "@/lib/diagnostics/outputPolicy";

export type DiagnosticsEvalUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type DiagnosticsEvalProviderCapture = {
  responseId: string | null;
  resolvedModel: string | null;
  usage: DiagnosticsEvalUsage | null;
  outputParsed: unknown | null;
};

export function createDiagnosticsEvalProviderCapture(): DiagnosticsEvalProviderCapture {
  return {
    responseId: null,
    resolvedModel: null,
    usage: null,
    outputParsed: null,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nullableTokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function captureParseResult(capture: DiagnosticsEvalProviderCapture, raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const response = raw as Record<string, unknown>;
  const usage =
    response.usage && typeof response.usage === "object"
      ? (response.usage as Record<string, unknown>)
      : null;

  capture.responseId = nullableString(response.id);
  capture.resolvedModel = nullableString(response.model);
  capture.usage = usage
    ? {
        inputTokens: nullableTokenCount(usage.input_tokens),
        outputTokens: nullableTokenCount(usage.output_tokens),
        totalTokens: nullableTokenCount(usage.total_tokens),
      }
    : null;
  capture.outputParsed = response.output_parsed ?? null;
}

/**
 * Eval-only client wrapper. It returns the original parse result unchanged and
 * retains only the allow-listed response fields needed for synthetic review.
 */
export function wrapDiagnosticsEvalClient(
  client: OpenAI,
  capture: DiagnosticsEvalProviderCapture
): OpenAI {
  const parse = client.responses.parse.bind(client.responses) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const responses = new Proxy(client.responses, {
    get(target, property, receiver) {
      if (property !== "parse") return Reflect.get(target, property, receiver);
      return async (...args: unknown[]) => {
        const raw = await parse(...args);
        captureParseResult(capture, raw);
        return raw;
      };
    },
  });

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === "responses") return responses;
      return Reflect.get(target, property, receiver);
    },
  });
}

export type DiagnosticsEvalFailureMetadata = {
  requestedModel: string;
  resolvedModel: string | null;
  promptVersion: string;
  responseId: string | null;
  contextHash: string;
  usage: DiagnosticsEvalUsage | null;
  response: unknown | null;
  error: string;
  policyViolations: DiagnosticsPolicyViolation[];
};

export function buildDiagnosticsEvalFailureMetadata(input: {
  capture: DiagnosticsEvalProviderCapture;
  requestedModel: string;
  promptVersion: string;
  contextHash: string;
  error: unknown;
}): DiagnosticsEvalFailureMetadata {
  return {
    requestedModel: input.requestedModel,
    resolvedModel: input.capture.resolvedModel,
    promptVersion: input.promptVersion,
    responseId: input.capture.responseId,
    contextHash: input.contextHash,
    usage: input.capture.usage,
    response: input.capture.outputParsed,
    error: input.error instanceof Error ? input.error.message : String(input.error),
    policyViolations:
      input.error instanceof DiagnosticsOutputPolicyError
        ? input.error.violations.map(({ code, message }) => ({ code, message }))
        : [],
  };
}
