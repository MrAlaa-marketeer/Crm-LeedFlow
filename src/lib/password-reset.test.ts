import { describe, expect, it } from "vitest";
import { isValidResetEmail, validateNewPassword } from "@/lib/password-reset";

describe("password reset validation", () => {
  it("trims and validates email addresses", () => {
    expect(isValidResetEmail("  person@example.com ")).toBe(true);
    expect(isValidResetEmail("person@localhost")).toBe(false);
    expect(isValidResetEmail("not an email")).toBe(false);
  });

  it("requires a minimum password length and matching confirmation", () => {
    expect(validateNewPassword("short", "short")).toBe("passwordMin");
    expect(validateNewPassword("long-enough", "different")).toBe("passwordsDontMatch");
    expect(validateNewPassword("long-enough", "long-enough")).toBeNull();
  });
});
