import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldError } from "@/components/app/states";
import { LanguageToggle } from "@/components/app/language-toggle";
import { Logo } from "@/components/app/logo";
import { supabase } from "@/integrations/supabase/client";
import { safeRedirectPath, useSessionUser } from "@/hooks/use-session";
import { useI18n } from "@/lib/i18n";
import type { DictKey } from "@/lib/i18n-dict";

type Mode = "signin" | "signup";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { mode: Mode; redirect?: string } => {
    const redirect = safeRedirectPath(search["redirect"]);
    return {
      mode: search["mode"] === "signup" ? "signup" : "signin",
      ...(redirect ? { redirect } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — LeadFlow | Sign in" },
      {
        name: "description",
        content: "Sign in to your LeadFlow agency workspace or create a new agency account.",
      },
      { property: "og:title", content: "Sign in to LeadFlow" },
      { property: "og:description", content: "Access your real-estate lead follow-up workspace." },
    ],
  }),
  component: AuthPage,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function AuthPage() {
  const { t, lang } = useI18n();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const session = useSessionUser();
  const dest = search.redirect ?? "/dashboard";

  useEffect(() => {
    if (session.data) navigate({ to: dest, replace: true });
  }, [session.data, dest, navigate]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fullName, setFullName] = useState("");
  const [agency, setAgency] = useState("");
  const [errors, setErrors] = useState<
    Partial<Record<"email" | "password" | "confirm" | "fullName" | "form", DictKey>>
  >({});
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function signIn(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!EMAIL_RE.test(email.trim())) errs.email = "invalidEmail";
    if (!password) errs.password = "required";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) {
      setErrors({
        form: /confirm/i.test(error.message) ? "emailNotConfirmed" : "invalidCredentials",
      });
      return;
    }
    navigate({ to: dest, replace: true });
  }

  async function signUp(e: FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!fullName.trim()) errs.fullName = "nameRequired";
    if (!EMAIL_RE.test(email.trim())) errs.email = "invalidEmail";
    if (password.length < 8) errs.password = "passwordMin";
    if (confirm !== password) errs.confirm = "passwordsDontMatch";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName.trim(), agency_name: agency.trim(), language: lang },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(t("somethingWrong"));
      return;
    }
    if (data.session) navigate({ to: "/dashboard", replace: true });
    else setCheckEmail(true);
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth` },
    });
    if (error) toast.error(t("googleError"));
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
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-elevated sm:p-8">
          <h1 className="text-2xl font-bold">{t("authWelcome")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("authSubtitle")}</p>
          {checkEmail ? (
            <div role="status" className="mt-6 rounded-lg border bg-success-soft p-4 text-sm">
              <p className="font-semibold">{t("checkEmailTitle")}</p>
              <p className="mt-1">{t("signUpCheckEmail")}</p>
            </div>
          ) : (
            <Tabs
              value={search.mode}
              onValueChange={(v) => {
                setErrors({});
                navigate({
                  to: "/auth",
                  search: { ...search, mode: v === "signup" ? "signup" : "signin" },
                  replace: true,
                });
              }}
              className="mt-6"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">{t("tabSignIn")}</TabsTrigger>
                <TabsTrigger value="signup">{t("tabSignUp")}</TabsTrigger>
              </TabsList>
              <TabsContent value="signin">
                <form onSubmit={signIn} noValidate className="mt-4 space-y-4">
                  <EmailPassword
                    {...{ email, setEmail, password, setPassword, errors, t }}
                    autoComplete="current-password"
                  />
                  <div className="-mt-2 text-end">
                    <Link
                      to="/forgot-password"
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {t("forgotPassword")}
                    </Link>
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
                    {busy ? t("loading") : t("signIn")}
                  </Button>
                </form>
              </TabsContent>
              <TabsContent value="signup">
                <form onSubmit={signUp} noValidate className="mt-4 space-y-4">
                  <div>
                    <Label htmlFor="su-name">{t("fullName")} *</Label>
                    <Input
                      id="su-name"
                      value={fullName}
                      maxLength={120}
                      autoComplete="name"
                      onChange={(e) => setFullName(e.target.value)}
                      aria-invalid={errors.fullName ? true : undefined}
                      aria-describedby="su-name-error"
                      className="mt-1.5"
                    />
                    <FieldError
                      id="su-name-error"
                      message={errors.fullName && t(errors.fullName)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="su-agency">
                      {t("agencyName")}{" "}
                      <span className="text-muted-foreground">({t("optional")})</span>
                    </Label>
                    <Input
                      id="su-agency"
                      value={agency}
                      maxLength={120}
                      autoComplete="organization"
                      onChange={(e) => setAgency(e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                  <EmailPassword
                    {...{ email, setEmail, password, setPassword, errors, t }}
                    autoComplete="new-password"
                  />
                  <div>
                    <Label htmlFor="su-confirm">{t("confirmPassword")} *</Label>
                    <Input
                      id="su-confirm"
                      type="password"
                      dir="ltr"
                      value={confirm}
                      autoComplete="new-password"
                      onChange={(e) => setConfirm(e.target.value)}
                      aria-invalid={errors.confirm ? true : undefined}
                      aria-describedby="su-confirm-error"
                      className="mt-1.5"
                    />
                    <FieldError
                      id="su-confirm-error"
                      message={errors.confirm && t(errors.confirm)}
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy ? t("loading") : t("getStarted")}
                  </Button>
                </form>
              </TabsContent>
              <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t("or")}
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={google}>
                {t("continueWithGoogle")}
              </Button>
            </Tabs>
          )}
        </div>
      </main>
    </div>
  );
}

function EmailPassword({
  email,
  setEmail,
  password,
  setPassword,
  errors,
  t,
  autoComplete,
}: {
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  errors: Partial<Record<string, DictKey>>;
  t: (k: DictKey) => string;
  autoComplete: string;
}) {
  const emailErr = errors["email"];
  const passErr = errors["password"];
  return (
    <>
      <div>
        <Label htmlFor={`${autoComplete}-email`}>{t("email")} *</Label>
        <Input
          id={`${autoComplete}-email`}
          type="email"
          dir="ltr"
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={emailErr ? true : undefined}
          aria-describedby={`${autoComplete}-email-error`}
          className="mt-1.5 text-start"
        />
        <FieldError id={`${autoComplete}-email-error`} message={emailErr && t(emailErr)} />
      </div>
      <div>
        <Label htmlFor={`${autoComplete}-pw`}>{t("password")} *</Label>
        <Input
          id={`${autoComplete}-pw`}
          type="password"
          dir="ltr"
          value={password}
          autoComplete={autoComplete}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={passErr ? true : undefined}
          aria-describedby={`${autoComplete}-pw-error`}
          className="mt-1.5 text-start"
        />
        <FieldError id={`${autoComplete}-pw-error`} message={passErr && t(passErr)} />
      </div>
    </>
  );
}
