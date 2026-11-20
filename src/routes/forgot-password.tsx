import { useState, type FormEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/app/states";
import { LanguageToggle } from "@/components/app/language-toggle";
import { Logo } from "@/components/app/logo";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { isValidResetEmail } from "@/lib/password-reset";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password — LeadFlow" },
      { name: "description", content: "Request a LeadFlow password reset link." },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<"invalidEmail" | "resetRequestError" | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSent(false);
    if (!isValidResetEmail(email)) {
      setError("invalidEmail");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (requestError) setError("resetRequestError");
      else setSent(true);
    } catch {
      setError("resetRequestError");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-hero">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
        <Link to="/" aria-label={t("goHome")}>
          <Logo className="text-lg" />
        </Link>
        <LanguageToggle variant="ghost" />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6">
        <section className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-elevated sm:p-8">
          <h1 className="text-2xl font-bold">{t("forgotPasswordTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("forgotPasswordHint")}</p>
          {sent ? (
            <div role="status" className="mt-6 rounded-lg border bg-success-soft p-4 text-sm">
              {t("resetSent")}
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="mt-6 space-y-4">
              <div>
                <Label htmlFor="reset-email">{t("email")} *</Label>
                <Input
                  id="reset-email"
                  type="email"
                  dir="ltr"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={error === "invalidEmail" || undefined}
                  aria-describedby="reset-email-error"
                  className="mt-1.5 text-start"
                />
                <FieldError
                  id="reset-email-error"
                  message={error === "invalidEmail" ? t(error) : undefined}
                />
              </div>
              {error === "resetRequestError" && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive"
                >
                  {t(error)}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? t("loading") : t("sendResetLink")}
              </Button>
            </form>
          )}
          <Link
            to="/auth"
            search={{ mode: "signin" }}
            className="mt-5 inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t("backToSignIn")}
          </Link>
        </section>
      </main>
    </div>
  );
}
