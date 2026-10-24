import { describe, expect, it } from "vitest";
import { requireCronSecret } from "./cronAuth";

describe("requireCronSecret", () => {
  it("lets the right bearer token through", () => {
    expect(() => requireCronSecret("Bearer s3cret", "s3cret")).not.toThrow();
  });

  it("refuses everything when no secret is configured", () => {
    expect(() => requireCronSecret("Bearer ", undefined)).toThrow(expect.objectContaining({ status: 503 }));
    expect(() => requireCronSecret(null, "")).toThrow(expect.objectContaining({ status: 503 }));
  });

  it("refuses a missing, wrong, differently-sized or unprefixed token", () => {
    for (const header of [null, "", "Bearer wrong!", "Bearer s3cre", "Bearer s3cret2", "s3cret", "bearer s3cret"]) {
      expect(() => requireCronSecret(header, "s3cret")).toThrow(expect.objectContaining({ status: 401 }));
    }
  });
});
