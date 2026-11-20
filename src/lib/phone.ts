/**
 * Phone normalization for LeadFlow. Default country is Egypt (+20).
 * Produces E.164 ("+201012345678"). Never guesses silently: returns an error code instead.
 */
export type PhoneResult =
  | { ok: true; e164: string; digits: string }
  | { ok: false; error: "empty" | "invalid" | "eg_mobile" };

const ARABIC_INDIC = /[\u0660-\u0669]/g;
const EASTERN_ARABIC = /[\u06F0-\u06F9]/g;

export function toLatinDigits(input: string): string {
  return input
    .replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EASTERN_ARABIC, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizePhone(
  raw: string | null | undefined,
  defaultCountryCode = "20",
): PhoneResult {
  if (!raw) return { ok: false, error: "empty" };
  // Strip bidi marks, whitespace and common separators.
  const s = toLatinDigits(String(raw))
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\s\-.()/\u00a0]/g, "")
    .trim();
  if (!s) return { ok: false, error: "empty" };

  let digits: string;
  if (s.startsWith("+")) {
    digits = s.slice(1);
  } else if (s.startsWith("00")) {
    digits = s.slice(2);
  } else if (s.startsWith("0")) {
    // National format (Egypt by default): 01012345678 -> 201012345678
    digits = defaultCountryCode + s.slice(1);
  } else if (defaultCountryCode === "20" && /^1[0125]\d{8}$/.test(s)) {
    // Egyptian mobile missing the leading 0
    digits = "20" + s;
  } else {
    digits = s;
  }

  if (!/^\d+$/.test(digits)) return { ok: false, error: "invalid" };
  if (digits.length < 8 || digits.length > 15) return { ok: false, error: "invalid" };

  // Egypt-specific validation
  if (digits.startsWith("20")) {
    const national = digits.slice(2);
    if (national.startsWith("1")) {
      if (!/^1[0125]\d{8}$/.test(national)) return { ok: false, error: "eg_mobile" };
    } else if (national.length < 8 || national.length > 9) {
      return { ok: false, error: "invalid" };
    }
  }

  return { ok: true, e164: "+" + digits, digits };
}

/** Pretty-print for display; Egyptian mobiles as "+20 101 234 5678". */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = /^\+20(1\d)(\d)(\d{3})(\d{4})$/.exec(e164);
  if (m) return `+20 ${m[1]}${m[2]} ${m[3]} ${m[4]}`;
  return e164;
}

export function whatsappUrl(phoneDigits: string, message: string): string {
  const digits = phoneDigits.replace(/\D/g, "");
  const text = message.trim() ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${digits}${text}`;
}
