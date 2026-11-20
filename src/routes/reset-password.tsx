import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/app/states";
import { LanguageToggle } from "@/components/app/language-toggle";
import { Logo } from "@/components/app/logo";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { validateNewPassword } from "@/lib/password-reset";
import type { DictKey } from "@/lib/i18n-dict";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — LeadFlow" },
      { name: "description", content: "Choose a new password for your LeadFlow account." },
    ],
  }),
  component: ResetPasswordPage,
});

type RecoveryState = "checking" | "ready" | "invalid" | "updated";

function ResetPasswordPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [recovery, setRecovery] = useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<
    Partial<Record<"password" | "confirmation" | "form", DictKey>>
  >({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" && session) setRecovery("ready");
    });

    // Supabase validates the recovery link and emits PASSWORD_RECOVERY. An
    // ordinary existing sign-in session is intentionally not enough here.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.has("error") || hash.has("error_description")) setRecovery("invalid");
    const timer = window.setTimeout(() => {
      if (active) setRecovery((state) => (state === "checking" ? "invalid" : state));
    }, 12_000);

    return () => {
      active = false;
      window.clearTimeout(timer);
      data.subscription.unsubscribe();
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validateNewPassword(password, confirmation);
    if (validation) {
      setErrors(
        validation === "passwordMin" ? { password: validation } : { confirmation: validation },
      );
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) setErrors({ form: "resetUpdateError" });
      else setRecovery("updated");
    } catch {
      setErrors({ form: "resetUpdateError" });
    } finally {
      setBusy(false);
    }
  }

  async function backToLogin() {
    if (recovery === "updated") {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // Navigating to sign-in is still useful if clearing the local session fails.
      }
    }
    navigate({ to: "/auth", search: { mode: "signin" }, replace: true });
  }

  let content;
  if (recovery === "checking") {
    content = (
      <p role="status" className="mt-6 text-sm text-muted-foreground">
        {t("loading")}
      </p>
    );
  } else if (recovery === "invalid") {
    content = (
      <div
        role="alert"
        className="mt-6 rounded-lg border bg-destructive-soft p-4 text-sm text-destructive"
      >
        {t("resetLinkInvalid")}
      </div>
    );
  } else if (recovery === "updated") {
    content = (
      <div role="status" className="mt-6 rounded-lg border bg-success-soft p-4 text-sm">
        {t("passwordUpdated")}
      </div>
    );
  } else {
    content = (
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        <div>
          <Label htmlFor="new-password">{t("newPassword")} *</Label>
          <Input
            id="new-password"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={errors.password ? true : undefined}
            aria-describedby="new-password-error"
            className="mt-1.5 text-start"
          />
          <FieldError id="new-password-error" message={errors.password && t(errors.password)} />
        </div>
        <div>
          <Label htmlFor="confirm-password">{t("confirmPassword")} *</Label>
          <Input
            id="confirm-password"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            aria-invalid={errors.confirmation ? true : undefined}
            aria-describedby="confirm-password-error"
            className="mt-1.5 text-start"
          />
          <FieldError
            id="confirm-password-error"
            message={errors.confirmation && t(errors.confirmation)}
          />
        </div>
        {errors.form && (
          <p
            role="alert"
            className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive"
          >
            {t(errors.form)}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t("loading") : t("updatePassword")}
        </Button>
      </form>
    );
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
          <h1 className="text-2xl font-bold">
            {recovery === "updated" ? t("passwordUpdatedTitle") : t("setNewPassword")}
          </h1>
          {content}
          {recovery !== "checking" && (
            <button
              type="button"
              onClick={() => void backToLogin()}
              className="mt-5 inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
              {t("backToSignIn")}
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
