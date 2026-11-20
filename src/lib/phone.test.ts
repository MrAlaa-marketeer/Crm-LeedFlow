import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, whatsappUrl } from "./phone";

describe("normalizePhone (Egypt default)", () => {
  it("converts local Egyptian mobile 010… to +20", () => {
    expect(normalizePhone("01012345678")).toEqual({
      ok: true,
      e164: "+201012345678",
      digits: "201012345678",
    });
  });
  it("accepts Arabic-Indic digits and spaces", () => {
    const r = normalizePhone("٠١٢ ٣٤٥٦ ٧٨٩٠");
    expect(r.ok && r.e164).toBe("+201234567890");
  });
  it("accepts 00 international prefix", () => {
    const r = normalizePhone("00201112223334");
    expect(r.ok && r.e164).toBe("+201112223334");
  });
  it("keeps foreign numbers with +", () => {
    const r = normalizePhone("+971 50 123 4567");
    expect(r.ok && r.e164).toBe("+971501234567");
  });
  it("adds 20 to a mobile missing the leading zero", () => {
    const r = normalizePhone("1512345678");
    expect(r.ok && r.e164).toBe("+201512345678");
  });
  it("rejects Egyptian mobiles with the wrong length or prefix", () => {
    expect(normalizePhone("0101234567")).toEqual({ ok: false, error: "eg_mobile" });
    expect(normalizePhone("01312345678")).toEqual({ ok: false, error: "eg_mobile" });
  });
  it("rejects letters and empty input", () => {
    expect(normalizePhone("abc")).toEqual({ ok: false, error: "invalid" });
    expect(normalizePhone("  ")).toEqual({ ok: false, error: "empty" });
  });
});

describe("whatsapp link", () => {
  it("builds a wa.me URL with digits only and an encoded message", () => {
    expect(whatsappUrl("+201012345678", "أهلاً & مرحبا")).toBe(
      "https://wa.me/201012345678?text=" + encodeURIComponent("أهلاً & مرحبا"),
    );
  });
  it("formats Egyptian mobiles for display", () => {
    expect(formatPhone("+201012345678")).toBe("+20 101 234 5678");
  });
});
