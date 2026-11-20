import { describe, expect, it } from "vitest";
import { mutationErrorKey } from "./mutation-errors";

describe("mutationErrorKey", () => {
  it("reports when the server returned no affected row", () => {
    expect(mutationErrorKey(new Error("mutation_no_rows"))).toBe("mutationNoRows");
  });

  it("maps database and HTTP authorization failures", () => {
    expect(mutationErrorKey({ code: "42501" })).toBe("permissionDenied");
    expect(mutationErrorKey({ status: 403 })).toBe("permissionDenied");
    expect(mutationErrorKey({ statusCode: "401" })).toBe("permissionDenied");
  });

  it("maps unknown failures to a safe generic message", () => {
    expect(mutationErrorKey(new Error("network unavailable"))).toBe("somethingWrong");
    expect(mutationErrorKey({ code: "XX000", message: "internal database detail" })).toBe(
      "somethingWrong",
    );
  });
});
