// Real PDF brochures (pdf-lib, pure JS — no native deps, no Puppeteer/Chrome,
// works in the browser and in Nitro / Cloudflare Workers).
//
// ARABIC — real Arabic now works:
//   * Amiri (Regular + Bold, SIL OFL) is vendored under public/fonts/ and
//     embedded with @pdf-lib/fontkit whenever it loads. fontkit shapes
//     the Arabic (contextual presentation forms, lam-alef ligatures)
//     when the logical string is drawn, so project names, areas, agent
//     names and Arabic labels render as connected Arabic, right-aligned,
//     in both locales. Mixed strings are split into script runs first
//     (Arabic runs with Amiri, Latin/digit runs with Helvetica), because
//     fontkit reverses Latin/digit runs inside an RTL paragraph.
//   * pdf-lib's /W widths array only covers cmap-reachable glyphs, so
//     shaped Arabic glyphs would render ~2.3x too wide; arabic-font.ts
//     rewrites /W after flush (see finalizeArabicFonts) to cover every
//     glyph in the font.
//   * If the font cannot be loaded (offline, missing file), the old
//     Helvetica + Latin transliteration fallback is used and the PDF
//     still generates; a note in the PDF says so.
//   * WebP photos are converted to JPEG before embedding: in the browser
//     via canvas, or via the injected `convertImage` option (used by
//     tests / scripts). If conversion is unavailable the photo is
//     skipped, as before — the PDF never fails for a photo.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { monthlyInstallment } from "./phase-features";
import type { BrochureUnit } from "./brochure";
import { containsArabic } from "./arabic-text";
import {
  embedArabicFonts,
  finalizeArabicFonts,
  loadArabicFontBytes,
  type ArabicFontBytes,
  type ArabicFonts,
} from "./arabic-font";

export type BrochureLocale = "ar" | "en";

export type PhotoFetcher = (url: string) => Promise<Uint8Array | null>;
export type ImageConverter = (webpBytes: Uint8Array) => Promise<Uint8Array | null>;

export interface BrochurePdfOptions {
  /** Override how photo bytes are fetched (tests inject a stub). Defaults to global fetch. */
  fetchPhotoBytes?: PhotoFetcher;
  /** Override how WebP bytes are converted to JPEG/PNG. Defaults to browser canvas. */
  convertImage?: ImageConverter;
  /** Arabic font bytes (tests / scripts pass them from public/fonts/). */
  arabicFontBytes?: ArabicFontBytes;
}

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK = rgb(0.09, 0.13, 0.18);
const MUTED = rgb(0.35, 0.4, 0.48);
const ACCENT = rgb(0.05, 0.35, 0.55);
const RULE = rgb(0.85, 0.87, 0.9);

// ---------------------------------------------------------------------------
// Text safety: everything drawn must be encodable by the chosen font.
// With Amiri loaded, Arabic is drawn shaped (see arabic-text.ts); without
// it, Arabic-script values fall back to Latin transliteration (Helvetica).
// ---------------------------------------------------------------------------

const ARABIC_LETTER: Record<string, string> = {
  ا: "a",
  أ: "a",
  إ: "i",
  آ: "a",
  ٱ: "a",
  ب: "b",
  ت: "t",
  ث: "th",
  ج: "j",
  ح: "h",
  خ: "kh",
  د: "d",
  ذ: "dh",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  ع: "a",
  غ: "gh",
  ف: "f",
  ق: "q",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  و: "w",
  ي: "y",
  ى: "a",
  ة: "a",
  ء: "'",
  ؤ: "w",
  ئ: "y",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

/** Small Latin transliteration for Arabic-script runs (fallback only). */
export function transliterateArabic(text: string): string {
  return Array.from(text)
    .map((ch) => {
      // Arabic diacritics / tatweel carry no letter value for a brochure.
      if (/[ً-ٕٓ-ٰٟـ]/.test(ch)) return "";
      return ARABIC_LETTER[ch] ?? ch;
    })
    .join("");
}

const WINANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0x017e, 0x0178,
]);

/** Map a string to something Helvetica/WinAnsi can encode; anything else becomes "?". */
export function pdfSafeText(value: unknown): string {
  const raw = transliterateArabic(String(value ?? "—"));
  return Array.from(raw)
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      if (ch === "’" || ch === "‘") return "'";
      if (ch === "“" || ch === "”") return '"';
      if (ch === "–" || ch === "—") return "-";
      if (ch === "…") return "...";
      if (ch === "•") return "-";
      if (code >= 0x20 && code <= 0x7e) return ch;
      if (code >= 0xa0 && code <= 0xff) return ch;
      if (WINANSI_EXTRA.has(code)) return ch;
      return "?";
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Validation / formatting
// ---------------------------------------------------------------------------

function validateUnits(units: BrochureUnit[]): void {
  if (!Array.isArray(units) || units.length === 0) throw new Error("brochure_empty");
  for (const u of units) {
    if (!u || typeof u.unit_code !== "string" || u.unit_code.trim() === "") {
      throw new Error("brochure_invalid_unit");
    }
  }
}

const fmtNum = (n: number) => n.toLocaleString("en-US");
const fmtMoney = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : `${fmtNum(n)} EGP`;
const fmtPlain = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : fmtNum(n);

function installmentLine(u: BrochureUnit, ar: boolean): string | null {
  if (u.price == null || u.down_payment == null) return null;
  if (ar) {
    const down = `المقدم: ${fmtMoney(u.down_payment)}`;
    if (u.installment_years == null) return down;
    try {
      const monthly = monthlyInstallment(u.price, u.down_payment, u.installment_years);
      const years = u.installment_years;
      const yearWord = years === 1 ? "سنة" : years === 2 ? "سنتين" : "سنوات";
      return `${down} - ${fmtNum(monthly)} جنيه / شهريًا لمدة ${years} ${yearWord}`;
    } catch {
      return down;
    }
  }
  const down = `Down payment: ${fmtMoney(u.down_payment)}`;
  if (u.installment_years == null) return down;
  try {
    const monthly = monthlyInstallment(u.price, u.down_payment, u.installment_years);
    return (
      `${down} - ${fmtNum(monthly)} EGP / month over ` +
      `${u.installment_years} year${u.installment_years === 1 ? "" : "s"}`
    );
  } catch {
    // Invalid combination (e.g. down payment > price): show the down
    // payment, never fail the whole PDF for one optional line.
    return down;
  }
}

export function brochureFileName(units: BrochureUnit[]): string {
  if (units.length === 1) {
    const code = (units[0]?.unit_code ?? "unit")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-");
    return `leadflow-brochure-${code || "unit"}.pdf`;
  }
  return "leadflow-catalogue.pdf";
}

// ---------------------------------------------------------------------------
// Photos: fetch bytes, embed JPEG/PNG, convert WebP — never fail the PDF.
// ---------------------------------------------------------------------------

async function defaultFetchPhotoBytes(url: string): Promise<Uint8Array | null> {
  const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof fetchFn !== "function") return null;
  const res = await fetchFn(url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

type ImageKind = "jpg" | "png" | "webp" | null;

function imageKind(bytes: Uint8Array): ImageKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpg";
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  return null;
}

/** Browser path: decode WebP with an <img> + canvas and re-encode as JPEG. */
async function convertWebpViaCanvas(bytes: Uint8Array): Promise<Uint8Array | null> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc || typeof Image === "undefined" || typeof URL === "undefined") return null;
  try {
    // Check for a real 2D canvas first: jsdom has document/Image but
    // no canvas implementation, and its Image never fires onload — so
    // never start loading the image without a working canvas.
    const probe = doc.createElement("canvas");
    if (!probe.getContext("2d")) return null;
    const blob = new Blob([bytes as unknown as BlobPart], { type: "image/webp" });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("webp_decode_timeout")), 5000);
        const image = new Image();
        image.onload = () => {
          clearTimeout(timer);
          resolve(image);
        };
        image.onerror = () => {
          clearTimeout(timer);
          reject(new Error("webp_decode_failed"));
        };
        image.src = url;
      });
      const canvas = doc.createElement("canvas");
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      if (canvas.width === 0 || canvas.height === 0) return null;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      const out: Blob | null = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92),
      );
      if (!out) return null;
      return new Uint8Array(await out.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

async function convertWebp(
  bytes: Uint8Array,
  opts?: BrochurePdfOptions,
): Promise<Uint8Array | null> {
  if (opts?.convertImage) {
    try {
      const converted = await opts.convertImage(bytes);
      if (converted && imageKind(converted) !== null) return converted;
    } catch {
      // fall through to the canvas path
    }
  }
  return convertWebpViaCanvas(bytes);
}

async function fetchPhotoBytes(url: string, opts?: BrochurePdfOptions): Promise<Uint8Array | null> {
  try {
    const fetcher = opts?.fetchPhotoBytes ?? defaultFetchPhotoBytes;
    const bytes = await fetcher(url);
    if (!bytes || bytes.length === 0) return null;
    const kind = imageKind(bytes);
    if (kind === "jpg" || kind === "png") return bytes;
    if (kind === "webp") {
      const converted = await convertWebp(bytes, opts);
      return converted && imageKind(converted) ? converted : null;
    }
    return null;
  } catch {
    // CORS / offline / signed-URL expired: skip the photo, keep the PDF.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Drawing helpers.
//
// ARABIC RENDERING — read this before touching it:
// The generator draws LOGICAL-order strings and lets fontkit do the
// shaping and bidi. That is not a shortcut: it was verified by rendering.
// fontkit's layout (used by pdf-lib when a custom font is embedded)
// shapes Arabic letters into their contextual forms and orders RTL
// runs correctly for pure-Arabic and Latin-first mixed strings —
// verified by rendering to PNG and reading it back, and by inspecting
// the content stream with pypdf.
// What fontkit does NOT do correctly is Latin/digit runs inside an
// RTL paragraph: "أحمد محمد - 01012345678" came out with the phone
// reversed ("87654321010"), and "Leadflow" came out as "wolfdaeL".
// Pre-shaping the string first (arabic-text.ts toVisual) makes it
// worse: it double-reverses. So mixed strings are never drawn in one
// call. Instead they are split into script runs (Arabic vs Latin /
// digits) and each run is drawn separately, in visual order, with its
// own font (Amiri for Arabic, Helvetica for Latin/digits). Pure
// Arabic, pure Latin and pure digit runs all render correctly on their
// own. Without the Amiri font, the whole string is transliterated to
// Latin first (the old fallback) and drawn in Helvetica.
// ---------------------------------------------------------------------------

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  arabic: ArabicFonts | null;
}

interface DrawCtx {
  locale: BrochureLocale;
  fonts: Fonts;
  /** True when the Amiri fonts embedded successfully. */
  hasArabicFont: boolean;
  /** RTL layout (locale "ar"). */
  rtl: boolean;
  /** Amiri bytes, kept so the /W patch can run after flush (see below). */
  arabicBytes?: ArabicFontBytes;
}

interface TextRun {
  text: string;
  arabic: boolean;
}

type RunKind = "arabic" | "latin" | "neutral";

/**
 * Split a logical string into Arabic runs, Latin runs, and neutral
 * runs (spaces and ASCII punctuation).
 *
 * Neutrals follow the Unicode bidi algorithm (verified against the
 * python-bidi reference implementation):
 * - A neutral between two runs of the same kind belongs to them
 *   (the comma in "500,000", the space in "أحمد محمد").
 * - A neutral between an Arabic run and a Latin/digit run is its own
 *   run, so that when the runs are reversed for RTL it lands BETWEEN
 *   the two parts instead of trailing one of them. Without this, the
 *   " - " in "UNIT-42 - القاهرة الجديدة" stayed attached to the Latin
 *   run and rendered at the far right, after UNIT-42, instead of
 *   between the project name and the unit code.
 * - A neutral between a digit run and a letter run is its own run
 *   only when the digits come first ("500,000 EGP" renders as
 *   "EGP 500,000" in RTL); when the letters come first ("EGP 500",
 *   "EGP - 33,333.33") the neutral joins them into one Latin run.
 *   That asymmetry is the UBA's European-number handling: in an RTL
 *   paragraph letters always display to the left of adjacent digits.
 *
 * In a left-to-right paragraph there is no bidi reordering, so digits
 * and letters stay in one Latin run ("2,500,000 EGP" is a single Tj
 * and stays searchable as one string). The digits/letters split only
 * applies when `rtl` is true.
 *
 * Exported for tests.
 */
export function splitRuns(text: string, rtl = false): TextRun[] {
  // Letters and digits share the "latin" kind: adjacent letters and
  // digits with no neutral between them ("m2", "UNIT-42") are one
  // token and must never be split — splitting them would let RTL
  // reversal swap them ("2m"). The digits/letters distinction only
  // matters at a neutral boundary (see pass 2), where it is decided
  // from the boundary characters, not the kind.
  const kindOf = (ch: string): RunKind => {
    if (containsArabic(ch) || /[ً-ٕٓ-ٰٟـ،؟]/.test(ch)) return "arabic";
    if (/[A-Za-z0-9]/.test(ch)) return "latin";
    return "neutral";
  };
  // Pass 1: maximal runs by kind.
  const raw: { text: string; kind: RunKind }[] = [];
  for (const ch of Array.from(text)) {
    const kind = kindOf(ch);
    const last = raw[raw.length - 1];
    if (last && last.kind === kind) last.text += ch;
    else raw.push({ text: ch, kind });
  }
  // Pass 2: resolve neutrals (see the doc comment above).
  const out: { text: string; kind: RunKind }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const run = raw[i]!;
    if (run.kind !== "neutral") {
      out.push(run);
      continue;
    }
    const prev = out[out.length - 1];
    const next = raw[i + 1];
    if (prev && next && next.kind !== "neutral") {
      if (prev.kind === "arabic" && next.kind === "arabic") {
        // Same kind on both sides: the neutral and the next run join prev.
        prev.text += run.text + next.text;
        i++;
      } else if (prev.kind === "arabic" || next.kind === "arabic") {
        // Arabic vs Latin/digits: the neutral is its own run.
        out.push(run);
      } else if (rtl && /[0-9]$/.test(prev.text) && /^[A-Za-z]/.test(next.text)) {
        // Digits followed by letters ("500,000 EGP"): the neutral is
        // its own run, so RTL reversal puts the letters to the left
        // of the digits ("EGP 500,000"). RTL only — in LTR the
        // price stays one run and one searchable string.
        out.push(run);
      } else {
        // Both Latin-ish and not digits-then-letters: join into one
        // Latin run ("EGP 500", "EGP - 33,333.33", "500,000").
        // The boundary characters (not the kind field) decide the
        // next neutral, so a merged run like "UNIT-42" still splits
        // correctly before following letters.
        prev.text += run.text + next.text;
        prev.kind = "latin";
        i++;
      }
    } else if (prev) {
      // Trailing neutral: attach to the preceding run.
      prev.text += run.text;
    } else if (next && next.kind !== "neutral") {
      // Leading neutral: attach to the following run.
      next.text = run.text + next.text;
    } else {
      out.push(run);
    }
  }
  // Neutral runs are ASCII, so they are drawn with the Latin font.
  const runs = out.map((r) => ({ text: r.text, arabic: r.kind === "arabic" }));
  return runs.length ? runs : [{ text, arabic: false }];
}

function runFont(ctx: DrawCtx, run: TextRun, weight: "regular" | "bold"): PDFFont {
  if (run.arabic && ctx.hasArabicFont && ctx.fonts.arabic) return ctx.fonts.arabic[weight];
  return ctx.fonts[weight];
}

function runWidth(ctx: DrawCtx, run: TextRun, weight: "regular" | "bold", size: number): number {
  return runFont(ctx, run, weight).widthOfTextAtSize(run.text, size);
}

/** Width of a logical string, measured run by run. */
function mixedWidth(ctx: DrawCtx, text: string, weight: "regular" | "bold", size: number): number {
  return splitRuns(text, ctx.rtl).reduce((sum, run) => sum + runWidth(ctx, run, weight, size), 0);
}

/** Prepare a value for drawing: logical text with Amiri, or WinAnsi-safe text without it. */
function prepareText(ctx: DrawCtx, value: unknown): string {
  const raw = String(value ?? "—");
  if (ctx.hasArabicFont) return raw;
  return pdfSafeText(raw);
}

/**
 * Draw one logical line. `x` is the left edge for align "left" and the
 * right edge for align "right". Runs are laid out in visual order
 * (reversed for RTL) and each run is drawn with its own font.
 */
function drawMixedLine(
  page: PDFPage,
  ctx: DrawCtx,
  text: string,
  x: number,
  y: number,
  size: number,
  weight: "regular" | "bold",
  color = INK,
  align: "left" | "right" = "left",
): void {
  const runs = splitRuns(text, ctx.rtl);
  const visualRuns = ctx.rtl ? [...runs].reverse() : runs;
  const totalWidth = visualRuns.reduce((sum, run) => sum + runWidth(ctx, run, weight, size), 0);
  let cursor = align === "right" ? x - totalWidth : x;
  for (const run of visualRuns) {
    const font = runFont(ctx, run, weight);
    page.drawText(run.text, { x: cursor, y, size, font, color });
    cursor += runWidth(ctx, run, weight, size);
  }
}

function drawText(
  page: PDFPage,
  ctx: DrawCtx,
  text: string,
  x: number,
  y: number,
  size: number,
  weight: "regular" | "bold",
  color = INK,
  align: "left" | "right" = "left",
): void {
  drawMixedLine(page, ctx, prepareText(ctx, text), x, y, size, weight, color, align);
}

function wrapLogicalLines(
  ctx: DrawCtx,
  text: string,
  size: number,
  maxWidth: number,
  weight: "regular" | "bold",
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (mixedWidth(ctx, next, weight, size) <= maxWidth || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

function drawWrapped(
  page: PDFPage,
  ctx: DrawCtx,
  text: string,
  x: number,
  yTop: number,
  size: number,
  maxWidth: number,
  weight: "regular" | "bold" = "regular",
  color = INK,
): number {
  const prepared = prepareText(ctx, text);
  const lines = wrapLogicalLines(ctx, prepared, size, maxWidth, weight);
  const align = ctx.rtl ? "right" : "left";
  let y = yTop;
  for (const line of lines) {
    const drawX = align === "right" ? x + maxWidth : x;
    drawMixedLine(page, ctx, line, drawX, y, size, weight, color, align);
    y -= size * 1.35;
  }
  return y;
}

async function embedPhoto(
  doc: PDFDocument,
  bytes: Uint8Array,
): Promise<{
  image: { width: number; height: number };
  draw: (page: PDFPage, opts: { x: number; y: number; width: number; height: number }) => void;
} | null> {
  try {
    const kind = imageKind(bytes);
    if (kind === "jpg") {
      const image = await doc.embedJpg(bytes);
      return {
        image,
        draw: (page, o) => page.drawImage(image, o),
      };
    }
    if (kind === "png") {
      const image = await doc.embedPng(bytes);
      return {
        image,
        draw: (page, o) => page.drawImage(image, o),
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function drawCoverPhoto(
  doc: PDFDocument,
  page: PDFPage,
  url: string | undefined,
  yTop: number,
  opts?: BrochurePdfOptions,
): Promise<number> {
  if (!url) return yTop;
  const bytes = await fetchPhotoBytes(url, opts);
  if (!bytes) return yTop;
  const photo = await embedPhoto(doc, bytes);
  if (!photo) return yTop;
  const maxH = 240;
  const scale = Math.min(CONTENT_W / photo.image.width, maxH / photo.image.height, 1);
  const w = photo.image.width * scale;
  const h = photo.image.height * scale;
  photo.draw(page, { x: MARGIN, y: yTop - h, width: w, height: h });
  return yTop - h - 16;
}

async function drawGallery(
  doc: PDFDocument,
  page: PDFPage,
  urls: string[],
  yTop: number,
  opts?: BrochurePdfOptions,
): Promise<number> {
  const thumbs = urls.slice(0, 3);
  if (thumbs.length === 0) return yTop;
  const gap = 8;
  const thumbW = (CONTENT_W - gap * (thumbs.length - 1)) / thumbs.length;
  const thumbH = 64;
  let drawn = 0;
  for (let i = 0; i < thumbs.length; i++) {
    const url = thumbs[i];
    if (!url) continue;
    const bytes = await fetchPhotoBytes(url, opts);
    if (!bytes) continue;
    const photo = await embedPhoto(doc, bytes);
    if (!photo) continue;
    const scale = Math.min(thumbW / photo.image.width, thumbH / photo.image.height, 1);
    const w = photo.image.width * scale;
    const h = photo.image.height * scale;
    const x = MARGIN + i * (thumbW + gap) + (thumbW - w) / 2;
    photo.draw(page, { x, y: yTop - thumbH + (thumbH - h) / 2, width: w, height: h });
    drawn++;
  }
  return drawn > 0 ? yTop - thumbH - 12 : yTop;
}

interface BrochureLabels {
  project: string;
  area: string;
  bedrooms: string;
  bathrooms: string;
  price: string;
  payment: string;
  paymentPlan: string;
  agent: string;
  catalogue: string;
  comparison: string;
  unit: string;
  beds: string;
  page: string;
  of: string;
}

const LABELS: Record<BrochureLocale, BrochureLabels> = {
  en: {
    project: "Project",
    area: "Area",
    bedrooms: "Bedrooms",
    bathrooms: "Bathrooms",
    price: "Price",
    payment: "Payment",
    paymentPlan: "Payment plan",
    agent: "Agent",
    catalogue: "Property catalogue",
    comparison: "Unit comparison",
    unit: "Unit",
    beds: "Beds",
    page: "Page",
    of: "of",
  },
  ar: {
    project: "المشروع",
    area: "المساحة",
    bedrooms: "غرف النوم",
    bathrooms: "الحمامات",
    price: "السعر",
    payment: "الدفع",
    paymentPlan: "خطة السداد",
    agent: "الوكيل",
    catalogue: "كتالوج الوحدات",
    comparison: "مقارنة الوحدات",
    unit: "الوحدة",
    beds: "الغرف",
    page: "صفحة",
    of: "من",
  },
};

function drawUnitDetails(page: PDFPage, ctx: DrawCtx, u: BrochureUnit, yTop: number): number {
  const t = LABELS[ctx.locale];
  let y = yTop;
  const rows: Array<[string, string]> = [
    [t.project ?? "Project", u.project || "—"],
    [t.area ?? "Area", u.area != null ? `${fmtPlain(u.area)} m2` : "—"],
    [t.bedrooms ?? "Bedrooms", u.bedrooms != null ? String(u.bedrooms) : "—"],
    [t.bathrooms ?? "Bathrooms", u.bathrooms != null ? String(u.bathrooms) : "—"],
    [t.price ?? "Price", fmtMoney(u.price)],
  ];
  const instalment = installmentLine(u, ctx.locale === "ar");
  if (instalment) rows.push([t.payment ?? "Payment", instalment]);
  if (u.payment_plan) rows.push([t.paymentPlan ?? "Payment plan", u.payment_plan]);
  rows.push([t.agent ?? "Agent", `${u.agent || "—"} - ${u.agentPhone || ""}`.trim()]);

  const labelW = 110;
  const gap = 10;
  const valueW = CONTENT_W - labelW - gap;
  for (const [label, value] of rows) {
    if (ctx.rtl) {
      // Label on the right, value right-aligned to its left.
      drawText(page, ctx, label, PAGE_W - MARGIN, y, 11, "bold", INK, "right");
      y = drawWrapped(page, ctx, value, MARGIN, y, 11, valueW, "regular", INK);
      // drawWrapped right-aligns within [MARGIN, MARGIN+valueW]; the
      // value column ends at PAGE_W-MARGIN-labelW-gap, so shift the
      // wrapped block right by aligning to that edge instead:
      y -= 6;
    } else {
      drawText(page, ctx, label, MARGIN, y, 11, "bold");
      y = drawWrapped(page, ctx, value, MARGIN + labelW + gap, y, 11, valueW, "regular", INK);
      y -= 6;
    }
    page.drawLine({
      start: { x: MARGIN, y: y + 2 },
      end: { x: PAGE_W - MARGIN, y: y + 2 },
      thickness: 0.5,
      color: RULE,
    });
    y -= 8;
  }
  return y;
}

function drawFooter(page: PDFPage, ctx: DrawCtx, company: string, pageNo: number, total: number) {
  const t = LABELS[ctx.locale];
  const pageLabel =
    ctx.locale === "ar"
      ? `${t.page} ${pageNo} ${t.of} ${total}`
      : `${t.page} ${pageNo} ${t.of} ${total}`;
  if (ctx.rtl) {
    drawText(page, ctx, `${company} - Leadflow`, PAGE_W - MARGIN, 32, 9, "regular", MUTED, "right");
    drawText(page, ctx, pageLabel, MARGIN, 32, 9, "regular", MUTED, "left");
  } else {
    drawText(page, ctx, `${company} - Leadflow`, MARGIN, 32, 9, "regular", MUTED, "left");
    drawText(page, ctx, pageLabel, PAGE_W - MARGIN, 32, 9, "regular", MUTED, "right");
  }
}

async function drawUnitPage(
  doc: PDFDocument,
  ctx: DrawCtx,
  u: BrochureUnit,
  pageNo: number,
  total: number,
  opts?: BrochurePdfOptions,
): Promise<PDFPage> {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  drawText(
    page,
    ctx,
    u.company || "Leadflow",
    ctx.rtl ? PAGE_W - MARGIN : MARGIN,
    y,
    12,
    "bold",
    ACCENT,
    ctx.rtl ? "right" : "left",
  );
  y -= 30;
  y = drawWrapped(
    page,
    ctx,
    `${u.unit_code} - ${u.project || ""}`.trim(),
    MARGIN,
    y,
    22,
    CONTENT_W,
    "bold",
  );
  y -= 10;
  y = await drawCoverPhoto(doc, page, u.photos?.[0], y, opts);
  if (u.photos && u.photos.length > 1) {
    y = await drawGallery(doc, page, u.photos.slice(1), y, opts);
  }
  y = drawUnitDetails(page, ctx, u, y);
  if (!ctx.hasArabicFont) {
    y = drawWrapped(
      page,
      ctx,
      "Note: Arabic text is shown in Latin transliteration because the Arabic font could not be loaded. For full Arabic, use Print view.",
      MARGIN,
      y - 8,
      9,
      CONTENT_W,
      "regular",
      MUTED,
    );
  }
  drawFooter(page, ctx, u.company || "Leadflow", pageNo, total);
  return page;
}

function truncateToWidth(
  ctx: DrawCtx,
  text: string,
  weight: "regular" | "bold",
  size: number,
  maxWidth: number,
): string {
  const prepared = prepareText(ctx, text);
  if (mixedWidth(ctx, prepared, weight, size) <= maxWidth) return prepared;
  let clipped = prepared;
  while (clipped.length > 1 && mixedWidth(ctx, `${clipped}...`, weight, size) > maxWidth) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}...`;
}

function drawComparisonTable(
  page: PDFPage,
  ctx: DrawCtx,
  units: BrochureUnit[],
  yTop: number,
): number {
  const t = LABELS[ctx.locale];
  // Columns in logical order: Unit | Project | Area | Beds | Price.
  // In RTL the first logical column sits on the right.
  const logicalCols = [{ w: 100 }, { w: 155 }, { w: 70 }, { w: 50 }, { w: 124 }];
  const cols = logicalCols.map((c, i) => {
    const visualIndex = ctx.rtl ? logicalCols.length - 1 - i : i;
    const xBefore = logicalCols.slice(0, visualIndex).reduce((s, col) => s + col.w, 0);
    return { x: MARGIN + xBefore, w: c.w };
  });
  const rowH = 20;
  let y = yTop;
  drawText(
    page,
    ctx,
    t.comparison ?? "Unit comparison",
    ctx.rtl ? PAGE_W - MARGIN : MARGIN,
    y,
    14,
    "bold",
    INK,
    ctx.rtl ? "right" : "left",
  );
  y -= 8;
  const headerY = y - rowH;
  page.drawRectangle({
    x: MARGIN,
    y: headerY,
    width: CONTENT_W,
    height: rowH,
    color: rgb(0.93, 0.95, 0.97),
  });
  const headers = [
    t.unit ?? "Unit",
    t.project ?? "Project",
    t.area ?? "Area",
    t.beds ?? "Beds",
    t.price ?? "Price",
  ];
  headers.forEach((h, i) => {
    const col = cols[i];
    if (!col) return;
    drawText(page, ctx, h, col.x + 6, headerY + 6, 10, "bold");
  });
  y = headerY;
  for (const u of units) {
    y -= rowH;
    const values = [
      u.unit_code,
      u.project || "-",
      u.area != null ? `${fmtPlain(u.area)} m2` : "-",
      u.bedrooms != null ? String(u.bedrooms) : "-",
      u.price != null ? fmtMoney(u.price) : "-",
    ];
    values.forEach((v, i) => {
      const col = cols[i];
      if (!col) return;
      const text = truncateToWidth(ctx, v, "regular", 10, col.w - 12);
      // Cells are left-aligned within their column in both locales;
      // the column order itself is mirrored for RTL above.
      drawMixedLine(page, ctx, text, col.x + 6, y + 6, 10, "regular", INK, "left");
    });
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: RULE,
    });
  }
  return y - 16;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function buildFonts(
  doc: PDFDocument,
  locale: BrochureLocale,
  opts?: BrochurePdfOptions,
): Promise<DrawCtx> {
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    arabic: null,
  };
  let arabic: ArabicFonts | null = null;
  let arabicBytes: ArabicFontBytes | undefined;
  try {
    const bytes = opts?.arabicFontBytes ?? (await loadArabicFontBytes());
    if (bytes) {
      arabic = await embedArabicFonts(doc, bytes);
      if (arabic) arabicBytes = bytes;
    }
  } catch {
    arabic = null;
  }
  fonts.arabic = arabic;
  const ctx: DrawCtx = {
    locale,
    fonts,
    hasArabicFont: arabic !== null,
    rtl: locale === "ar",
  };
  // exactOptionalPropertyTypes: only set the key when the bytes exist.
  if (arabicBytes) ctx.arabicBytes = arabicBytes;
  return ctx;
}

/**
 * Finish a brochure document: flush (embeds the fonts) and patch the
 * Amiri /W widths, then save. Must run after all drawing, before the
 * bytes are returned. Without the patch, shaped Arabic renders ~2.3x
 * too wide and right-aligned text overflows the page.
 */
async function finalizePdf(doc: PDFDocument, ctx: DrawCtx): Promise<Uint8Array> {
  if (ctx.hasArabicFont && ctx.arabicBytes) {
    await finalizeArabicFonts(doc, ctx.arabicBytes);
  }
  return doc.save();
}

/**
 * One real PDF per set of units: exactly one page per unit, each with cover
 * title, project, area, bedrooms/bathrooms, price, down payment + monthly
 * instalment (when down_payment / installment_years are supplied), payment
 * plan, agent and company. Photos: the cover photo is embedded when its
 * bytes fetch and decode as JPEG/PNG, or as WebP converted to JPEG;
 * any failure skips the photo only. Arabic text is rendered shaped with
 * the embedded Amiri font when it loads. Returns real application/pdf
 * bytes (starts with %PDF).
 */
export async function generateBrochurePdf(
  units: BrochureUnit[],
  locale: BrochureLocale = "en",
  opts?: BrochurePdfOptions,
): Promise<Uint8Array> {
  validateUnits(units);
  const doc = await PDFDocument.create();
  const ctx = await buildFonts(doc, locale, opts);
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u) await drawUnitPage(doc, ctx, u, i + 1, units.length, opts);
  }
  return finalizePdf(doc, ctx);
}

/**
 * Multi-unit catalogue: page 1 carries the comparison table plus the first
 * unit's full details; each remaining unit gets its own page — so a catalogue
 * of N units is N pages (unless the table is so long the first unit no
 * longer fits on page 1, in which case it moves to page 2 and the total is
 * N+1; that only happens with very large catalogues).
 */
export async function generateCataloguePdf(
  units: BrochureUnit[],
  locale: BrochureLocale = "en",
  opts?: BrochurePdfOptions,
): Promise<Uint8Array> {
  validateUnits(units);
  const doc = await PDFDocument.create();
  const ctx = await buildFonts(doc, locale, opts);
  const first = units[0];
  if (!first) throw new Error("brochure_empty"); // unreachable: validateUnits checked
  const rest = units.slice(1);
  const firstPage = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  drawText(
    firstPage,
    ctx,
    first.company || "Leadflow",
    ctx.rtl ? PAGE_W - MARGIN : MARGIN,
    y,
    12,
    "bold",
    ACCENT,
    ctx.rtl ? "right" : "left",
  );
  y -= 30;
  y = drawWrapped(
    firstPage,
    ctx,
    LABELS[locale].catalogue ?? "Property catalogue",
    MARGIN,
    y,
    22,
    CONTENT_W,
    "bold",
  );
  y -= 10;
  y = drawComparisonTable(firstPage, ctx, units, y);
  // First unit's details share page 1 when they fit, otherwise page 2.
  if (y < 320) {
    drawFooter(firstPage, ctx, first.company || "Leadflow", 1, units.length + 1);
    await drawUnitPage(doc, ctx, first, 2, units.length + 1, opts);
    for (let i = 0; i < rest.length; i++) {
      const u = rest[i];
      if (u) await drawUnitPage(doc, ctx, u, i + 3, units.length + 1, opts);
    }
  } else {
    y = await drawCoverPhoto(doc, firstPage, first.photos?.[0], y, opts);
    if (first.photos && first.photos.length > 1) {
      y = await drawGallery(doc, firstPage, first.photos.slice(1), y, opts);
    }
    drawUnitDetails(firstPage, ctx, first, y);
    drawFooter(firstPage, ctx, first.company || "Leadflow", 1, units.length);
    for (let i = 0; i < rest.length; i++) {
      const u = rest[i];
      if (u) await drawUnitPage(doc, ctx, u, i + 2, units.length, opts);
    }
  }
  return finalizePdf(doc, ctx);
}

/** Trigger a browser download of already-generated PDF bytes. Browser only. */
export function downloadPdf(bytes: Uint8Array, filename: string): void {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("brochure_download_browser_only");
  }
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
