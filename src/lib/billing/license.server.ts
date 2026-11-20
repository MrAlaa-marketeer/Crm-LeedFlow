import { createHash, randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LICENSE_RANDOM_BYTES = 28;

export function createLicense() {
  // A 32-symbol alphabet gives five unbiased bits per symbol.
  const encoded = Array.from(randomBytes(LICENSE_RANDOM_BYTES), (byte) => alphabet[byte & 31]).join(
    "",
  );
  const code = "LEAD-" + encoded.match(/.{4}/g)!.join("-");
  return {
    code,
    digest: createHash("sha256").update(code, "utf8").digest("hex"),
    suffix: code.slice(-4),
  };
}
