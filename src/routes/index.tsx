import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BellRing,
  CalendarClock,
  KanbanSquare,
  MessageCircle,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LanguageToggle } from "@/components/app/language-toggle";
import { Logo } from "@/components/app/logo";
import { StatusBadge } from "@/components/app/badges";
import { useSessionUser } from "@/hooks/use-session";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LeadFlow — لا تفقد أي عميل عقاري | Real-estate lead CRM" },
      {
        name: "description",
        content:
          "LeadFlow helps real-estate agencies in Egypt capture leads from Facebook, Instagram and WhatsApp, track the sales pipeline and never miss a follow-up. Arabic-first.",
      },
      { property: "og:title", content: "LeadFlow — Real-estate lead follow-up CRM" },
      {
        property: "og:description",
        content:
          "Capture, assign and follow up with real-estate leads in Arabic or English. Built for agencies in Egypt.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t } = useI18n();
  const session = useSessionUser();
  const signedIn = !!session.data;

  const features = [
    { icon: Users, title: t("feature1Title"), body: t("feature1Body") },
    { icon: KanbanSquare, title: t("feature2Title"), body: t("feature2Body") },
    { icon: BellRing, title: t("feature3Title"), body: t("feature3Body") },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <Logo className="text-lg" />
        <nav className="flex items-center gap-2" aria-label={t("mainNav")}>
          <LanguageToggle variant="ghost" />
          {signedIn ? (
            <Button asChild size="sm">
              <Link to="/dashboard">{t("openDashboard")}</Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link to="/auth" search={{ mode: "signin" }}>
                {t("signIn")}
              </Link>
            </Button>
          )}
        </nav>
      </header>

      <main>
        <section className="bg-hero">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-2 lg:pb-24 lg:pt-16">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-card">
                <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-brand" />
                {t("tagline")}
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight text-primary sm:text-5xl">
                {t("landingTitle")}
              </h1>
              <p className="mt-4 max-w-xl text-lg text-muted-foreground">{t("landingSubtitle")}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                {signedIn ? (
                  <Button asChild size="lg" variant="hero">
                    <Link to="/dashboard">{t("openDashboard")}</Link>
                  </Button>
                ) : (
                  <>
                    <Button asChild size="lg" variant="hero">
                      <Link to="/auth" search={{ mode: "signup" }}>
                        {t("getStarted")}
                      </Link>
                    </Button>
                    <Button asChild size="lg" variant="outline">
                      <Link to="/auth" search={{ mode: "signin" }}>
                        {t("signIn")}
                      </Link>
                    </Button>
                  </>
                )}
              </div>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="features-title">
          <h2 id="features-title" className="sr-only">
            {t("appName")}
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {features.map((f) => (
              <li key={f.title} className="rounded-xl border bg-card p-6 shadow-card">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <f.icon aria-hidden="true" className="h-5 w-5" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <Logo className="text-sm" />
          <p>{t("landingFooter")}</p>
        </div>
      </footer>
    </div>
  );
}

/** A static, illustrative preview of the follow-up list (no real data). */
function ProductPreview() {
  const { t, lang } = useI18n();
  const rows = [
    {
      name: lang === "en" ? "Ahmed M." : "أحمد م.",
      status: "meeting" as const,
      when: t("tabToday"),
    },
    {
      name: lang === "en" ? "Mona A." : "منى ع.",
      status: "contacted" as const,
      when: t("tabOverdue"),
    },
    {
      name: lang === "en" ? "Karim H." : "كريم ح.",
      status: "negotiation" as const,
      when: t("tabUpcoming"),
    },
  ];
  return (
    <div aria-hidden="true" className="relative">
      <div className="rounded-2xl border bg-card p-5 shadow-elevated">
        <div className="mb-4 flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-brand" />
            {t("followUpsTitle")}
          </p>
          <span className="rounded-full bg-destructive-soft px-2 py-0.5 text-xs font-medium text-destructive">
            1 {t("tabOverdue")}
          </span>
        </div>
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li
              key={r.name}
              className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.when}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={r.status} />
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-whatsapp text-whatsapp-foreground">
                  <MessageCircle className="h-3.5 w-3.5" />
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
