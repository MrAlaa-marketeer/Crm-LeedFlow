import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { brochureHtml, type BrochureUnit } from "./brochure";
import {
  brochureFileName,
  generateBrochurePdf,
  generateCataloguePdf,
  splitRuns,
} from "./brochure-pdf";
import { containsShapedArabic, reshapeArabicWord, toVisual } from "./arabic-text";
import type { ArabicFontBytes } from "./arabic-font";

// Amiri TTFs vendored under public/fonts/ (see that folder's README).
// Read from the project root: import.meta.url is not a file:// URL
// under vitest, so resolve from the working directory instead.
function arabicFontBytes(): ArabicFontBytes {
  return {
    regular: new Uint8Array(readFileSync(join(process.cwd(), "public/fonts/Amiri-Regular.ttf"))),
    bold: new Uint8Array(readFileSync(join(process.cwd(), "public/fonts/Amiri-Bold.ttf"))),
  };
}

const unit = (overrides: Partial<BrochureUnit> = {}): BrochureUnit => ({
  unit_code: "UNIT-42",
  project: "Cairo Hills",
  area: 120,
  bedrooms: 3,
  bathrooms: 2,
  price: 2500000,
  payment_plan: null,
  down_payment: 500000,
  installment_years: 5,
  photos: [],
  agent: "Agent One",
  agentPhone: "01012345678",
  company: "Acme Realty",
  ...overrides,
});

// pdf-lib writes drawn text inside Flate-compressed content streams, so
// plain byte search cannot see it. Inflate the streams and return the
// content streams as text. Helvetica text appears as literal strings
// ("(Project) Tj"); custom-font (Amiri) text appears as 2-byte glyph
// IDs in <hex> Tj strings, whose ToUnicode CMaps are per-font —
// Regular and Bold share CID numbers for different glyphs, so a single
// merged map would decode them wrong. The tests therefore assert on
// the structure instead of decoding Arabic from the text layer:
//   * an Amiri font dictionary is present in an inflated object stream,
//   * Arabic runs are drawn with an /Amiri-* font (Tf operators),
//   * Latin runs (phone number) appear verbatim and unreversed.
// Visual correctness (connected letters, RTL order) is verified by
// rendering the sample PDF to PNG and inspecting it (see the report).
function pdfStreams(bytes: Uint8Array): string[] {
  const latin = Buffer.from(bytes).toString("latin1");
  const out: string[] = [];
  for (const m of latin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const raw = m[1] ?? "";
    try {
      out.push(inflateSync(Buffer.from(raw, "latin1")).toString("latin1"));
    } catch {
      // not a Flate stream: skip
    }
  }
  return out;
}

function pdfContentStreams(bytes: Uint8Array): string {
  return pdfStreams(bytes)
    .filter(
      (text) =>
        /\bBT\b/.test(text) && /\bET\b/.test(text) && /\bTf\b/.test(text) && /Tj/.test(text),
    )
    .join("\n");
}

function pdfHasAmiriFont(bytes: Uint8Array): boolean {
  return pdfStreams(bytes).some((text) => text.includes("/Amiri-"));
}

function pdfVisibleText(bytes: Uint8Array): string {
  const content = pdfContentStreams(bytes);
  return content.replace(/<([0-9A-Fa-f]+)>/g, (_, hex: string) =>
    Buffer.from(hex, "hex").toString("latin1"),
  );
}

function imageCount(bytes: Uint8Array): number {
  return (
    Buffer.from(bytes)
      .toString("latin1")
      .match(/\/Subtype\s*\/Image/g) ?? []
  ).length;
}

// Read the /W widths arrays of the embedded Amiri fonts back out of a
// generated PDF (via pdf-lib's own loader), keyed by the font's base
// name. This is the regression check for the pdf-lib /W gap: shaped
// Arabic glyphs are not cmap-reachable, so without the patch their
// widths are missing and viewers fall back to 1000 units.
async function pdfAmiriWidths(bytes: Uint8Array): Promise<Map<string, Map<number, number>>> {
  const doc = await PDFDocument.load(bytes);
  const context = doc.context as unknown as {
    indirectObjects: Map<unknown, unknown>;
  };
  const out = new Map<string, Map<number, number>>();
  const nameOf = (value: unknown): string => {
    const candidate = value as { value?: () => string };
    // Call value() as a method on the object: PDFName.value() reads
    // this.encodedName, so an unbound call throws. value() returns the
    // encoded name WITH its leading slash ("/CIDFontType2"), so strip it.
    const text =
      candidate && typeof candidate.value === "function" ? candidate.value() : String(value ?? "");
    return text.startsWith("/") ? text.slice(1) : text;
  };
  for (const obj of context.indirectObjects.values()) {
    const dict = obj as {
      entries?: () => [unknown, unknown][];
    };
    if (!dict || typeof dict.entries !== "function") continue;
    const entries = dict.entries();
    const find = (name: string): unknown => entries.find(([key]) => nameOf(key) === name)?.[1];
    if (nameOf(find("Subtype")) !== "CIDFontType2") continue;
    const baseFont = nameOf(find("BaseFont"));
    if (!baseFont.startsWith("Amiri-")) continue;
    const w = find("W") as {
      asArray?: () => unknown[];
    };
    if (!w || typeof w.asArray !== "function") continue;
    const widths = new Map<number, number>();
    const items = w.asArray();
    for (let i = 0; i < items.length; i++) {
      const first = items[i] as { asNumber?: () => number };
      const second = items[i + 1] as { asArray?: () => unknown[]; asNumber?: () => number };
      if (typeof first?.asNumber !== "function") continue;
      const firstNum = first.asNumber();
      if (second && typeof second.asArray === "function") {
        const arr = second.asArray();
        arr.forEach((entry, j) => {
          const n = entry as { asNumber?: () => number };
          if (typeof n?.asNumber === "function") {
            widths.set(firstNum + j, n.asNumber());
          }
        });
        i += 1;
      } else if (second && typeof second.asNumber === "function") {
        const third = items[i + 2] as { asNumber?: () => number };
        if (third && typeof third.asNumber === "function") {
          for (let cid = firstNum; cid <= second.asNumber(); cid++) {
            widths.set(cid, third.asNumber());
          }
          i += 2;
        }
      }
    }
    out.set(baseFont, widths);
  }
  return out;
}

const headerOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(0, 5));

// 1x1 transparent PNG (valid bytes for the embed path).
const ONE_PX_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("bidi run splitting", () => {
  it("keeps a separator between an Arabic run and a Latin run as its own run", () => {
    // The " - " must not stay attached to the Latin run: in RTL it
    // would then render at the far right, after UNIT-42, instead of
    // between the project name and the unit code (python-bidi
    // reference: visual order is [Arabic][ - ][UNIT-42]).
    expect(splitRuns("UNIT-42 - القاهرة الجديدة", true)).toEqual([
      { text: "UNIT-42", arabic: false },
      { text: " - ", arabic: false },
      { text: "القاهرة الجديدة", arabic: true },
    ]);
    expect(splitRuns("أحمد محمد - 01012345678", true)).toEqual([
      { text: "أحمد محمد", arabic: true },
      { text: " - ", arabic: false },
      { text: "01012345678", arabic: false },
    ]);
  });

  it("keeps neutrals inside a number and inside an Arabic phrase", () => {
    // Neutrals between two runs of the same kind join them, so a
    // number and an Arabic phrase stay single runs.
    expect(splitRuns("أحمد محمد", true)).toEqual([{ text: "أحمد محمد", arabic: true }]);
    expect(splitRuns("33,333.33", true)).toEqual([{ text: "33,333.33", arabic: false }]);
    expect(splitRuns("Cairo Hills", true)).toEqual([{ text: "Cairo Hills", arabic: false }]);
  });

  it("never splits an alphanumeric token such as m2", () => {
    // "120 m2" splits at the space (digits then letters), but the
    // "m2" token itself must stay one run — splitting it would let
    // RTL reversal render it as "2m".
    expect(splitRuns("120 m2", true)).toEqual([
      { text: "120", arabic: false },
      { text: " ", arabic: false },
      { text: "m2", arabic: false },
    ]);
    expect(splitRuns("UNIT-42", true)).toEqual([{ text: "UNIT-42", arabic: false }]);
  });

  it("splits digits-then-letters but not letters-then-digits (UBA numbers)", () => {
    // In an RTL paragraph letters display to the left of adjacent
    // digits: "500,000 EGP" renders as "EGP 500,000", while
    // "EGP 500" stays as it is. Verified against python-bidi.
    expect(splitRuns("500,000 EGP", true)).toEqual([
      { text: "500,000", arabic: false },
      { text: " ", arabic: false },
      { text: "EGP", arabic: false },
    ]);
    expect(splitRuns("EGP 500", true)).toEqual([{ text: "EGP 500", arabic: false }]);
    expect(splitRuns("EGP - 33,333.33", true)).toEqual([
      { text: "EGP - 33,333.33", arabic: false },
    ]);
    expect(splitRuns("500,000 EGP - 33,333.33", true)).toEqual([
      { text: "500,000", arabic: false },
      { text: " ", arabic: false },
      { text: "EGP - 33,333.33", arabic: false },
    ]);
  });

  it("keeps a price as one run in a left-to-right paragraph", () => {
    // No bidi reordering in LTR, so the price stays a single Tj and
    // stays searchable as one string.
    expect(splitRuns("2,500,000 EGP")).toEqual([{ text: "2,500,000 EGP", arabic: false }]);
    expect(splitRuns("UNIT-42 - Cairo Hills")).toEqual([
      { text: "UNIT-42 - Cairo Hills", arabic: false },
    ]);
  });
});

describe("unit brochures", () => {
  it("escapes content and supports gallery and multi-unit catalog", () => {
    const html = brochureHtml(
      [
        {
          unit_code: "<script>",
          project: "A",
          area: 100,
          bedrooms: 2,
          bathrooms: 1,
          price: 500,
          payment_plan: null,
          photos: ["https://example.test/a.webp", "https://example.test/b.webp"],
          agent: "Agent",
          agentPhone: "010",
          company: "Co",
        },
        {
          unit_code: "B",
          project: "B",
          area: null,
          bedrooms: null,
          bathrooms: null,
          price: null,
          payment_plan: null,
          photos: [],
          agent: "A",
          agentPhone: "",
          company: "C",
        },
      ],
      "en",
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html.match(/class="unit"/g)).toHaveLength(2);
    expect(html).toContain("https://example.test/b.webp");
  });

  it("print view no longer auto-prints", () => {
    expect(brochureHtml([unit()], "en")).not.toContain("window.print");
  });
});

describe("arabic shaping and visual order", () => {
  it("shapes connected letters with presentation forms", () => {
    const shaped = reshapeArabicWord("القاهرة");
    expect(containsShapedArabic(shaped)).toBe(true);
    // Not the disconnected logical letters any more.
    expect(shaped).not.toContain("ا");
    expect(shaped).not.toContain("ق");
  });

  it("forms the lam-alef ligature", () => {
    const shaped = reshapeArabicWord("السلام");
    // U+FEFB (isolated lam-alef) or U+FEFC (final lam-alef).
    expect(/[\uFEFB\uFEFC]/.test(shaped)).toBe(true);
  });

  it("keeps Arabic-Indic digits in order inside a word", () => {
    const visual = toVisual("شقة ٣ غرف");
    expect(visual).toContain("٣");
    // Reading order (right to left): شقة, ٣, غرف — so the visual
    // left-to-right order is the reverse of the logical order.
    expect(visual.indexOf("٣")).toBeGreaterThan(0);
  });

  it("keeps Latin phrases together inside an Arabic sentence", () => {
    const visual = toVisual("القاهرة Cairo Hills");
    expect(visual).toContain("Cairo Hills");
    // Latin phrase sits on the left, Arabic on the right.
    expect(visual.startsWith("Cairo Hills")).toBe(true);
    expect(containsShapedArabic(visual)).toBe(true);
  });

  it("leaves pure Latin text unchanged", () => {
    expect(toVisual("Cairo Hills 2500000")).toBe("Cairo Hills 2500000");
  });
});

describe("real PDF brochures", () => {
  it("generates real %PDF bytes with unit code, price and instalment as text", async () => {
    const bytes = await generateBrochurePdf([unit()], "en");
    expect(headerOf(bytes)).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const text = pdfVisibleText(bytes);
    expect(text).toContain("UNIT-42");
    expect(text).toContain("Cairo Hills");
    expect(text).toContain("2,500,000 EGP");
    // (2,500,000 - 500,000) / 60 months = 33,333.33 EGP/month.
    expect(text).toContain("33,333.33");
    expect(text).toContain("Down payment: 500,000 EGP");
    expect(text).toContain("Agent One");
    expect(text).toContain("Acme Realty");
  });

  it("multi-unit brochure has exactly one page per unit", async () => {
    const bytes = await generateBrochurePdf(
      [unit(), unit({ unit_code: "UNIT-43" }), unit({ unit_code: "UNIT-44" })],
      "en",
    );
    expect(headerOf(bytes)).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    const text = pdfVisibleText(bytes);
    expect(text).toContain("UNIT-43");
    expect(text).toContain("UNIT-44");
  });

  it("catalogue has N pages with a comparison table", async () => {
    const units = [
      unit(),
      unit({ unit_code: "UNIT-43", price: 1800000 }),
      unit({ unit_code: "UNIT-44", price: 990000 }),
    ];
    const bytes = await generateCataloguePdf(units, "en");
    expect(headerOf(bytes)).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    const text = pdfVisibleText(bytes);
    expect(text).toContain("Unit comparison");
    expect(text).toContain("UNIT-42");
    expect(text).toContain("UNIT-43");
    expect(text).toContain("UNIT-44");
    expect(text).toContain("1,800,000 EGP");
  });

  it("throws on invalid input", async () => {
    await expect(generateBrochurePdf([], "en")).rejects.toThrow("brochure_empty");
    await expect(generateBrochurePdf([unit({ unit_code: "  " })], "en")).rejects.toThrow(
      "brochure_invalid_unit",
    );
    await expect(generateCataloguePdf([], "en")).rejects.toThrow("brochure_empty");
  });

  it("still generates when the cover photo cannot be fetched", async () => {
    const bytes = await generateBrochurePdf(
      [unit({ photos: ["https://example.test/missing.jpg"] })],
      "en",
      { fetchPhotoBytes: async () => Promise.reject(new Error("offline")) },
    );
    expect(headerOf(bytes)).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("embeds a fetchable JPEG/PNG cover photo", async () => {
    const withPng = await generateBrochurePdf(
      [unit({ photos: ["https://example.test/cover.png"] })],
      "en",
      { fetchPhotoBytes: async () => ONE_PX_PNG },
    );
    expect(headerOf(withPng)).toBe("%PDF-");
    expect((await PDFDocument.load(withPng)).getPageCount()).toBe(1);
    // A PNG with an alpha channel embeds an extra SMask image object,
    // so assert at least one image rather than exactly one.
    expect(imageCount(withPng)).toBeGreaterThanOrEqual(1);
  });

  it("converts WebP to an embeddable image when a converter is given", async () => {
    // Real WebP header bytes (RIFF....WEBP): pdf-lib cannot embed them.
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    // With a converter (browser canvas in production, injected here),
    // the converted bytes are embedded instead of skipped.
    const converted = await generateBrochurePdf(
      [unit({ photos: ["https://example.test/cover.webp"] })],
      "en",
      {
        fetchPhotoBytes: async () => webp,
        convertImage: async () => ONE_PX_PNG,
      },
    );
    expect(headerOf(converted)).toBe("%PDF-");
    expect(imageCount(converted)).toBeGreaterThanOrEqual(1);

    // Without a converter and without a canvas (Node), the WebP is
    // skipped and the PDF still generates.
    const skipped = await generateBrochurePdf(
      [unit({ photos: ["https://example.test/cover.webp"] })],
      "en",
      { fetchPhotoBytes: async () => webp },
    );
    expect(headerOf(skipped)).toBe("%PDF-");
    expect(imageCount(skipped)).toBe(0);
  });

  it("renders real shaped Arabic with the embedded Amiri font", async () => {
    const bytes = await generateBrochurePdf(
      [
        unit({
          project: "القاهرة الجديدة",
          company: "شركة النيل العقارية",
          agent: "أحمد محمد",
        }),
      ],
      "ar",
      { arabicFontBytes: arabicFontBytes() },
    );
    expect(headerOf(bytes)).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    // The Amiri font is embedded: ~400KB (the whole TTF is embedded,
    // pdf-lib does not subset it) versus ~2KB for a Helvetica-only PDF.
    expect(bytes.length).toBeGreaterThan(100_000);
    expect(pdfHasAmiriFont(bytes)).toBe(true);
    const content = pdfContentStreams(bytes);
    // Arabic runs are drawn with Amiri (company, title, values, labels).
    expect((content.match(/\/Amiri-/g) ?? []).length).toBeGreaterThanOrEqual(5);
    const text = pdfVisibleText(bytes);
    // The phone number is drawn as its own Helvetica run and must NOT
    // be reversed (the fontkit RTL bug this fix works around).
    expect(text).toContain("01012345678");
    expect(text).not.toContain("87654321010");
    expect(text).not.toContain("24-TINU");
    // No transliteration fallback any more.
    expect(text).not.toContain("alqahra");
    expect(text).not.toContain("Latin transliteration");
  });

  it("renders Arabic values on an English page too", async () => {
    const bytes = await generateBrochurePdf(
      [unit({ project: "مدينة نصر", agent: "أحمد محمد" })],
      "en",
      { arabicFontBytes: arabicFontBytes() },
    );
    expect(headerOf(bytes)).toBe("%PDF-");
    expect(pdfHasAmiriFont(bytes)).toBe(true);
    const content = pdfContentStreams(bytes);
    expect((content.match(/\/Amiri-/g) ?? []).length).toBeGreaterThanOrEqual(2);
    const text = pdfVisibleText(bytes);
    expect(text).toContain("Project");
    expect(text).toContain("01012345678");
  });

  it("writes /W widths for the shaped Arabic glyphs it draws", async () => {
    // Regression test for the pdf-lib /W gap (see arabic-font.ts):
    // without the patch, the shaped glyphs of the company name have no
    // /W entry and viewers fall back to 1000 units, rendering the text
    // ~2.3x too wide and overflowing right-aligned text off the page.
    const bytes = await generateBrochurePdf([unit({ company: "شركة النيل العقارية" })], "ar", {
      arabicFontBytes: arabicFontBytes(),
    });
    const widthsByFont = await pdfAmiriWidths(bytes);
    expect(widthsByFont.size).toBeGreaterThanOrEqual(1);
    const boldBytes = arabicFontBytes().bold;
    const fkFont = fontkit.create(boldBytes) as unknown as {
      unitsPerEm: number;
      layout: (text: string) => {
        glyphs: { id: number; advanceWidth: number }[];
      };
    };
    const scale = 1000 / fkFont.unitsPerEm;
    // The company name is drawn in bold, so check the Bold font's /W
    // map specifically: Regular and Bold have different glyph IDs and
    // advances, and both maps cover every ID after the patch, so the
    // map must be selected by font, not just by ID presence.
    const boldWidths = [...widthsByFont.entries()].find(([name]) =>
      name.startsWith("Amiri-Bold"),
    )?.[1];
    expect(boldWidths).toBeDefined();
    for (const glyph of fkFont.layout("شركة النيل العقارية").glyphs) {
      expect(boldWidths?.get(glyph.id)).toBe(Math.round(glyph.advanceWidth * scale));
    }
  });

  it("falls back to transliteration when the Arabic font cannot load", async () => {
    const bytes = await generateBrochurePdf(
      [unit({ project: "القاهرة", company: "شركة النيل" })],
      "ar",
      // No font bytes and no fetchable font in Node: loadArabicFontBytes
      // returns null, so the Helvetica fallback is used.
      {},
    );
    expect(headerOf(bytes)).toBe("%PDF-");
    const text = pdfVisibleText(bytes);
    expect(text).toContain("alqahra");
    expect(text).toContain("Latin transliteration");
  });

  it("names files per unit or as catalogue", () => {
    expect(brochureFileName([unit()])).toBe("leadflow-brochure-UNIT-42.pdf");
    expect(brochureFileName([unit(), unit({ unit_code: "UNIT-43" })])).toBe(
      "leadflow-catalogue.pdf",
    );
  });
});
