import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BellRing, Palette, Save, Settings as SettingsIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/app/states";
import { useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { plans } from "@/lib/billing/model";
import { ThemePicker } from "@/components/app/theme-picker";

// Workspace-level notification preferences, stored as JSON in
// workspace_settings.notification_preferences (jsonb, default '{}').
// Unknown keys are preserved on save; a missing key means "on".
// This is the workspace-wide setting (owner edits it); each member's own
// in-app toggle lives in the notification_preferences table and is managed
// from the Automation page.
type WorkspaceNotificationPrefs = {
  in_app_enabled: boolean;
  new_lead: boolean;
  follow_up_reminder: boolean;
  deal_won: boolean;
};
const DEFAULT_PREFS: WorkspaceNotificationPrefs = {
  in_app_enabled: true,
  new_lead: true,
  follow_up_reminder: true,
  deal_won: true,
};
function parsePrefs(raw: unknown): {
  prefs: WorkspaceNotificationPrefs;
  raw: Record<string, unknown>;
} {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (key: keyof WorkspaceNotificationPrefs) =>
    typeof obj[key] === "boolean" ? (obj[key] as boolean) : true;
  return {
    prefs: {
      in_app_enabled: pick("in_app_enabled"),
      new_lead: pick("new_lead"),
      follow_up_reminder: pick("follow_up_reminder"),
      deal_won: pick("deal_won"),
    },
    raw: obj,
  };
}

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });
function SettingsPage() {
  const { t, dir, locale } = useI18n();
  const ws = useWorkspaceData();
  const { billing } = Route.useRouteContext();
  const isOwner = ws.role === "owner";
  const [logo, setLogo] = useState("");
  const [maps, setMaps] = useState("");
  const [prefs, setPrefs] = useState<WorkspaceNotificationPrefs>(DEFAULT_PREFS);
  const [rawPrefs, setRawPrefs] = useState<Record<string, unknown>>({});
  const [demoCount, setDemoCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [removingDemo, setRemovingDemo] = useState(false);
  const rtl = dir === "rtl";
  useEffect(() => {
    void (async () => {
      const { data } = await (supabase as any)
        .from("workspace_settings")
        .select("company_logo_path,maps_api_key,notification_preferences")
        .eq("workspace_id", ws.workspace.id)
        .maybeSingle();
      if (data) {
        setLogo(data.company_logo_path ?? "");
        setMaps(data.maps_api_key ?? "");
        const parsed = parsePrefs(data.notification_preferences);
        setPrefs(parsed.prefs);
        setRawPrefs(parsed.raw);
      }
      const { count } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.workspace.id)
        .eq("is_demo", true);
      setDemoCount(count ?? 0);
    })();
  }, [ws.workspace.id]);
  async function save() {
    setBusy(true);
    const { error } = await (supabase as any).from("workspace_settings").upsert({
      workspace_id: ws.workspace.id,
      company_logo_path: logo || null,
      maps_api_key: maps || null,
      notification_preferences: { ...rawPrefs, ...prefs },
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) toast.error(t("somethingWrong"));
    else toast.success(t("settingsSaved"));
  }
  async function removeDemo() {
    if (!isOwner || removingDemo) return;
    if (!window.confirm(`${t("removeDemoConfirmTitle")}\n${t("removeDemoConfirmBody")}`)) return;
    setRemovingDemo(true);
    // remove_demo_data() is owner-only in the database (raises otherwise)
    // and deletes only is_demo follow-ups + leads; properties carry no
    // is_demo flag, so there is no demo property data to remove.
    const { data, error } = await supabase.rpc("remove_demo_data", {
      _workspace_id: ws.workspace.id,
    });
    setRemovingDemo(false);
    if (error) {
      toast.error(t("somethingWrong"));
      return;
    }
    setDemoCount(0);
    toast.success(t("demoRemoved", { count: data ?? 0 }));
  }
  const statusLabel =
    billing == null
      ? "—"
      : ((
          {
            trial: rtl ? "تجربة مجانية" : "Trial",
            active: rtl ? "نشط" : "Active",
            expired: rtl ? "منتهي" : "Expired",
            suspended: rtl ? "موقوف" : "Suspended",
            paid_needs_reactivation: rtl
              ? "تم الدفع – يحتاج إعادة تفعيل"
              : "Paid - needs reactivation",
          } as Record<string, string>
        )[billing.status] ?? billing.status);
  const prefRows: { key: keyof WorkspaceNotificationPrefs; label: string }[] = [
    { key: "in_app_enabled", label: t("inAppNotifications") },
    { key: "new_lead", label: rtl ? "تنبيهات العملاء الجدد" : "New lead alerts" },
    { key: "follow_up_reminder", label: rtl ? "تذكير المتابعات" : "Follow-up reminders" },
    { key: "deal_won", label: rtl ? "تنبيهات الصفقات الرابحة" : "Deal won alerts" },
  ];
  return (
    <div dir={dir} className="space-y-6">
      <PageHeader title={t("settings")} description={t("settingsSubtitle")} />
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 font-semibold">
          <Palette className="size-4 text-primary" />
          {t("themeSetting")}
        </div>
        <ThemePicker />
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div>
          <Label htmlFor="settings-logo">{t("companyLogo")}</Label>
          <Input id="settings-logo" value={logo} onChange={(e) => setLogo(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="settings-maps">{t("mapsKey")}</Label>
          <Input
            id="settings-maps"
            type="password"
            value={maps}
            onChange={(e) => setMaps(e.target.value)}
          />
        </div>
        <Button disabled={busy || !isOwner} onClick={() => void save()}>
          <Save className="size-4" />
          {t("save")}
        </Button>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 font-semibold">
          <SettingsIcon className="size-4" />
          {t("planSeatsExpiry")}
        </div>
        {billing == null ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {rtl ? "لا توجد بيانات اشتراك متاحة." : "No subscription data available."}
          </p>
        ) : (
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{rtl ? "الباقة" : "Plan"}</dt>
              <dd className="font-semibold">{plans[billing.plan].name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{rtl ? "الحالة" : "Status"}</dt>
              <dd className="font-semibold">{statusLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{rtl ? "المقاعد" : "Seats"}</dt>
              <dd className="font-semibold">
                {ws.members.length} /{" "}
                {billing.maxUsers == null ? (rtl ? "غير محدود" : "Unlimited") : billing.maxUsers}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{rtl ? "تاريخ الانتهاء" : "Expires"}</dt>
              <dd className="font-semibold">
                {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                  new Date(billing.expiresAt),
                )}
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-3 text-sm text-muted-foreground">
          <a className="text-primary underline" href="/billing">
            {t("manageBilling")}
          </a>
        </p>
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 font-semibold">
          <BellRing className="size-4" />
          {rtl ? "تفضيلات الإشعارات" : "Notification preferences"}
        </div>
        <p className="text-sm text-muted-foreground">{t("notificationPreferenceHint")}</p>
        {prefRows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3">
            <Label htmlFor={`settings-notif-${row.key}`}>{row.label}</Label>
            <Switch
              id={`settings-notif-${row.key}`}
              checked={prefs[row.key]}
              disabled={!isOwner}
              onCheckedChange={(checked) => setPrefs((p) => ({ ...p, [row.key]: checked }))}
            />
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          {isOwner
            ? rtl
              ? "استخدم زر الحفظ أعلاه لحفظ التفضيلات."
              : "Use Save above to store these preferences."
            : rtl
              ? "مالك مساحة العمل فقط يمكنه تغيير هذه التفضيلات."
              : "Only the workspace owner can change these preferences."}
        </p>
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2 font-semibold">
          <Trash2 className="size-4" />
          {t("demoSection")}
        </div>
        <p className="text-sm text-muted-foreground">{t("demoHint")}</p>
        <p className="text-sm">
          {demoCount == null
            ? t("loading")
            : demoCount > 0
              ? `${t("hasDemo")} (${demoCount})`
              : t("noDemo")}
        </p>
        {isOwner ? (
          <Button
            variant="outline"
            disabled={removingDemo || demoCount == null || demoCount === 0}
            onClick={() => void removeDemo()}
          >
            <Trash2 className="size-4" />
            {t("removeDemo")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t("demoOwnerOnly")}</p>
        )}
      </section>
    </div>
  );
}
