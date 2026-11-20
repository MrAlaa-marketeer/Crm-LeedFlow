import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { DirectionProvider } from "@radix-ui/react-direction";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { LanguageToggle } from "@/components/app/language-toggle";
import { ThemeProvider } from "@/lib/theme";
import { I18nProvider, useI18n } from "@/lib/i18n";

// Root boundaries render outside the i18n provider, so they show both languages.
function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <p className="text-7xl font-bold text-primary">404</p>
        <h1 className="mt-4 text-xl font-semibold text-foreground">الصفحة غير موجودة</h1>
        <p className="mt-1 text-sm text-muted-foreground" lang="en" dir="ltr">
          Page not found
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            الصفحة الرئيسية · Home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          تعذر تحميل هذه الصفحة
        </h1>
        <p className="mt-1 text-sm text-muted-foreground" lang="en" dir="ltr">
          This page didn't load. Try again or go back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            إعادة المحاولة · Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            الرئيسية · Home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    // Each content route sets its own title/description. Never add og:image here.
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "LeadFlow — متابعة عملاء العقارات" },
      {
        name: "description",
        content:
          "LeadFlow: lead capture and follow-up CRM for real-estate agencies in Egypt and the Arab region.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#1e3a8a" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/leadflow-icon.svg", type: "image/svg+xml", sizes: "any" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    // Arabic-first: SSR renders RTL; the stored language preference is applied after hydration.
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      // Supabase callbacks must return before loaders reenter the auth client.
      if (event === "SIGNED_OUT") queryClient.clear();
      window.setTimeout(() => {
        void router.invalidate();
        if (event !== "SIGNED_OUT") void queryClient.invalidateQueries();
      }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <DirectionalApp />
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function DirectionalApp() {
  const { dir, lang, t } = useI18n();
  const pathname = useRouterState({
    select: (state) => state.location.pathname.replace(/\/$/, ""),
  });
  const accountPage = ["/auth", "/forgot-password", "/reset-password"].includes(pathname);
  return (
    <DirectionProvider dir={dir}>
      <div dir={dir} className="min-h-screen">
        {accountPage && !isSupabaseConfigured() ? (
          <main className="mx-auto max-w-lg space-y-4 px-6 py-12">
            <LanguageToggle variant="ghost" />
            <h1 className="text-xl font-semibold">
              {lang === "ar"
                ? "تسجيل الدخول غير متاح في المعاينة"
                : "Sign-in is unavailable in this preview"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {lang === "ar"
                ? "نسخة المعاينة غير متصلة بقاعدة بيانات LeadFlow."
                : "This preview is not connected to the LeadFlow database."}
            </p>
            <Link to="/" className="inline-block text-sm font-medium text-primary underline">
              {t("back")} · {lang === "ar" ? "الرئيسية" : "Home"}
            </Link>
          </main>
        ) : (
          <Outlet />
        )}
      </div>
      <Toaster
        dir={dir}
        position={dir === "rtl" ? "top-left" : "top-right"}
        richColors
        closeButton
      />
    </DirectionProvider>
  );
}
