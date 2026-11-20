import {
  BarChart3,
  Building2,
  CalendarClock,
  ChevronLeft,
  GitBranch,
  Handshake,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
  UsersRound,
  Workflow,
} from "lucide-react";

import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";

interface AppSidebarProps {
  workspace: {
    workspace: {
      name: string;
    };
    profile: {
      full_name: string | null;
    };
    email: string;
    role: string;
  };
  activePath: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  /** Open follow-ups due now (due_at <= now), workspace-scoped. Passed down
   * from the authenticated layout, which queries it live; 0 hides the badge. */
  reminderCount?: number;
}

const navigation = [
  { id: "dashboard", icon: LayoutDashboard },
  { id: "leads", icon: Users },
  { id: "pipeline", icon: GitBranch },
  { id: "deals", icon: Handshake },
  { id: "followups", icon: CalendarClock },
  { id: "projects", icon: Building2 },
  { id: "team", icon: UsersRound },
  { id: "reports", icon: BarChart3 },
  { id: "automation", icon: Workflow },
  { id: "settings", icon: Settings },
];

const labels = {
  dashboard: { ar: "لوحة التحكم", en: "Dashboard" },
  leads: { ar: "إدارة العملاء", en: "Leads Management" },
  pipeline: { ar: "مراحل البيع", en: "Sales Pipeline" },
  deals: { ar: "الصفقات", en: "Deals" },
  followups: { ar: "المتابعات", en: "Follow-ups" },
  projects: { ar: "المشروعات", en: "Projects & inventory" },
  team: { ar: "إدارة الفريق", en: "Team Management" },
  reports: { ar: "التقارير", en: "Reports" },
  automation: { ar: "الأتمتة والإشعارات", en: "Automation & notifications" },
  settings: { ar: "الإعدادات", en: "Settings" },
};

export function AppSidebar({
  workspace,
  activePath,
  collapsed = false,
  onToggleCollapse,
  onNavigate,
  reminderCount = 0,
}: AppSidebarProps) {
  const { dir } = useI18n();
  const isArabic = dir === "rtl";

  const fullName = workspace.profile.full_name || workspace.email;

  const initials = fullName.slice(0, 2).toUpperCase();

  return (
    <aside
      dir={dir}
      className={`flex h-full flex-col border-e border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 ${
        collapsed ? "w-[76px]" : "w-64"
      }`}
    >
      {/* Brand Header */}
      <div className="flex h-[72px] items-center justify-between border-b border-sidebar-border px-4">
        <Link to="/dashboard" onClick={onNavigate} className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <BarChart3 size={20} />
          </div>

          {!collapsed && <span className="text-lg font-bold text-sidebar-foreground">LeadFlow</span>}
        </Link>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={isArabic ? "تصغير القائمة" : "Collapse sidebar"}
            className="rounded-lg p-2 text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        )}
      </div>

      {/* Workspace */}
      <div className="border-b border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent p-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
            {workspace.workspace.name.slice(0, 1).toUpperCase()}
          </div>

          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-sidebar-muted">
                {isArabic ? "مساحة العمل" : "WORKSPACE"}
              </p>
              <p className="truncate text-sm font-semibold text-sidebar-foreground">
                {workspace.workspace.name}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {!collapsed && (
          <p className="mb-3 px-3 text-[11px] font-semibold text-sidebar-muted">
            {isArabic ? "القائمة الرئيسية" : "MAIN MENU"}
          </p>
        )}

        {navigation.map((item) => {
          const Icon = item.icon;
          const active =
            item.id === "dashboard"
              ? activePath === "/dashboard"
              : item.id === "leads"
                ? activePath === "/leads" ||
                  activePath === "/leads/" ||
                  activePath.startsWith("/leads/")
                : item.id === "pipeline"
                  ? activePath === "/pipeline"
                  : item.id === "followups"
                    ? activePath === "/follow-ups" || activePath.startsWith("/follow-ups/")
                    : item.id === "deals"
                      ? activePath === "/deals" || activePath.startsWith("/deals/")
                      : item.id === "projects"
                        ? activePath === "/projects" || activePath.startsWith("/projects/")
                        : item.id === "team"
                          ? activePath === "/team" || activePath.startsWith("/team/")
                          : item.id === "reports"
                            ? activePath === "/reports" || activePath.startsWith("/reports/")
                            : item.id === "automation"
                              ? activePath === "/automation" ||
                                activePath.startsWith("/automation/")
                              : item.id === "settings"
                                ? activePath === "/settings"
                                : false;
          const enabled =
            item.id === "dashboard" ||
            item.id === "leads" ||
            item.id === "pipeline" ||
            item.id === "followups" ||
            item.id === "deals" ||
            item.id === "projects" ||
            item.id === "team" ||
            item.id === "reports" ||
            item.id === "automation" ||
            item.id === "settings";
          const label = isArabic
            ? labels[item.id as keyof typeof labels].ar
            : labels[item.id as keyof typeof labels].en;

          const className = `relative flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors ${
            active
              ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground shadow-sm"
              : enabled
                ? "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                : "cursor-not-allowed text-sidebar-muted"
          }`;

          const content = (
            <>
              <Icon size={19} className="shrink-0" />

              {item.id === "followups" && reminderCount > 0 && collapsed && (
                <span
                  aria-hidden="true"
                  className="absolute end-1 top-1 h-2.5 w-2.5 rounded-full bg-destructive"
                />
              )}

              {!collapsed && (
                <>
                  <span className="flex-1 text-start">{label}</span>

                  {item.id === "followups" && reminderCount > 0 && (
                    <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-destructive-foreground">
                      {reminderCount > 99 ? "99+" : reminderCount}
                    </span>
                  )}

                  {enabled ? (
                    active ? (
                      <ChevronLeft size={16} className={isArabic ? "" : "rotate-180"} />
                    ) : null
                  ) : (
                    <span className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[9px] text-sidebar-muted">
                      {isArabic ? "قريباً" : "Soon"}
                    </span>
                  )}
                </>
              )}
            </>
          );

          if (
            item.id === "dashboard" ||
            item.id === "leads" ||
            item.id === "pipeline" ||
            item.id === "followups" ||
            item.id === "deals" ||
            item.id === "projects" ||
            item.id === "team" ||
            item.id === "reports" ||
            item.id === "automation" ||
            item.id === "settings"
          ) {
            return (
              <Link
                key={item.id}
                to={
                  item.id === "dashboard"
                    ? "/dashboard"
                    : item.id === "leads"
                      ? "/leads"
                      : item.id === "pipeline"
                        ? "/pipeline"
                        : item.id === "followups"
                          ? "/follow-ups"
                          : item.id === "deals"
                            ? "/deals"
                            : item.id === "projects"
                              ? "/projects"
                              : item.id === "team"
                                ? "/team"
                                : item.id === "reports"
                                  ? "/reports"
                                  : item.id === "automation"
                                    ? "/automation"
                                    : "/settings"
                }
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                title={collapsed ? label : undefined}
                className={className}
              >
                {content}
              </Link>
            );
          }

          return (
            <div
              key={item.id}
              aria-disabled="true"
              title={collapsed ? label : undefined}
              className={className}
            >
              {content}
            </div>
          );
        })}
      </nav>

      {/* User Profile */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-xl p-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
            {initials}
          </div>

          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-sidebar-foreground">{fullName}</p>
              <p className="truncate text-xs text-sidebar-muted">{workspace.role}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
