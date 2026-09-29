import { afterAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  shapeDiagnosticsContext,
  type ShapedDiagnosticsModelContext,
} from "@/lib/diagnostics/context";
import { getDiagnosticsConfig } from "@/lib/diagnostics/config";
import { generateDiagnosticsDraft } from "@/lib/diagnostics/openai";
import { DIAGNOSTICS_PROMPT_VERSION } from "@/lib/diagnostics/prompts";
import type { DiagnosticsResponse } from "@/lib/diagnostics/responseSchema";
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
  contextHash: string | null;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  } | null;
  invariants: DiagnosticsEvalInvariantResult[];
  response: DiagnosticsResponse | null;
  error?: string;
};

const results: EvalResult[] = [];
const config = getDiagnosticsConfig();
const runStartedAt = new Date().toISOString();

function shapeScenario(scenario: DiagnosticsEvalScenario): ShapedDiagnosticsModelContext {
  return shapeDiagnosticsContext(scenario.context, {
    mode: scenario.mode,
    workOrderId: scenario.context.workOrder.workOrderId,
    jobId: scenario.context.jobs[0]?.jobId ?? null,
    serverNowIso: "2026-09-29T08:00:00.000Z",
  }).context;
}

describe.sequential("Ask OTOMOTO live-model acceptance", () => {
  for (const scenario of DIAGNOSTICS_EVAL_SCENARIOS) {
    it(`${scenario.id}: ${scenario.title}`, async () => {
      const evaluatedAt = new Date().toISOString();
      let generated: Awaited<ReturnType<typeof generateDiagnosticsDraft>>;
      try {
        generated = await generateDiagnosticsDraft(
          {
            mode: scenario.mode,
            requiredPhase: scenario.requiredPhase,
            staffUserId: `fictional-eval-${scenario.id}`,
            workOrderContext: shapeScenario(scenario),
            userMessage: scenario.userMessage,
          },
          { config }
        );
      } catch (error) {
        results.push({
          scenarioId: scenario.id,
          title: scenario.title,
          status: "generation_failed",
          requestedModel: config.model,
          resolvedModel: null,
          evaluatedAt,
          promptVersion: DIAGNOSTICS_PROMPT_VERSION,
          responseId: null,
          contextHash: null,
          usage: null,
          invariants: [],
          response: null,
          error: error instanceof Error ? error.message : String(error),
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
        contextHash: generated.contextHash,
        usage: generated.usage,
        invariants,
        response: generated.response,
      });

      expect(generated.requestedModel).toBe(config.model);
      expect(generated.resolvedModel.trim()).not.toBe("");
      expect(generated.promptVersion).toBe(DIAGNOSTICS_PROMPT_VERSION);
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
