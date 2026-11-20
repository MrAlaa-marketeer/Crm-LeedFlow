// Generate the Arabic sample brochure PDF for visual verification.
//
//   bun scripts/generate-arabic-sample.ts [output.pdf]
//
// Creates a real WebP cover photo with PIL, then generates a 2-unit
// Arabic brochure. The WebP bytes are passed to the generator raw and
// converted through the `convertImage` option — in Node that conversion
// shells out to PIL; in the browser the same hook is the canvas path
// (see brochure-pdf.ts convertWebpViaCanvas). Font bytes are read from
// public/fonts/ and passed explicitly, because there is no HTTP server
// in this script's environment.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";
import { generateBrochurePdf } from "../src/lib/brochure-pdf";

const outPath =
  process.argv[2] ?? new URL("../../sample-arabic-brochure.pdf", import.meta.url).pathname;

/** Convert WebP bytes to JPEG bytes with PIL (the Node stand-in for the browser canvas path). */
function pilConvert(webpBytes: Uint8Array): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "leadflow-pdf-"));
  const src = join(dir, "photo.webp");
  const dst = join(dir, "photo.jpg");
  writeFileSync(src, webpBytes);
  const res = spawnSync(
    "python3",
    [
      "-c",
      "import sys; from PIL import Image; im = Image.open(sys.argv[1]).convert('RGB'); im.save(sys.argv[2], 'JPEG', quality=92)",
      src,
      dst,
    ],
    { encoding: "utf-8" },
  );
  if (res.status !== 0) throw new Error(`PIL WebP->JPEG failed: ${res.stderr}`);
  return new Uint8Array(readFileSync(dst));
}

function makeWebpPhoto(): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "leadflow-pdf-"));
  const dst = join(dir, "cover.webp");
  const res = spawnSync(
    "python3",
    [
      "-c",
      "import sys; from PIL import Image, ImageDraw; im = Image.new('RGB', (800, 500), (10, 90, 140)); d = ImageDraw.Draw(im); d.rectangle([60, 60, 740, 440], outline=(255, 200, 60), width=12); d.ellipse([300, 150, 500, 350], fill=(255, 200, 60)); im.save(sys.argv[1], 'WEBP', quality=90)",
      dst,
    ],
    { encoding: "utf-8" },
  );
  if (res.status !== 0) throw new Error(`PIL WebP creation failed: ${res.stderr}`);
  return new Uint8Array(readFileSync(dst));
}

function makePngPhoto(): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "leadflow-pdf-"));
  const dst = join(dir, "cover.png");
  const res = spawnSync(
    "python3",
    [
      "-c",
      "import sys; from PIL import Image, ImageDraw; im = Image.new('RGB', (800, 500), (140, 40, 60)); d = ImageDraw.Draw(im); d.rectangle([60, 60, 740, 440], outline=(255, 255, 255), width=12); im.save(sys.argv[1], 'PNG')",
      dst,
    ],
    { encoding: "utf-8" },
  );
  if (res.status !== 0) throw new Error(`PIL PNG creation failed: ${res.stderr}`);
  return new Uint8Array(readFileSync(dst));
}

const webpPhoto = makeWebpPhoto();
const pngPhoto = makePngPhoto();

const bytes = await generateBrochurePdf(
  [
    {
      unit_code: "UNIT-42",
      project: "القاهرة الجديدة",
      area: 120,
      bedrooms: 3,
      bathrooms: 2,
      price: 2500000,
      payment_plan: "أقساط على ٥ سنوات",
      down_payment: 500000,
      installment_years: 5,
      photos: ["https://example.test/cover.webp", "https://example.test/gallery.png"],
      agent: "أحمد محمد",
      agentPhone: "01012345678",
      company: "شركة النيل العقارية",
    },
    {
      unit_code: "UNIT-43",
      project: "كمبوند النخيل ٣",
      area: 95,
      bedrooms: 2,
      bathrooms: 1,
      price: 1800000,
      payment_plan: "أقساط على ٣ سنوات",
      down_payment: 360000,
      installment_years: 3,
      photos: ["https://example.test/cover.png"],
      agent: "سارة علي",
      agentPhone: "01123456789",
      company: "شركة النيل العقارية",
    },
  ],
  "ar",
  {
    arabicFontBytes: {
      regular: new Uint8Array(readFileSync("public/fonts/Amiri-Regular.ttf")),
      bold: new Uint8Array(readFileSync("public/fonts/Amiri-Bold.ttf")),
    },
    fetchPhotoBytes: async (url) => {
      if (url.endsWith(".webp")) return webpPhoto;
      if (url.endsWith(".png")) return pngPhoto;
      return null;
    },
    convertImage: async (webpBytes) => pilConvert(webpBytes),
  },
);

writeFileSync(outPath, bytes);
const doc = await PDFDocument.load(bytes);
console.log(`wrote ${outPath}`);
console.log(
  `bytes: ${bytes.length}, pages: ${doc.getPageCount()}, header: ${new TextDecoder().decode(bytes.slice(0, 5))}`,
);
