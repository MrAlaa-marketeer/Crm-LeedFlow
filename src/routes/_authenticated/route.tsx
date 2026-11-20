import { useEffect, useState } from "react";
import {
  createFileRoute,
  Outlet,
  Link,
  redirect,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, LogOut, Menu } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/app/app-sidebar";
import { ErrorState, ListSkeleton } from "@/components/app/states";
import { LanguageToggle } from "@/components/app/language-toggle";
import { ThemePicker } from "@/components/app/theme-picker";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";
import { workspaceQueryOptions, useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import { loadAccess } from "@/lib/billing/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,

  beforeLoad: async ({ location }) => {
    if (!isSupabaseConfigured()) {
      throw redirect({ to: "/auth", search: { mode: "signin", redirect: location.href } });
    }
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      throw redirect({
        to: "/auth",
        search: {
          mode: "signin",
          redirect: location.href,
        },
      });
    }
    const billing = await loadAccess();
    if (
      (!billing?.allowed || billing.needsLicense) &&
      location.pathname.replace(/\/$/, "") !== "/billing"
    ) {
      throw redirect({ to: "/billing", replace: true });
    }
    return { billing };
  },

  loader: ({ context }) =>
    context.billing?.allowed && !context.billing.needsLicense
      ? context.queryClient.fetchQuery(workspaceQueryOptions)
      : null,

  pendingComponent: () => (
    <div className="mx-auto max-w-5xl p-6">
      <ListSkeleton />
    </div>
  ),

  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-lg p-6">
      <ErrorState error={error} onRetry={() => window.location.reload()} />
    </div>
  ),

  component: ProtectedShell,
});

function ProtectedShell() {
  const { billing } = Route.useRouteContext();
  const router = useRouter();
  const { t } = useI18n();
  useEffect(() => {
    const check = () => void router.invalidate();
    const timer = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [router]);
  if (billing?.allowed && !billing.needsLicense) return <AppShell />;
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border bg-card px-5 py-3">
        <span className="font-semibold">LeadFlow</span>
        <div className="flex gap-2">
          <ThemePicker compact />
          <LanguageToggle variant="ghost" />
          <Button
            variant="ghost"
            onClick={async () => {
              const { error } = await supabase.auth.signOut();
              if (error) toast.error(t("somethingWrong"));
              else {
                router.options.context.queryClient.clear();
                await router.navigate({ to: "/auth", search: { mode: "signin" } });
              }
            }}
          >
            {t("signOut")}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function AppShell() {
  const { t, dir } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const workspace = useWorkspaceData();
  // Reminder bell: open follow-ups due now (due_at <= now), workspace-scoped.
  // Computed live from follow_ups on every shell load / 60s refetch — no
  // external service, no push/email. Completing a follow-up clears its count.
  const reminderCountQuery = useQuery({
    queryKey: ["reminders", "due-now", workspace.workspace.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("follow_ups")
        .select("id, lead:leads!inner(archived_at)", { count: "exact", head: true })
        .eq("workspace_id", workspace.workspace.id)
        .is("completed_at", null)
        .is("lead.archived_at", null)
        .lte("due_at", new Date().toISOString());
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });
  const reminderCount = reminderCountQuery.data ?? 0;

  const activePath = useRouterState({
    select: (state) => state.location.pathname,
  });

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);

    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error(t("somethingWrong"));
        return;
      }

      await qc.cancelQueries();
      qc.clear();
      navigate({
        to: "/auth",
        search: { mode: "signin" },
        replace: true,
      });
    } catch {
      toast.error(t("somethingWrong"));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div dir={dir} className="min-h-screen bg-background">
      {/* Desktop Sidebar */}
      <div className="fixed inset-y-0 start-0 z-30 hidden lg:block">
        <AppSidebar
          workspace={workspace}
          activePath={activePath}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((value) => !value)}
          reminderCount={reminderCount}
        />
      </div>

      {/* Mobile Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side={dir === "rtl" ? "right" : "left"} className="w-72 max-w-[85vw] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{dir === "rtl" ? "قائمة التنقل" : "LeadFlow navigation"}</SheetTitle>
          </SheetHeader>

          <AppSidebar
            workspace={workspace}
            activePath={activePath}
            onNavigate={() => setMobileOpen(false)}
            reminderCount={reminderCount}
          />
        </SheetContent>
      </Sheet>

      {/* Main Application */}
      <div
        dir={dir}
        className={`min-h-screen transition-[margin] duration-200 ${
          collapsed ? "lg:ms-[76px]" : "lg:ms-64"
        }`}
      >
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur-md md:px-6">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="lg:hidden"
              aria-label={dir === "rtl" ? "فتح قائمة التنقل" : "Open navigation menu"}
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            <div className="hidden sm:block">
              <p className="text-sm font-semibold text-foreground">{workspace.workspace.name}</p>
              <p className="text-xs text-muted-foreground">{t("tagline")}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/follow-ups"
              aria-label={
                dir === "rtl"
                  ? `متابعات مستحقة الآن (${reminderCount})`
                  : `Follow-ups due now (${reminderCount})`
              }
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Bell className="h-5 w-5" />
              {reminderCount > 0 && (
                <span className="absolute -end-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-bold text-destructive-foreground">
                  {reminderCount > 99 ? "99+" : reminderCount}
                </span>
              )}
            </Link>
            <Button asChild variant="ghost" size="sm">
              <Link to="/billing">{dir === "rtl" ? "الاشتراك" : "Billing"}</Link>
            </Button>
            <ThemePicker compact />
            <LanguageToggle variant="ghost" />

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={signOut}
              disabled={signingOut}
              className="gap-2 text-muted-foreground hover:text-destructive"
            >
              <LogOut className="h-4 w-4 rtl:rotate-180" />
              <span className="hidden sm:inline">{t("signOut")}</span>
            </Button>
          </div>
        </header>

        {/* Page Content */}
        <main id="main" className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
