import { afterEach, describe, expect, it, vi } from "vitest";
import { parseUsageHeader, recordUsage } from "./usage";

const call = { task: "turn", model: "gemini-flash", ms: 812, inputTokens: 3000, cachedTokens: 2500, outputTokens: 80, thoughtTokens: 200, ok: true };

afterEach(() => vi.restoreAllMocks());

describe("parseUsageHeader", () => {
  it("reads the records liveAgent sends", () => {
    expect(parseUsageHeader(JSON.stringify([call, { ...call, ok: false }]))).toEqual([call, { ...call, ok: false }]);
  });

  it("returns nothing when the header is missing", () => {
    expect(parseUsageHeader(null)).toEqual([]);
    expect(parseUsageHeader("")).toEqual([]);
  });

  it.each(["not json", "{}", JSON.stringify([{ ...call, inputTokens: "3000" }]), JSON.stringify([{ task: "turn" }])])(
    "logs and ignores a malformed header: %s",
    (header) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(parseUsageHeader(header)).toEqual([]);
      expect(JSON.parse(String(error.mock.calls[0][0]))).toMatchObject({ event: "ai.usage.invalid" });
    },
  );
});

describe("recordUsage", () => {
  it("logs one ai.usage line per call with the user and request", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = { userId: "u1", route: "/v1/interview/turn", requestId: "r1", status: 200 };
    recordUsage(ctx, [call, call]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: "ai.usage", ...ctx, ...call });
  });
});
