import { describe, expect, it, vi } from "vitest";
import {
  PARTS_CANADA_RETRY_DELAY_MS,
  responseAfterOneServerRetry,
} from "@/lib/partsCanada/client";

function response(status: number): Response {
  return new Response(status === 200 ? "ok" : "nope", { status });
}

describe("responseAfterOneServerRetry", () => {
  it("returns a successful download without a second call", async () => {
    const load = vi.fn(async () => response(200));
    const sleep = vi.fn(async () => undefined);
    const result = await responseAfterOneServerRetry(load, sleep);
    expect(result.status).toBe(200);
    expect(load).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("tries once more after a 500, then keeps that answer", async () => {
    const load = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(response(200));
    const sleep = vi.fn(async () => undefined);
    const result = await responseAfterOneServerRetry(load, sleep);
    expect(result.status).toBe(200);
    expect(load).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(PARTS_CANADA_RETRY_DELAY_MS);
  });

  it("does not retry a rate limit", async () => {
    const load = vi.fn(async () => response(429));
    const sleep = vi.fn(async () => undefined);
    const result = await responseAfterOneServerRetry(load, sleep);
    expect(result.status).toBe(429);
    expect(load).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not retry a missing file", async () => {
    const load = vi.fn(async () => response(404));
    const sleep = vi.fn(async () => undefined);
    const result = await responseAfterOneServerRetry(load, sleep);
    expect(result.status).toBe(404);
    expect(load).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("keeps a second server error and does not spend a third request", async () => {
    const load = vi.fn(async () => response(504));
    const sleep = vi.fn(async () => undefined);
    const result = await responseAfterOneServerRetry(load, sleep);
    expect(result.status).toBe(504);
    expect(load).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(PARTS_CANADA_RETRY_DELAY_MS);
  });

  it("does not retry when the download throws", async () => {
    const load = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const sleep = vi.fn(async () => undefined);
    await expect(responseAfterOneServerRetry(load, sleep)).rejects.toThrow(
      "socket hang up"
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries when the failed body cannot be cancelled", async () => {
    const first = response(503);
    Object.defineProperty(first, "body", {
      value: {
        cancel: async () => {
          throw new Error("cancel failed");
        },
      },
    });
    const load = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(response(200));
    const sleep = vi.fn(async () => undefined);
    const result = await responseAfterOneServerRetry(load, sleep);
    expect(result.status).toBe(200);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
