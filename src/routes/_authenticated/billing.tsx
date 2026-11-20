import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { activateLicense, loadPayments } from "@/lib/billing/client";
import {
  billingSettings,
  listBilling,
  listBillingAudit,
  manageBilling,
  submitPayment,
  type BillingAction,
} from "@/lib/billing/functions";
import {
  deviceCaps,
  methods,
  plans,
  price,
  type Method,
  type Plan,
  type Term,
} from "@/lib/billing/model";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [{ title: "الاشتراك | LeadFlow Billing" }, { name: "robots", content: "noindex" }],
  }),
  component: BillingPage,
});

const methodNames = {
  instapay: ["InstaPay", "إنستا باي"],
  vodafone_cash: ["Vodafone Cash", "فودافون كاش"],
  bank_transfer: ["Bank transfer", "تحويل بنكي"],
} as const;
const labels = {
  trial: ["Trial", "تجربة مجانية"],
  active: ["Active", "نشط"],
  expired: ["Expired", "منتهي"],
  suspended: ["Suspended", "موقوف"],
  pending: ["Pending", "قيد المراجعة"],
  confirmed: ["Confirmed", "مؤكد"],
  rejected: ["Rejected", "مرفوض"],
  paid_needs_reactivation: ["Paid - needs reactivation", "تم الدفع – يحتاج إعادة تفعيل"],
} as const;
const auditLabels = {
  confirm: ["Confirm payment", "تأكيد الدفع"],
  reject: ["Reject payment", "رفض الدفع"],
  extend: ["Extend", "تمديد"],
  suspend: ["Suspend", "إيقاف"],
  reactivate: ["Reactivate", "إعادة تفعيل"],
  license_issue: ["Issue key", "إصدار مفتاح"],
  license_revoke: ["Revoke key", "إلغاء مفتاح"],
} as const;
const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";

function useBillingCopy() {
  const { lang, locale, t } = useI18n();
  return {
    tr: (...[en, ar]: readonly [string, string]) => (lang === "ar" ? ar : en),
    label: (value: readonly [string, string]) => value[lang === "ar" ? 1 : 0],
    amount: (value: number) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "EGP",
        maximumFractionDigits: 0,
      }).format(value),
    date: (value: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Africa/Cairo" }).format(
        new Date(value),
      ),
    error: t("somethingWrong"),
    loading: t("loading"),
  };
}

function BillingPage() {
  const { billing } = Route.useRouteContext();
  const { tr, label, amount, date, error, loading } = useBillingCopy();
  const router = useRouter();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ["billing-settings", billing?.companyId],
    queryFn: () => billingSettings(),
  });
  const history = useQuery({
    queryKey: ["billing-payments", billing?.companyId],
    queryFn: () => loadPayments(billing!.companyId),
    enabled: billing?.owner === true,
  });
  const [plan, setPlan] = useState<Plan>(billing?.plan ?? "starter");
  const [term, setTerm] = useState<Term>("monthly");
  const [method, setMethod] = useState<Method>("instapay");
  const [code, setCode] = useState("");
  const [admin, setAdmin] = useState(false);
  const activation = useMutation({
    mutationFn: () => activateLicense(billing!.companyId, code),
    onSuccess: async (valid) => {
      if (!valid) toast.error(tr("Could not activate this device.", "تعذّر تفعيل هذا الجهاز."));
      else {
        await router.invalidate();
        toast.success(tr("Device activated", "تم تفعيل الجهاز"));
      }
    },
    onError: () => toast.error(error),
  });
  const submission = useMutation({
    mutationFn: (form: FormData) => submitPayment({ data: form }),
    onSuccess: (result) => {
      if (result.status === "duplicate")
        toast.error(tr("This reference is already registered.", "مرجع التحويل مسجل بالفعل."));
      else if (result.status === "failed") toast.error(error);
      else {
        toast.success(tr("Payment submitted for review", "تم إرسال الدفع للمراجعة"));
        void qc.invalidateQueries({ queryKey: ["billing-payments", billing?.companyId] });
      }
    },
    onError: () => toast.error(error),
  });
  const destination = settings.data?.manual ? settings.data.destinations[method] : "";
  async function onPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!billing?.owner || !destination || submission.isPending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("company", billing.companyId);
    try {
      if ((await submission.mutateAsync(data)).status === "saved") form.reset();
    } catch {
      /* Mutation already displays the localized error. */
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex min-h-11 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h1 className="text-2xl font-semibold">{tr("Subscription", "الاشتراك")}</h1>
        <div className="flex flex-wrap gap-2 sm:pt-1">
          {settings.data?.platformOwner && (
            <Button variant="outline" onClick={() => setAdmin(!admin)}>
              {admin ? tr("Subscription", "الاشتراك") : tr("Manage companies", "إدارة الشركات")}
            </Button>
          )}
          <Button variant="outline" onClick={() => void router.invalidate()}>
            <RefreshCw className="size-4" />
            {tr("Check again", "تحقق مجددًا")}
          </Button>
        </div>
      </div>
      {settings.isError && <p role="alert">{error}</p>}
      {admin && settings.data?.platformOwner ? (
        <AdminBilling />
      ) : (
        <>
          {billing ? (
            <section
              aria-label={tr("Subscription status", "حالة الاشتراك")}
              className="grid gap-3 rounded-lg border bg-background p-4 sm:grid-cols-3"
            >
              <div>
                <span className="text-sm text-muted-foreground">{tr("Status", "الحالة")}</span>
                <p className="font-semibold">{label(labels[billing.status])}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">{tr("Plan", "الباقة")}</span>
                <p className="font-semibold">{plans[billing.plan].name}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">
                  {tr("Expiry date", "تاريخ الانتهاء")}
                </span>
                <p className="font-semibold">{date(billing.expiresAt)}</p>
              </div>
            </section>
          ) : (
            <p>
              {tr("No company is assigned to this account.", "لا توجد شركة مرتبطة بهذا الحساب.")}
            </p>
          )}
          {billing?.allowed && billing.needsLicense && (
            <form
              className="flex flex-wrap items-end gap-3 border-b pb-5"
              onSubmit={(event) => {
                event.preventDefault();
                activation.mutate();
              }}
            >
              <label className="grid gap-2 text-sm">
                {tr("Company license key", "مفتاح ترخيص الشركة")}
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="LEAD-…"
                  required
                  maxLength={40}
                  autoComplete="off"
                  dir="ltr"
                />
              </label>
              <Button disabled={activation.isPending}>
                <KeyRound className="size-4" />
                {tr("Activate device", "تفعيل الجهاز")}
              </Button>
            </form>
          )}
          {billing?.allowed && !billing.needsLicense && (
            <Button asChild variant="outline">
              <Link to="/dashboard">{tr("Back to dashboard", "العودة للوحة الرئيسية")}</Link>
            </Button>
          )}
          {billing && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{tr("Plans", "الباقات")}</h2>
                  <p className="text-sm text-muted-foreground">
                    {tr(
                      "14-day free trial · no card required",
                      "تجربة مجانية 14 يومًا · بدون بطاقة",
                    )}
                  </p>
                </div>
                <label className="form-field text-sm">
                  {tr("Billing period", "دورة الدفع")}
                  <select
                    name="term"
                    form="billing-payment"
                    className={selectClass}
                    value={term}
                    onChange={(e) => setTerm(e.target.value as Term)}
                  >
                    <option value="monthly">{tr("Monthly", "شهري")}</option>
                    <option value="annual">
                      {tr("Annual · 12 months for the price of 10", "سنوي · 12 شهرًا بسعر 10")}
                    </option>
                  </select>
                </label>
              </div>
              <div className="grid auto-rows-fr gap-4 md:grid-cols-3">
                {(Object.keys(plans) as Plan[]).map((id) => (
                  <label
                    key={id}
                    className={`flex h-full cursor-pointer flex-col rounded-lg border bg-background p-4 ${plan === id ? "border-primary ring-1 ring-primary" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{plans[id].name}</span>
                      <input
                        type="radio"
                        name="plan"
                        form="billing-payment"
                        value={id}
                        checked={plan === id}
                        onChange={() => setPlan(id)}
                      />
                    </div>
                    <p className="mt-2 text-xl font-semibold">{amount(price(id, term))}</p>
                    <p className="text-sm text-muted-foreground">
                      {plans[id].users === null
                        ? tr("Unlimited users", "عدد مستخدمين غير محدود")
                        : tr(`Up to ${plans[id].users} users`, `حتى ${plans[id].users} مستخدمين`)}
                    </p>
                  </label>
                ))}
              </div>
            </section>
          )}
          {billing?.owner ? (
            <>
              <form id="billing-payment" className="grid gap-4 border-t pt-5" onSubmit={onPayment}>
                <h2 className="text-lg font-semibold">{tr("Manual payment", "الدفع اليدوي")}</h2>
                <label className="form-field w-full max-w-sm text-sm">
                  {tr("Payment method", "طريقة الدفع")}
                  <select
                    name="method"
                    className={selectClass}
                    value={method}
                    onChange={(e) => setMethod(e.target.value as Method)}
                  >
                    {methods.map((m) => (
                      <option key={m} value={m}>
                        {label(methodNames[m])}
                      </option>
                    ))}
                  </select>
                </label>
                {settings.isPending ? (
                  <p>{loading}</p>
                ) : destination ? (
                  <>
                    <div className="rounded-md border bg-background p-3 text-sm">
                      <p>
                        {tr("Transfer", "حوّل")} <strong>{amount(price(plan, term))}</strong>{" "}
                        {tr("to:", "إلى:")}
                      </p>
                      <p dir="auto" className="mt-1 whitespace-pre-wrap break-all font-medium">
                        {destination}
                      </p>
                    </div>
                    <div className="grid items-end gap-4 sm:grid-cols-2">
                      <label className="form-field text-sm">
                        {tr("Transaction reference", "مرجع التحويل")}
                        <Input name="reference" minLength={3} maxLength={120} required />
                      </label>
                      <label className="form-field text-sm">
                        {tr(
                          "Receipt image (optional, 5 MB max)",
                          "صورة الإيصال (اختيارية، حتى 5 ميجابايت)",
                        )}
                        <Input
                          name="receipt"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                        />
                      </label>
                    </div>
                    <Button className="justify-self-start" disabled={submission.isPending}>
                      <CreditCard className="size-4" />
                      {tr("Submit payment", "إرسال الدفع")}
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {tr("This payment method is unavailable.", "طريقة الدفع دي غير متاحة حاليًا.")}
                  </p>
                )}
              </form>
              <section className="space-y-2 border-t pt-5">
                <h2 className="text-lg font-semibold">
                  {tr("Recent payments", "المدفوعات الأخيرة")}
                </h2>
                {history.isPending ? (
                  <p>{loading}</p>
                ) : history.isError ? (
                  <p role="alert">{error}</p>
                ) : history.data.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {tr("No payments yet.", "لا توجد مدفوعات.")}
                  </p>
                ) : (
                  history.data.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap justify-between gap-2 border-b py-2 text-sm"
                    >
                      <span>
                        {plans[p.plan].name} · {amount(p.amount_egp)} · {date(p.created_at)}
                      </span>
                      <span dir="auto" className="break-all">
                        {p.transaction_ref}
                      </span>
                      <strong>{label(labels[p.status])}</strong>
                    </div>
                  ))
                )}
              </section>
            </>
          ) : (
            billing && (
              <p className="text-sm">
                {tr(
                  "Contact your company owner to renew.",
                  "تواصل مع صاحب الشركة لتجديد الاشتراك.",
                )}
              </p>
            )
          )}
        </>
      )}
    </div>
  );
}

function AdminBilling() {
  const { tr, label, error, loading, date, amount } = useBillingCopy();
  const qc = useQueryClient();
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [receiptUrl, setReceiptUrl] = useState<string>();
  const [newKey, setNewKey] = useState<string>();
  const [auditFilter, setAuditFilter] = useState("");
  const [auditDraft, setAuditDraft] = useState("");
  const [auditPage, setAuditPage] = useState(0);
  const [note, setNote] = useState("");
  const audit = useQuery({
    queryKey: ["billing-audit", auditFilter, auditPage],
    queryFn: () =>
      listBillingAudit({ data: { company: auditFilter || undefined, page: auditPage } }),
  });
  const list = useQuery({
    queryKey: ["billing-admin", page],
    queryFn: () => listBilling({ data: page }),
  });
  const change = useMutation({
    gcTime: 0,
    mutationFn: async (data: BillingAction) => {
      const { code, ...result } = await manageBilling({ data: { ...data, note } });
      if (code) setNewKey(code);
      return result;
    },
    onSuccess: async ({ url, paidNeedsReactivation }) => {
      if (url) {
        setReceiptUrl(url);
        return;
      }
      toast.success(
        paidNeedsReactivation
          ? label(labels.paid_needs_reactivation)
          : tr("Billing updated", "تم تحديث الاشتراك"),
      );
      setNote("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["billing-admin"] }),
        qc.invalidateQueries({ queryKey: ["billing-audit"] }),
      ]);
      await router.invalidate();
    },
    onError: () => toast.error(error),
  });
  return (
    <div className="space-y-6">
      {newKey && (
        <section className="space-y-2 border-y py-3" role="status">
          <p className="text-sm font-semibold">
            {tr(
              "Copy the new key now. It won’t be shown again.",
              "انسخ المفتاح الجديد الآن. لن يظهر مرة أخرى.",
            )}
          </p>
          <code dir="ltr" className="block break-all">
            {newKey}
          </code>
          <Button size="sm" variant="outline" onClick={() => setNewKey(undefined)}>
            {tr("Dismiss key", "إخفاء المفتاح")}
          </Button>
        </section>
      )}
      <form
        className="flex flex-wrap items-end gap-3 border-b pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const fields = new FormData(form);
          change.mutate(
            {
              kind: "create",
              name: String(fields.get("name")),
              email: String(fields.get("email")),
            },
            { onSuccess: () => form.reset() },
          );
        }}
      >
        <label className="grid gap-1 text-sm">
          {tr("Company name", "اسم الشركة")}
          <Input name="name" required maxLength={120} />
        </label>
        <label className="grid gap-1 text-sm">
          {tr("Owner email", "بريد صاحب الشركة")}
          <Input name="email" type="email" required />
        </label>
        <Button disabled={change.isPending}>
          {tr("Create and invite owner", "إنشاء الشركة ودعوة صاحبها")}
        </Button>
      </form>
      <label className="grid max-w-md gap-1 text-sm">
        {tr("Note for the next action (optional)", "ملاحظة للإجراء التالي (اختيارية)")}
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </label>
      {list.isPending ? (
        <p>{loading}</p>
      ) : list.isError ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{tr("Companies", "الشركات")}</h2>
            {!list.data.companies.length && (
              <p className="text-sm text-muted-foreground">
                {tr("No companies on this page.", "لا توجد شركات في الصفحة دي.")}
              </p>
            )}
            {list.data.companies.map((company) => {
              const sub = company.subscriptions;
              const license = list.data.licenses.find((key) => key.company_id === company.id);
              return (
                <article
                  key={company.id}
                  className="grid gap-3 border-b pb-3 lg:grid-cols-[1fr_2fr]"
                >
                  <div>
                    <h3 className="break-words font-semibold">{company.name}</h3>
                    <p className="break-all text-sm text-muted-foreground">{company.owner_email}</p>
                    {sub && company.displayStatus && (
                      <p
                        className={
                          company.displayStatus === "paid_needs_reactivation"
                            ? "text-sm font-semibold text-amber-700"
                            : "text-sm"
                        }
                      >
                        {plans[sub.plan].name} · {label(labels[company.displayStatus])} ·{" "}
                        {date(sub.expires_at)}
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant="link"
                      className="px-0"
                      onClick={() => {
                        setAuditDraft(company.id);
                        setAuditFilter(company.id);
                        setAuditPage(0);
                      }}
                    >
                      {tr("Filter audit by company", "عرض سجل الشركة")}
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {([1, 3, 12] as const).map((months) => (
                      <Button
                        key={months}
                        size="sm"
                        variant="outline"
                        disabled={change.isPending}
                        onClick={() => change.mutate({ kind: "extend", id: company.id, months })}
                      >
                        {tr(`+${months} mo.`, `+${months} شهر`)}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={change.isPending}
                      onClick={() => {
                        if (window.confirm(tr("Change company access?", "تغيير حالة وصول الشركة؟")))
                          change.mutate({
                            kind: sub?.status === "suspended" ? "reactivate" : "suspend",
                            id: company.id,
                          });
                      }}
                    >
                      {sub?.status === "suspended"
                        ? tr("Reactivate", "إعادة تفعيل")
                        : tr("Suspend", "إيقاف")}
                    </Button>
                    {license ? (
                      <>
                        <code dir="ltr" className="text-sm">
                          ••••-{license.key_suffix} ({license.max_devices})
                        </code>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={change.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                tr(
                                  "This is the company’s only active key. Revoking it blocks access until a new key is issued and activated.",
                                  "ده المفتاح النشط الوحيد. إلغاؤه هيوقف الوصول لحد إصدار مفتاح جديد وتفعيله.",
                                ),
                              )
                            )
                              change.mutate({ kind: "revoke", id: license.id });
                          }}
                        >
                          {tr("Revoke", "إلغاء المفتاح")}
                        </Button>
                      </>
                    ) : (
                      <form
                        className="flex flex-wrap items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          change.mutate({
                            kind: "license",
                            id: company.id,
                            devices: Number(new FormData(event.currentTarget).get("devices")),
                          });
                        }}
                      >
                        <Input
                          name="devices"
                          type="number"
                          defaultValue={1}
                          required
                          min={1}
                          max={sub ? deviceCaps[sub.plan] : 1}
                          className="w-24"
                          aria-label={tr("Device limit", "حد الأجهزة")}
                        />
                        <Button size="sm" variant="outline" disabled={change.isPending}>
                          <KeyRound className="size-4" />
                          {tr("Issue key", "إصدار مفتاح")}
                        </Button>
                      </form>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              {tr("Pending payments", "مدفوعات قيد المراجعة")}
            </h2>
            {!list.data.payments.length && (
              <p className="text-sm text-muted-foreground">
                {tr(
                  "No pending payments on this page.",
                  "لا توجد مدفوعات قيد المراجعة في الصفحة دي.",
                )}
              </p>
            )}
            {list.data.payments.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2"
              >
                <div className="min-w-0 break-all text-sm">
                  <p>
                    {p.company_id} · {plans[p.plan].name} · {amount(p.amount_egp)}
                  </p>
                  <p>
                    {label(methodNames[p.method])} · {p.transaction_ref} · {date(p.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.screenshot_url && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={change.isPending}
                      onClick={() => change.mutate({ kind: "receipt", id: p.id })}
                    >
                      {tr("Receipt link", "رابط الإيصال")}
                    </Button>
                  )}
                  {(["confirm", "reject"] as const).map((kind) => (
                    <Button
                      key={kind}
                      size="sm"
                      variant={kind === "confirm" ? "default" : "outline"}
                      disabled={change.isPending}
                      onClick={() => {
                        if (
                          window.confirm(tr("Apply payment decision?", "تأكيد قرار مراجعة الدفع؟"))
                        )
                          change.mutate({ kind, id: p.id });
                      }}
                    >
                      {kind === "confirm" ? tr("Confirm", "تأكيد") : tr("Reject", "رفض")}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
            {receiptUrl && (
              <a href={receiptUrl} target="_blank" rel="noreferrer" className="text-sm underline">
                {tr(
                  "Open receipt (link valid for one minute)",
                  "فتح الإيصال (الرابط صالح لمدة دقيقة)",
                )}
              </a>
            )}
          </section>
          <div className="flex gap-2">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>
              {tr("Previous", "السابق")}
            </Button>
            <Button
              variant="outline"
              disabled={(page + 1) * 25 >= list.data.total}
              onClick={() => setPage(page + 1)}
            >
              {tr("Next", "التالي")}
            </Button>
          </div>
        </>
      )}
      <section className="space-y-3 border-t pt-4" aria-labelledby="billing-audit">
        <h2 className="text-lg font-semibold" id="billing-audit">
          {tr("Billing audit", "سجل إجراءات الاشتراك")}
        </h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setAuditFilter(auditDraft.trim());
            setAuditPage(0);
          }}
        >
          <label className="grid min-w-0 gap-1 text-sm">
            {tr("Company ID", "معرّف الشركة")}
            <Input
              dir="ltr"
              value={auditDraft}
              onChange={(e) => setAuditDraft(e.target.value)}
              pattern="[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}"
            />
          </label>
          <Button variant="outline">{tr("Apply filter", "تطبيق الفلتر")}</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setAuditDraft("");
              setAuditFilter("");
              setAuditPage(0);
            }}
          >
            {tr("Clear", "مسح")}
          </Button>
        </form>
        {audit.isPending ? (
          <p>{loading}</p>
        ) : audit.isError ? (
          <p role="alert">{error}</p>
        ) : audit.data.entries.length === 0 ? (
          <p>{tr("No audit entries.", "لا توجد سجلات.")}</p>
        ) : (
          <>
            <ul className="divide-y">
              {audit.data.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="grid min-w-0 gap-1 py-2 text-sm sm:grid-cols-[1fr_2fr]"
                >
                  <div>
                    <strong>
                      {entry.action in auditLabels
                        ? label(auditLabels[entry.action as keyof typeof auditLabels])
                        : entry.action}
                    </strong>
                    <time dateTime={entry.created_at} className="block text-muted-foreground">
                      {date(entry.created_at)} ·{" "}
                      {new Date(entry.created_at).toLocaleTimeString(undefined, {
                        timeZone: "Africa/Cairo",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <div className="min-w-0 break-words">
                    <p>
                      {tr("Admin", "المسؤول")}: <bdi className="break-all">{entry.admin_id}</bdi>
                    </p>
                    <p>
                      {tr("Company", "الشركة")}: <bdi className="break-all">{entry.company_id}</bdi>
                    </p>
                    <p>
                      {tr("Reason", "السبب")}: {entry.reason}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={auditPage === 0}
                onClick={() => setAuditPage(auditPage - 1)}
              >
                {tr("Previous", "السابق")}
              </Button>
              <Button
                variant="outline"
                disabled={(auditPage + 1) * 25 >= audit.data.total}
                onClick={() => setAuditPage(auditPage + 1)}
              >
                {tr("Next", "التالي")}
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
