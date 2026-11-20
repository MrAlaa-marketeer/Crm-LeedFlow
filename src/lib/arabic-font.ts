// Amiri Arabic font loading for pdf-lib.
//
// Amiri (Regular + Bold) is vendored under public/fonts/ under the SIL
// Open Font License 1.1 (see public/fonts/OFL.txt). Amiri is a Naskh
// typeface with full Arabic presentation-form coverage, so shaped
// Arabic text drawn with it renders connected, right-to-left Arabic.
//
// pdf-lib can only embed a custom TTF with the help of fontkit, so
// @pdf-lib/fontkit (MIT) is registered once before embedding.
//
// pdf-lib /W caveat (this is why patchFontWidths below exists):
// pdf-lib writes the /W widths array of an embedded custom font from
// the glyphs reachable through the font's cmap (its characterSet).
// Arabic shaping (fontkit layout) produces presentation-form and
// ligature glyphs that no cmap code point maps to, so those glyph IDs
// are missing from /W. A PDF viewer that cannot find a glyph's width
// falls back to the default width of 1000 units, so shaped Arabic
// rendered ~2.3x too wide and right-aligned text overflowed the page
// (verified: "شركة النيل العقارية" measured 76pt by
// widthOfTextAtSize but rendered ~175pt wide). patchFontWidths rewrites
// /W after embedding to cover every glyph in the font with its nominal
// advance, which makes the rendered width match the measured width.
// The ToUnicode CMap has the same cmap-only limitation, so text
// extraction of Arabic from the PDF is still unreliable — shaping is
// verified by rendering the PDF to an image, not by pdftotext.
//
// Loading strategy: the generator runs in the browser, where the font
// files are served as static assets from /fonts/. Tests and scripts
// that run in Node pass the font bytes explicitly via
// BrochurePdfOptions.arabicFontBytes (read from public/fonts/ with fs),
// because there is no HTTP server in those environments. If loading
// fails for any reason (offline, missing file), the caller falls back
// to the old Helvetica + transliteration path and the PDF still
// generates — it just is not Arabic-shaped.
import { PDFDocument, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

export interface ArabicFontBytes {
  regular: Uint8Array;
  bold: Uint8Array;
}

export interface ArabicFonts {
  regular: PDFFont;
  bold: PDFFont;
}

const FONT_BASE = "fonts/Amiri-";

// pdf-lib's registerFontkit is an instance method on the document
// (doc.registerFontkit(fontkit)), not a static on PDFDocument.
function registerFontkit(doc: PDFDocument): void {
  try {
    doc.registerFontkit(fontkit);
  } catch {
    // Registration failure is handled by the caller falling back.
  }
}

async function fetchFontBytes(url: string): Promise<Uint8Array | null> {
  try {
    const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof fetchFn !== "function") return null;
    const res = await fetchFn(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function fontUrl(name: string): string {
  // Vite serves public/ at the app base. In the browser, resolve
  // against the current page so a non-root base path still works.
  const base =
    (globalThis as { location?: { href?: string } }).location?.href ?? "http://localhost/";
  try {
    return new URL(`/${FONT_BASE}${name}`, base).toString();
  } catch {
    return `/${FONT_BASE}${name}`;
  }
}

/** Load the vendored Amiri TTF bytes (browser fetch). Returns null on failure. */
export async function loadArabicFontBytes(): Promise<ArabicFontBytes | null> {
  const [regular, bold] = await Promise.all([
    fetchFontBytes(fontUrl("Regular.ttf")),
    fetchFontBytes(fontUrl("Bold.ttf")),
  ]);
  if (!regular || !bold || regular.length === 0 || bold.length === 0) return null;
  return { regular, bold };
}

type FontkitFontLike = {
  unitsPerEm: number;
  numGlyphs: number;
  getGlyph: (id: number) => { advanceWidth: number };
};

type PdfDictLike = {
  entries: () => [unknown, unknown][];
  set: (key: unknown, value: unknown) => void;
};

function pdfNameString(value: unknown): string {
  const candidate = value as { value?: () => string };
  // Call value() as a method on the object: PDFName.value() reads
  // this.encodedName, so an unbound call throws. Note value() returns
  // the encoded name WITH its leading slash ("/CIDFontType2"), so the
  // slash is stripped here — comparing against the bare name.
  const text =
    candidate && typeof candidate.value === "function" ? candidate.value() : String(value ?? "");
  return text.startsWith("/") ? text.slice(1) : text;
}

/**
 * Rewrite the /W widths array of an embedded Amiri font so it covers
 * every glyph in the font (not just the cmap-reachable ones pdf-lib
 * writes). Without this, shaped Arabic glyphs have no width entry and
 * viewers fall back to 1000 units, spreading the text ~2.3x too wide.
 *
 * Uses only pdf-lib's public surface (PDFDocument.context,
 * PDFContext.obj, PDFDict.entries/set) plus a runtime-only cast to
 * reach the context's indirect-object map, which pdf-lib does not
 * expose in its types. A failure here is non-fatal: the caller falls
 * back to Helvetica instead of producing a broken-width Arabic PDF.
 */
export function patchFontWidths(doc: PDFDocument, fontBytes: Uint8Array, customName: string): void {
  let font: FontkitFontLike;
  try {
    font = fontkit.create(fontBytes) as unknown as FontkitFontLike;
  } catch {
    return;
  }
  const scale = 1000 / font.unitsPerEm;
  const widths: number[] = [];
  for (let id = 0; id < font.numGlyphs; id++) {
    widths.push(Math.round(font.getGlyph(id).advanceWidth * scale));
  }
  const context = doc.context as unknown as {
    indirectObjects: Map<unknown, unknown>;
    obj: (value: unknown) => unknown;
  };
  const objects = context.indirectObjects;
  if (!objects || typeof context.obj !== "function") return;
  for (const obj of objects.values()) {
    const dict = obj as PdfDictLike;
    if (!dict || typeof dict.entries !== "function" || typeof dict.set !== "function") {
      continue;
    }
    const entries = dict.entries();
    const find = (name: string): unknown =>
      entries.find(([key]) => pdfNameString(key) === name)?.[1];
    // pdf-lib names the embedded font "Amiri-Regular-<random suffix>"
    // (no customName is passed at embed time), so match by prefix.
    // "Amiri-Regular" cannot prefix-match the Bold dict and vice versa.
    if (
      pdfNameString(find("Subtype")) !== "CIDFontType2" ||
      !pdfNameString(find("BaseFont")).startsWith(customName)
    ) {
      continue;
    }
    const wKey = entries.find(([key]) => pdfNameString(key) === "W")?.[0];
    if (!wKey) return;
    dict.set(wKey, context.obj([0, widths]));
  }
}

/**
 * Embed the Amiri fonts in a PDFDocument. Returns null when the bytes
 * cannot be embedded (caller must fall back to Helvetica).
 *
 * Note: this only creates the embedders — pdf-lib writes the font
 * dictionaries (and their /W arrays) into the document context during
 * flush(), which save() calls first. So the /W patch cannot run here;
 * call finalizeArabicFonts() after drawing, before the final save().
 */
export async function embedArabicFonts(
  doc: PDFDocument,
  bytes: ArabicFontBytes,
): Promise<ArabicFonts | null> {
  try {
    registerFontkit(doc);
    const regular = await doc.embedFont(bytes.regular);
    const bold = await doc.embedFont(bytes.bold);
    return { regular, bold };
  } catch {
    return null;
  }
}

/**
 * Flush the document (embeds the fonts, creating their dictionaries)
 * and then patch the /W widths of both Amiri fonts. Call after all
 * drawing, before the final doc.save(). The save's own flush is a
 * no-op for already-embedded fonts (PDFFont.embed checks `modified`),
 * so the patched /W survives into the saved file.
 */
export async function finalizeArabicFonts(doc: PDFDocument, bytes: ArabicFontBytes): Promise<void> {
  await doc.flush();
  patchFontWidths(doc, bytes.regular, "Amiri-Regular");
  patchFontWidths(doc, bytes.bold, "Amiri-Bold");
}
