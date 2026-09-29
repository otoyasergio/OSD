import { afterAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import {
  hashDiagnosticsContext,
  shapeDiagnosticsContext,
  type ShapedDiagnosticsContext,
} from "@/lib/diagnostics/context";
import { getDiagnosticsConfig } from "@/lib/diagnostics/config";
import {
  DIAGNOSTICS_PROVIDER_MAX_RETRIES,
  generateDiagnosticsDraft,
} from "@/lib/diagnostics/openai";
import type { DiagnosticsPolicyViolation } from "@/lib/diagnostics/outputPolicy";
import { DIAGNOSTICS_PROMPT_VERSION } from "@/lib/diagnostics/prompts";
import {
  buildDiagnosticsEvalFailureMetadata,
  createDiagnosticsEvalProviderCapture,
  wrapDiagnosticsEvalClient,
} from "@/tests/evals/diagnostics/artifacts";
import {
  screenDiagnosticsEvalResponse,
  type DiagnosticsEvalInvariantResult,
} from "@/tests/evals/diagnostics/invariants";
import {
  DIAGNOSTICS_EVAL_SCENARIOS,
  type DiagnosticsEvalScenario,
} from "@/tests/evals/diagnostics/scenarios";

type EvalResult = {
  scenarioId: string;
  title: string;
  status: "passed" | "invariant_failed" | "generation_failed";
  requestedModel: string;
  resolvedModel: string | null;
  evaluatedAt: string;
  promptVersion: string;
  responseId: string | null;
  contextHash: string;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } | null;
  invariants: DiagnosticsEvalInvariantResult[];
  response: unknown | null;
  policyViolations: DiagnosticsPolicyViolation[];
  error?: string;
};

const results: EvalResult[] = [];
const config = getDiagnosticsConfig();
const runStartedAt = new Date().toISOString();
const realClient = new OpenAI({
  apiKey: config.apiKey,
  maxRetries: DIAGNOSTICS_PROVIDER_MAX_RETRIES,
  timeout: config.timeoutMs,
});

function shapeScenario(scenario: DiagnosticsEvalScenario): ShapedDiagnosticsContext {
  return shapeDiagnosticsContext(scenario.context, {
    mode: scenario.mode,
    workOrderId: scenario.context.workOrder.workOrderId,
    jobId: scenario.context.jobs[0]?.jobId ?? null,
    serverNowIso: "2026-09-29T08:00:00.000Z",
  });
}

describe.sequential("Ask OTOMOTO live-model acceptance", () => {
  for (const scenario of DIAGNOSTICS_EVAL_SCENARIOS) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const evaluatedAt = new Date().toISOString();
      const shaped = shapeScenario(scenario);
      const contextHash = hashDiagnosticsContext(shaped.context);
      const providerCapture = createDiagnosticsEvalProviderCapture();
      const client = wrapDiagnosticsEvalClient(realClient, providerCapture);
      let generated: Awaited<ReturnType<typeof generateDiagnosticsDraft>>;
      try {
        generated = await generateDiagnosticsDraft(
          {
            mode: scenario.mode,
            requiredPhase: scenario.requiredPhase,
            staffUserId: `fictional-eval-${scenario.id}`,
            workOrderContext: shaped.context,
            userMessage: scenario.userMessage,
          },
          { config, client }
        );
      } catch (error) {
        const failure = buildDiagnosticsEvalFailureMetadata({
          capture: providerCapture,
          requestedModel: config.model,
          promptVersion: DIAGNOSTICS_PROMPT_VERSION,
          contextHash,
          error,
        });
        results.push({
          scenarioId: scenario.id,
          title: scenario.title,
          status: "generation_failed",
          evaluatedAt,
          invariants: [],
          ...failure,
        });
        throw error;
      }

      const invariants = screenDiagnosticsEvalResponse(scenario, generated.response);
      const failed = invariants.filter((invariant) => !invariant.passed);
      results.push({
        scenarioId: scenario.id,
        title: scenario.title,
        status: failed.length === 0 ? "passed" : "invariant_failed",
        requestedModel: generated.requestedModel,
        resolvedModel: generated.resolvedModel,
        evaluatedAt,
        promptVersion: generated.promptVersion,
        responseId: generated.responseId,
        contextHash,
        usage: generated.usage,
        invariants,
        response: generated.response,
        policyViolations: [],
      });

      expect(generated.requestedModel).toBe(config.model);
      expect(generated.resolvedModel.trim()).not.toBe("");
      expect(generated.promptVersion).toBe(DIAGNOSTICS_PROMPT_VERSION);
      expect(generated.contextHash).toBe(contextHash);
      expect(generated.response.review_status).toBe("staff_review_required");
      expect(generated.response.next_step.trim()).not.toBe("");
      expect(
        failed,
        failed
          .flatMap((failure) =>
            failure.details.map((detail) => `${failure.invariant}: ${detail}`)
          )
          .join("\n")
      ).toEqual([]);
    });
  }
});

afterAll(async () => {
  const outputDir = path.resolve("test-results/diagnostics-evals");
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "latest.json"),
    `${JSON.stringify(
      {
        suite: "Ask OTOMOTO live-model acceptance",
        screening: "Automated heuristic screening; qualified human review is required.",
        syntheticDataOnly: true,
        runStartedAt,
        requestedModel: config.model,
        promptVersion: DIAGNOSTICS_PROMPT_VERSION,
        scenarioCount: DIAGNOSTICS_EVAL_SCENARIOS.length,
        results,
      },
      null,
      2
    )}\n`,
    "utf8"
  );
});
