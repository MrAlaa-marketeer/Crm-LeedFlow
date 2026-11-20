# Arabic fonts for PDF brochures

- `Amiri-Regular.ttf` and `Amiri-Bold.ttf` — Amiri 1.001, a Naskh
  Arabic typeface by Khaled Hosny, licensed under the SIL Open Font
  License 1.1 (see `OFL.txt` in this folder).
- Source: https://github.com/aliftype/amiri/releases/tag/1.001
- Used by `src/lib/brochure-pdf.ts` (via `src/lib/arabic-font.ts`):
  the files are served as static assets from `/fonts/` and embedded
  in generated PDFs with pdf-lib + fontkit, so Arabic project names,
  areas, agent names and labels render as real connected Arabic.
- Do not delete these files: without them the PDF generator falls
  back to Helvetica + Latin transliteration.
