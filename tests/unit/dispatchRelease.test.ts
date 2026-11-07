import { describe, expect, it } from "vitest";
import { releaseDispatchedBench } from "@/lib/technician/dispatchRelease";

const WORK_ORDER = "wo-1";
const NOW = "2026-11-07T15:00:00.000Z";

type Recorded = {
  table: string;
  op: "select" | "update";
  values?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
};

function client(options: {
  jobs?: Array<{ job_id: string }>;
  selectError?: { code?: string; message?: string } | null;
  clockError?: { code?: string; message?: string } | null;
  releaseErrors?: Array<{ code?: string; message?: string } | null>;
}) {
  const calls: Recorded[] = [];
  let releaseAttempt = 0;
  return {
    calls,
    from(table: string) {
      return {
        select() {
          return {
            async eq(column: string, value: string) {
              calls.push({ table, op: "select", filters: [[column, value]] });
              return {
                data: options.selectError ? null : (options.jobs ?? []),
                error: options.selectError ?? null,
              };
            },
          };
        },
        update(values: Record<string, unknown>) {
          return {
            in(column: string, value: unknown) {
              return {
                async is(second: string, secondValue: unknown) {
                  calls.push({
                    table,
                    op: "update",
                    values,
                    filters: [
                      [column, value],
                      [second, secondValue],
                    ],
                  });
                  return { error: options.clockError ?? null };
                },
              };
            },
            eq(column: string, value: unknown) {
              return {
                async eq(second: string, secondValue: unknown) {
                  const error = options.releaseErrors?.[releaseAttempt] ?? null;
                  releaseAttempt += 1;
                  calls.push({
                    table,
                    op: "update",
                    values,
                    filters: [
                      [column, value],
                      [second, secondValue],
                    ],
                  });
                  return { error };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("releaseDispatchedBench", () => {
  it("stops the open clock and takes the in-progress job off the bench", async () => {
    const db = client({ jobs: [{ job_id: "job-a" }, { job_id: "job-b" }] });

    await releaseDispatchedBench(db, WORK_ORDER, NOW);

    expect(db.calls).toEqual([
      {
        table: "job",
        op: "select",
        filters: [["work_order_id", WORK_ORDER]],
      },
      {
        table: "job_time_entry",
        op: "update",
        values: { ended_at: NOW },
        filters: [
          ["job_id", ["job-a", "job-b"]],
          ["ended_at", null],
        ],
      },
      {
        table: "job",
        op: "update",
        values: {
          status: "ready_to_start",
          work_state: "ready",
          floor_parked_at: null,
          floor_park_reason: null,
          floor_wait_owner: null,
          updated_at: NOW,
        },
        filters: [
          ["work_order_id", WORK_ORDER],
          ["status", "in_progress"],
        ],
      },
    ]);
  });

  it("still clears the bench when job clocks are not migrated", async () => {
    const db = client({
      jobs: [{ job_id: "job-a" }],
      clockError: {
        code: "PGRST205",
        message: "Could not find the table 'public.job_time_entry' in the schema cache",
      },
    });

    await releaseDispatchedBench(db, WORK_ORDER, NOW);

    const release = db.calls.find((call) => call.table === "job" && call.op === "update");
    expect(release?.filters).toContainEqual(["status", "in_progress"]);
    expect(release?.values).toMatchObject({ status: "ready_to_start" });
  });

  it("retries without a floor column the database does not have yet", async () => {
    const db = client({
      jobs: [{ job_id: "job-a" }],
      releaseErrors: [
        { code: "42703", message: "column job.floor_parked_at does not exist" },
        null,
      ],
    });

    await releaseDispatchedBench(db, WORK_ORDER, NOW);

    const releases = db.calls.filter(
      (call) => call.table === "job" && call.op === "update"
    );
    expect(releases[0]?.values).toHaveProperty("floor_parked_at", null);
    expect(releases[1]?.values).not.toHaveProperty("floor_parked_at");
    expect(releases[1]?.values).toMatchObject({
      status: "ready_to_start",
      work_state: "ready",
      floor_park_reason: null,
      floor_wait_owner: null,
    });
  });

  it("does not treat a permission error as a missing column", async () => {
    const db = client({
      jobs: [{ job_id: "job-a" }],
      releaseErrors: [{ code: "42501", message: "permission denied for table job" }],
    });

    await expect(releaseDispatchedBench(db, WORK_ORDER, NOW)).rejects.toMatchObject({
      code: "42501",
    });
    expect(
      db.calls.filter((call) => call.op === "update" && call.table === "job")
    ).toHaveLength(1);
  });

  it("does nothing when the visit has no jobs", async () => {
    const db = client({ jobs: [] });
    await releaseDispatchedBench(db, WORK_ORDER, NOW);
    expect(db.calls).toHaveLength(1);
  });
});
