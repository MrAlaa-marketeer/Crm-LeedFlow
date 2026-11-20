export type BrochureUnit = {
  unit_code: string;
  project: string;
  area: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  price: number | null;
  payment_plan: string | null;
  /** Optional: used by the real PDF generator for the instalment line. */
  down_payment?: number | null;
  /** Optional: instalment term in years, paired with down_payment. */
  installment_years?: number | null;
  photos: string[];
  agent: string;
  agentPhone: string;
  company: string;
};
const esc = (value: unknown) =>
  String(value ?? "—").replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
// Print view only: deliberately NO window.print() here. The old version
// auto-printed on load; the real PDF (see brochure-pdf.ts) is the download
// path, and this HTML is a secondary "Print view" the user prints manually.
export function brochureHtml(units: BrochureUnit[], locale: "ar" | "en") {
  const ar = locale === "ar";
  const title = ar ? "كتالوج الوحدات" : "Property catalog";
  return `<!doctype html><html lang="${locale}" dir="${ar ? "rtl" : "ltr"}"><meta charset="utf-8"><title>${title}</title><style>body{font:16px Arial,sans-serif;margin:0;color:#18212f}.unit{page-break-after:always;padding:32px}.cover{height:45vh;object-fit:cover;width:100%}h1{font-size:30px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:10px;text-align:start}.gallery{display:flex;gap:8px;flex-wrap:wrap}.gallery img{width:30%;height:180px;object-fit:cover}@media print{button{display:none}}</style><body>${units
    .map(
      (u, i) =>
        `<section class="unit"><h1>${esc(u.company)} · ${esc(u.unit_code)}</h1>${u.photos[0] ? `<img class="cover" src="${esc(u.photos[0])}">` : ""}<h2>${esc(u.project)}</h2><table><tr><th>${ar ? "المساحة" : "Area"}</th><td>${esc(u.area)} m²</td><th>${ar ? "غرف النوم" : "Bedrooms"}</th><td>${esc(u.bedrooms)}</td></tr><tr><th>${ar ? "الحمامات" : "Bathrooms"}</th><td>${esc(u.bathrooms)}</td><th>${ar ? "السعر" : "Price"}</th><td>${esc(u.price)} EGP</td></tr></table><p>${ar ? "خطة السداد" : "Payment plan"}: ${esc(u.payment_plan)}</p><div class="gallery">${u.photos
          .slice(1)
          .map((src) => `<img src="${esc(src)}">`)
          .join(
            "",
          )}</div><p>${ar ? "المسؤول" : "Agent"}: ${esc(u.agent)} · <bdi>${esc(u.agentPhone)}</bdi></p></section>`,
    )
    .join("")}</body></html>`;
}
