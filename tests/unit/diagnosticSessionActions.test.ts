import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getRolePreviewContext,
  recordDiagnosticSession,
  removeDiagnosticSession,
  revalidatePath,
} = vi.hoisted(() => ({
  getRolePreviewContext: vi.fn(),
  recordDiagnosticSession: vi.fn(),
  removeDiagnosticSession: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/role-preview", () => ({ getRolePreviewContext }));
vi.mock("@/lib/services/diagnosticSessions", () => ({
  recordDiagnosticSession,
  removeDiagnosticSession,
}));

import {
  recordDiagnosticSessionAction,
  removeDiagnosticSessionAction,
} from "@/app/(app)/motorcycles/diagnostic-actions";

const MOTORCYCLE = "ad000000-0000-4000-8000-000000000001";
const WORK_ORDER = "ae000000-0000-4000-8000-000000000001";
const CUSTOMER = "ac000000-0000-4000-8000-000000000001";
const SESSION = "af000000-0000-4000-8000-000000000001";

function scanForm(): FormData {
  const data = new FormData();
  data.set("motorcycle_id", MOTORCYCLE);
  data.set("work_order_id", WORK_ORDER);
  data.set("customer_id", CUSTOMER);
  data.set("source", "scan_tool");
  data.set("scan_results", "complete");
  data.set("code_0", "P0217");
  data.set("status_0", "active");
  return data;
}

describe("diagnostic session actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRolePreviewContext.mockResolvedValue({ isPreviewing: false });
    recordDiagnosticSession.mockResolvedValue(SESSION);
    removeDiagnosticSession.mockResolvedValue(undefined);
  });

  it("refuses to record while a role is being previewed", async () => {
    getRolePreviewContext.mockResolvedValue({ isPreviewing: true });
    const result = await recordDiagnosticSessionAction({ error: null }, scanForm());
    expect(result.error).toMatch(/preview/i);
    expect(recordDiagnosticSession).not.toHaveBeenCalled();
  });

  it("maps a forbidden recorder to the permission message", async () => {
    recordDiagnosticSession.mockRejectedValue(new Error("FORBIDDEN"));
    const result = await recordDiagnosticSessionAction({ error: null }, scanForm());
    expect(result.error).toBe("You do not have permission to perform this action.");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refreshes the bike, visit, customer, and floor after a saved scan", async () => {
    const result = await recordDiagnosticSessionAction({ error: null }, scanForm());
    expect(result.error).toBeNull();
    expect(recordDiagnosticSession).toHaveBeenCalledWith(
      expect.objectContaining({
        motorcycleId: MOTORCYCLE,
        workOrderId: WORK_ORDER,
        readings: [expect.objectContaining({ code: "P0217", status: "active" })],
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/motorcycles/${MOTORCYCLE}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/work_orders/${WORK_ORDER}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/customers/${CUSTOMER}`);
    expect(revalidatePath).toHaveBeenCalledWith("/technician");
  });

  it("refuses to remove a scan while previewing", async () => {
    getRolePreviewContext.mockResolvedValue({ isPreviewing: true });
    const data = new FormData();
    data.set("session_id", SESSION);
    data.set("motorcycle_id", MOTORCYCLE);
    const result = await removeDiagnosticSessionAction({ error: null }, data);
    expect(result.error).toMatch(/preview/i);
    expect(removeDiagnosticSession).not.toHaveBeenCalled();
  });
});
