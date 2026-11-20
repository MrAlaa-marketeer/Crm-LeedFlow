// Arabic shaping + visual (bidi) ordering.
//
// IMPORTANT — the PDF generator (brochure-pdf.ts) does NOT call
// reshapeArabicWord / toVisual, and that is deliberate, not an
// oversight. It was verified by rendering: pdf-lib + fontkit already
// shape Arabic letters into their contextual forms and order RTL runs
// when a custom font is embedded, so drawing the LOGICAL string
// produces correct connected RTL Arabic. Passing a pre-shaped,
// pre-reversed string double-applies the transformation — "UNIT-42"
// came out as "24-TINU" and the phone "01012345678" as "87654321010"
// in the rendered PDF. The one thing fontkit gets wrong is Latin /
// digit runs inside an RTL paragraph (it reverses them), so the
// generator splits mixed strings into script runs and draws each run
// separately instead of pre-shaping.
// This module is kept as a standalone, tested implementation of the
// shaping rules (used by the test suite to assert on the shaped forms
// in a PDF's text layer, and available for any context without
// fontkit). It is not a full Unicode bidi implementation and does not
// try to be one.
//
// No third-party reshaper is used here on purpose: the well-known JS
// reshaper package is GPL-3.0, which would contaminate this commercial
// codebase. This file is original code written for LeadFlow.

export function isArabicLetter(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  // Arabic block, Arabic Presentation Forms-A/B (shaped glyphs), and
  // Arabic-Indic digits. Shaped text must still count as Arabic so
  // font selection picks Amiri for it.
  return (
    (code >= 0x0600 && code <= 0x06ff) ||
    (code >= 0xfb50 && code <= 0xfdff) ||
    (code >= 0xfe80 && code <= 0xfeff)
  );
}

export function containsArabic(text: string): boolean {
  return Array.from(text).some(isArabicLetter);
}

const DIACRITIC = /[ً-ٕٓ-ٰٟ]/u;
const TATWEEL = "ـ"; // U+0640, kashida — joins like a dual-joining letter.

function isMark(ch: string): boolean {
  return DIACRITIC.test(ch) || ch === TATWEEL;
}

function isArabicIndicDigit(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x0660 && code <= 0x0669;
}

function isWesternDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

// ---------------------------------------------------------------------------
// Presentation forms: [isolated, final, initial, medial].
// `dual` = joins to both neighbours; right-only letters have no
// initial/medial form. U+0621 (hamza) joins to nothing.
// ---------------------------------------------------------------------------

interface LetterForm {
  isolated: string;
  final?: string;
  initial?: string;
  medial?: string;
  dual: boolean;
}

const FORMS: Record<string, LetterForm> = {
  ء: { isolated: "ﺀ", dual: false },
  آ: { isolated: "ﺁ", final: "ﺂ", dual: false },
  أ: { isolated: "ﺃ", final: "ﺄ", dual: false },
  ؤ: { isolated: "ﺅ", final: "ﺆ", dual: false },
  إ: { isolated: "ﺇ", final: "ﺈ", dual: false },
  ا: { isolated: "ﺍ", final: "ﺎ", dual: false },
  ب: { isolated: "ﺏ", final: "ﺐ", initial: "ﺑ", medial: "ﺒ", dual: true },
  ة: { isolated: "ﺓ", final: "ﺔ", dual: false },
  ت: { isolated: "ﺕ", final: "ﺖ", initial: "ﺗ", medial: "ﺘ", dual: true },
  ث: { isolated: "ﺙ", final: "ﺚ", initial: "ﺛ", medial: "ﺜ", dual: true },
  ج: { isolated: "ﺝ", final: "ﺞ", initial: "ﺟ", medial: "ﺠ", dual: true },
  ح: { isolated: "ﺡ", final: "ﺢ", initial: "ﺣ", medial: "ﺤ", dual: true },
  خ: { isolated: "ﺥ", final: "ﺦ", initial: "ﺧ", medial: "ﺨ", dual: true },
  د: { isolated: "ﺩ", final: "ﺪ", dual: false },
  ذ: { isolated: "ﺫ", final: "ﺬ", dual: false },
  ر: { isolated: "ﺭ", final: "ﺮ", dual: false },
  ز: { isolated: "ﺯ", final: "ﺰ", dual: false },
  س: { isolated: "ﺱ", final: "ﺲ", initial: "ﺳ", medial: "ﺴ", dual: true },
  ش: { isolated: "ﺵ", final: "ﺶ", initial: "ﺷ", medial: "ﺸ", dual: true },
  ص: { isolated: "ﺹ", final: "ﺺ", initial: "ﺻ", medial: "ﺼ", dual: true },
  ض: { isolated: "ﺽ", final: "ﺾ", initial: "ﺿ", medial: "ﻀ", dual: true },
  ط: { isolated: "ﻁ", final: "ﻂ", initial: "ﻃ", medial: "ﻄ", dual: true },
  ظ: { isolated: "ﻅ", final: "ﻆ", initial: "ﻇ", medial: "ﻈ", dual: true },
  ع: { isolated: "ﻉ", final: "ﻊ", initial: "ﻋ", medial: "ﻌ", dual: true },
  غ: { isolated: "ﻍ", final: "ﻎ", initial: "ﻏ", medial: "ﻐ", dual: true },
  ف: { isolated: "ﻑ", final: "ﻒ", initial: "ﻓ", medial: "ﻔ", dual: true },
  ق: { isolated: "ﻕ", final: "ﻖ", initial: "ﻗ", medial: "ﻘ", dual: true },
  ك: { isolated: "ﻙ", final: "ﻚ", initial: "ﻛ", medial: "ﻜ", dual: true },
  ل: { isolated: "ﻝ", final: "ﻞ", initial: "ﻟ", medial: "ﻠ", dual: true },
  م: { isolated: "ﻡ", final: "ﻢ", initial: "ﻣ", medial: "ﻤ", dual: true },
  ن: { isolated: "ﻥ", final: "ﻦ", initial: "ﻧ", medial: "ﻨ", dual: true },
  ه: { isolated: "ﻩ", final: "ﻪ", initial: "ﻫ", medial: "ﻬ", dual: true },
  و: { isolated: "ﻭ", final: "ﻮ", dual: false },
  ى: { isolated: "ﻯ", final: "ﻰ", dual: false },
  ي: { isolated: "ﻱ", final: "ﻲ", initial: "ﻳ", medial: "ﻴ", dual: true },
  ئ: { isolated: "ﺉ", final: "ﺊ", initial: "ﺋ", medial: "ﺌ", dual: true },
  ٱ: { isolated: "ﭐ", final: "ﭑ", dual: false },
  [TATWEEL]: { isolated: TATWEEL, final: TATWEEL, initial: TATWEEL, medial: TATWEEL, dual: true },
};

// Lam-alef ligatures: [isolated, final].
const LAM_ALEF: Record<string, [string, string]> = {
  ا: ["ﻻ", "ﻼ"],
  أ: ["ﻷ", "ﻸ"],
  إ: ["ﻹ", "ﻺ"],
  آ: ["ﻵ", "ﻶ"],
};

interface LetterUnit {
  /** Shaped presentation-form glyph for the base letter. */
  glyph: string;
  /** Marks (diacritics) that follow the letter, in logical order. */
  marks: string;
  /** True when the unit is an Arabic letter (vs digit / Latin / punct). */
  isLetter: boolean;
}

function isShapedArabicGlyph(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (code >= 0xfe80 && code <= 0xfeff) || (code >= 0x0600 && code <= 0x06ff);
}

/**
 * Shape one Arabic word (logical order, no spaces) into letter units
 * in logical order. Diacritics stay attached to their letter, so a
 * later reversal can keep each mark with its base letter.
 */
function shapeWordUnits(word: string): LetterUnit[] {
  const chars = Array.from(word);
  // Group each base letter with the marks that follow it.
  const units: Array<{ ch: string; marks: string }> = [];
  for (const ch of chars) {
    if (isMark(ch) && units.length > 0) {
      const last = units[units.length - 1];
      if (last) last.marks += ch;
    } else {
      units.push({ ch, marks: "" });
    }
  }
  const out: LetterUnit[] = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (!unit) continue;
    const form = FORMS[unit.ch];
    if (!form) {
      // Not an Arabic letter (digit, Latin, punctuation): pass through.
      out.push({ glyph: unit.ch, marks: unit.marks, isLetter: false });
      continue;
    }
    // Lam-alef ligature: ل + ا/أ/إ/آ.
    if (unit.ch === "ل") {
      const next = units[i + 1];
      if (next && LAM_ALEF[next.ch]) {
        const prev = units[i - 1];
        const prevJoins = !!prev && !!FORMS[prev.ch]?.dual;
        const lig = LAM_ALEF[next.ch];
        if (!lig) continue;
        out.push({ glyph: prevJoins ? lig[1] : lig[0], marks: next.marks, isLetter: true });
        i++; // consume the alef
        continue;
      }
    }
    const prev = units[i - 1];
    const next = units[i + 1];
    const prevJoins = !!prev && !!FORMS[prev.ch]?.dual;
    // The next letter must itself accept a connection from the left;
    // hamza (ء) joins to nothing, so it breaks the connection.
    const nextIsLetter = !!next && !!FORMS[next.ch] && next.ch !== "ء";
    const nextJoins = nextIsLetter && form.dual;
    let glyph: string;
    if (prevJoins && nextJoins) glyph = form.medial ?? form.final ?? form.isolated;
    else if (prevJoins) glyph = form.final ?? form.isolated;
    else if (nextJoins) glyph = form.initial ?? form.isolated;
    else glyph = form.isolated;
    out.push({ glyph, marks: unit.marks, isLetter: true });
  }
  return out;
}

/**
 * Shape one Arabic word (logical order, no spaces) into presentation
 * forms, still in logical order. Non-Arabic characters inside the word
 * are passed through unchanged and break joining, as they should.
 */
export function reshapeArabicWord(word: string): string {
  return shapeWordUnits(word)
    .map((u) => u.glyph + u.marks)
    .join("");
}

// ---------------------------------------------------------------------------
// Visual (bidi) ordering
// ---------------------------------------------------------------------------

const MIRROR: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
};

type RunKind = "arabic" | "digits" | "latin" | "space" | "punct";

function runKind(word: string): RunKind {
  if (/^\s+$/.test(word)) return "space";
  if (containsArabic(word)) return "arabic";
  if (/^[0-9٠-٩]+$/.test(word)) return "digits";
  if (/^[A-Za-z0-9 ,.:/%\-+]+$/.test(word)) return "latin";
  return "punct";
}

/**
 * Reverse one Arabic word for RTL display. Letter units are reversed
 * as whole units (glyph + its marks stay together), while digit/Latin
 * runs inside the word keep their internal order. E.g. "شقة٣" keeps
 * "٣" in place while the letters around it flip.
 */
function reverseArabicWordVisual(word: string): string {
  const units = shapeWordUnits(word);
  // Group units into letter-runs vs other-runs.
  const runs: LetterUnit[][] = [];
  for (const u of units) {
    const last = runs[runs.length - 1];
    if (last && last.length > 0 && (last[0]?.isLetter ?? false) === u.isLetter) {
      last.push(u);
    } else {
      runs.push([u]);
    }
  }
  return runs
    .reverse()
    .map((run) => {
      const arabic = run[0]?.isLetter ?? false;
      const ordered = arabic ? [...run].reverse() : run;
      return ordered
        .map((u) => {
          const glyph = arabic ? (MIRROR[u.glyph] ?? u.glyph) : u.glyph;
          return glyph + u.marks;
        })
        .join("");
    })
    .join("");
}

/**
 * Convert a logical-order string to visual order for left-to-right
 * drawing (pdf-lib). Arabic words are shaped and reversed; Latin words
 * and digit runs keep their internal order; word order is reversed for
 * RTL text — except that consecutive Latin/digit words stay together in
 * their original order (so "Cairo Hills" inside an Arabic sentence
 * still reads "Cairo Hills", on the left). Pure Latin text is returned
 * unchanged.
 */
export function toVisual(text: string): string {
  if (!containsArabic(text)) return text;
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  // Pair each word with its visual form, classified by the ORIGINAL
  // word: a shaped word is made of presentation forms (U+FE80–U+FEFF),
  // which the Arabic range check would no longer recognise.
  const paired = words.map((w) => {
    const kind = runKind(w);
    const visual =
      kind === "arabic"
        ? reverseArabicWordVisual(w)
        : kind === "punct"
          ? Array.from(w)
              .map((c) => MIRROR[c] ?? c)
              .join("")
          : w;
    return { visual, arabic: kind === "arabic" };
  });
  // Group consecutive words of the same direction class (Arabic vs
  // everything else), reverse the groups, keep order inside a group.
  const groups: Array<{ words: string[]; arabic: boolean }> = [];
  for (const { visual, arabic } of paired) {
    const last = groups[groups.length - 1];
    if (last && last.arabic === arabic) {
      last.words.push(visual);
    } else {
      groups.push({ words: [visual], arabic });
    }
  }
  return groups
    .reverse()
    .map((g) => g.words.join(" "))
    .join(" ");
}

/** Western digits → Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩). */
export function toArabicIndicDigits(value: string | number): string {
  const map = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(value).replace(/[0-9]/g, (d) => map[Number(d)] ?? d);
}

/** True when the string contains Arabic presentation-form glyphs. */
export function containsShapedArabic(text: string): boolean {
  return Array.from(text).some(isShapedArabicGlyph);
}
