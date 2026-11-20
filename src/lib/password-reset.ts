export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidResetEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function validateNewPassword(
  password: string,
  confirmation: string,
): "passwordMin" | "passwordsDontMatch" | null {
  if (password.length < 8) return "passwordMin";
  if (password !== confirmation) return "passwordsDontMatch";
  return null;
}
