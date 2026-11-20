import { useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { LanguageToggle } from "@/components/app/language-toggle";
import { Logo } from "@/components/app/logo";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { validateCapture } from "@/lib/speed-to-lead";

export const Route = createFileRoute("/lead-capture")({
  validateSearch: (search: Record<string, unknown>) => ({
    workspace: typeof search["workspace"] === "string" ? search["workspace"] : "",
  }),
  head: () => ({ meta: [{ title: "LeadFlow | Contact us" }] }),
  component: LeadCapturePage,
});

function LeadCapturePage() {
  const { t, dir } = useI18n();
  const { workspace } = Route.useSearch();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    budget: "",
    preferredArea: "",
    project: "",
    source: "website",
    honeypot: "",
  });
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = validateCapture(form);
    setError(result.errors[0] ?? "");
    if (result.errors.length || !result.phone || !workspace) {
      if (!workspace) setError("captureUnavailable");
      return;
    }
    setBusy(true);
    const { error: dbError } = await (supabase as any).rpc("capture_lead", {
      _workspace_id: workspace,
      _full_name: form.name,
      _phone: result.phone,
      _budget_min: result.budget,
      _preferred_area: form.preferredArea,
      _project: form.project,
      _source: form.source,
      _honeypot: form.honeypot,
    });
    setBusy(false);
    if (dbError) {
      setError(/rate limit/i.test(dbError.message) ? "captureRateLimit" : "somethingWrong");
      return;
    }
    setDone(true);
  }
  return (
    <main dir={dir} className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between">
          <Logo />
          <LanguageToggle variant="ghost" />
        </div>
        {done ? (
          <div className="py-12 text-center">
            <h1 className="text-2xl font-bold">{t("captureThanks")}</h1>
            <p className="mt-2 text-muted-foreground">{t("captureThanksBody")}</p>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={submit}>
            <div>
              <h1 className="text-2xl font-bold">{t("captureTitle")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("captureSubtitle")}</p>
            </div>
            <div>
              <Label htmlFor="capture-name">{t("fullName")}</Label>
              <Input
                id="capture-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="capture-phone">{t("phone")}</Label>
              <Input
                id="capture-phone"
                required
                dir="ltr"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="capture-budget">{t("budgetMin")}</Label>
              <Input
                id="capture-budget"
                dir="ltr"
                inputMode="numeric"
                value={form.budget}
                onChange={(e) => setForm({ ...form, budget: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="capture-area">{t("preferredArea")}</Label>
              <Input
                id="capture-area"
                value={form.preferredArea}
                onChange={(e) => setForm({ ...form, preferredArea: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="capture-project">{t("interestedProject")}</Label>
              <Input
                id="capture-project"
                value={form.project}
                onChange={(e) => setForm({ ...form, project: e.target.value })}
              />
            </div>
            <NativeSelect
              aria-label={t("source")}
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              <option value="website">{t("source_website")}</option>
              <option value="facebook">{t("source_facebook")}</option>
              <option value="instagram">{t("source_instagram")}</option>
              <option value="whatsapp">{t("source_whatsapp")}</option>
            </NativeSelect>
            <div aria-hidden="true" className="absolute -left-[9999px]">
              <Label htmlFor="capture-company">Company</Label>
              <Input
                id="capture-company"
                tabIndex={-1}
                autoComplete="off"
                value={form.honeypot}
                onChange={(e) => setForm({ ...form, honeypot: e.target.value })}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {t(error as any)}
              </p>
            )}
            <Button disabled={busy} type="submit">
              {t(busy ? "saving" : "captureSubmit")}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
