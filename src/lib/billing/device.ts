export function deviceId(): string {
  const storageKey = "leadflow.installation";
  const saved = localStorage.getItem(storageKey);
  if (saved && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(saved)) return saved;
  const id = crypto.randomUUID();
  localStorage.setItem(storageKey, id);
  return id;
}
