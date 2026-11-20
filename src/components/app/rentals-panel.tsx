import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { formatDate, formatMoney } from "@/lib/leads";
import { isRentalEndingSoon, rentalDaysRemaining } from "@/lib/phase-features";

export type RentalRow = {
  id: string;
  workspace_id: string;
  property_id: string | null;
  landlord_name: string;
  tenant_name: string;
  monthly_collection: number;
  starts_on: string;
  ends_on: string | null;
  renewal_reminder_on: string | null;
  status: string;
};

export type RentalPropertyOption = {
  id: string;
  unit_code: string;
  projectName: string | null;
};

const rentalsDb = supabase as unknown as {
  from: (table: "rental_contracts") => {
    select: (cols: string) => {
      eq: (
        col: string,
        value: string,
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean },
        ) => Promise<{
          data: RentalRow[] | null;
          error: Error | null;
        }>;
      };
    };
    insert: (row: Record<string, unknown>) => Promise<{ error: Error | null }>;
    update: (row: Record<string, unknown>) => {
      eq: (
        col: string,
        value: string,
      ) => {
        eq: (col: string, value: string) => Promise<{ error: Error | null }>;
      };
    };
    delete: () => {
      eq: (
        col: string,
        value: string,
      ) => {
        eq: (col: string, value: string) => Promise<{ error: Error | null }>;
      };
    };
  };
};

type RentalForm = {
  id?: string;
  property_id: string;
  landlord_name: string;
  tenant_name: string;
  monthly_collection: string;
  starts_on: string;
  ends_on: string;
  status: string;
};

const emptyForm = (): RentalForm => ({
  property_id: "",
  landlord_name: "",
  tenant_name: "",
  monthly_collection: "",
  starts_on: new Date().toISOString().slice(0, 10),
  ends_on: "",
  status: "active",
});

/**
 * Rental contracts (`rental_contracts`): list with tenant/owner, monthly rent,
 * start/end and status, plus a create/edit form. Ending-soon rentals are
 * flagged. Always scoped to the workspace.
 */
export function RentalsPanel({
  workspaceId,
  properties,
  canDelete,
}: {
  workspaceId: string;
  properties: RentalPropertyOption[];
  canDelete: boolean;
}) {
  const { t, dir, locale } = useI18n();
  const L = (ar: string, en: string) => (dir === "rtl" ? ar : en);
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RentalForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const rentalsQuery = useQuery({
    queryKey: ["rentals", workspaceId],
    queryFn: async () => {
      const { data, error } = await rentalsDb
        .from("rental_contracts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("starts_on", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RentalRow[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rentalsDb
        .from("rental_contracts")
        .delete()
        .eq("id", id)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["rentals", workspaceId] });
      toast.success(L("تم حذف عقد الإيجار.", "Rental contract deleted."));
    },
    onError: () => toast.error(t("somethingWrong")),
  });

  function openCreate() {
    setForm(emptyForm());
    setFormOpen(true);
  }

  function openEdit(row: RentalRow) {
    setForm({
      id: row.id,
      property_id: row.property_id ?? "",
      landlord_name: row.landlord_name,
      tenant_name: row.tenant_name,
      monthly_collection: String(row.monthly_collection),
      starts_on: row.starts_on,
      ends_on: row.ends_on ?? "",
      status: row.status,
    });
    setFormOpen(true);
  }

  async function saveRental(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const payload = {
        property_id: form.property_id || null,
        landlord_name: form.landlord_name.trim(),
        tenant_name: form.tenant_name.trim(),
        monthly_collection: Number(form.monthly_collection),
        starts_on: form.starts_on,
        ends_on: form.ends_on || null,
        status: form.status,
      };
      const { error } = form.id
        ? await rentalsDb
            .from("rental_contracts")
            .update(payload)
            .eq("id", form.id)
            .eq("workspace_id", workspaceId)
        : await rentalsDb
            .from("rental_contracts")
            .insert({ ...payload, workspace_id: workspaceId });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["rentals", workspaceId] });
      toast.success(L("تم حفظ عقد الإيجار.", "Rental contract saved."));
      setFormOpen(false);
    } catch {
      toast.error(t("somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  const propertyLabel = (row: RentalRow) => {
    const p = properties.find((item) => item.id === row.property_id);
    return p
      ? `${p.unit_code}${p.projectName ? ` · ${p.projectName}` : ""}`
      : L("بدون وحدة", "No unit");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          {L("عقود الإيجار", "Rental contracts")}
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            {(rentalsQuery.data ?? []).length}
          </span>
        </h2>
        <Button size="sm" onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          {L("عقد إيجار جديد", "New rental")}
        </Button>
      </div>

      {rentalsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : rentalsQuery.isError ? (
        <p className="text-sm text-destructive">{t("somethingWrong")}</p>
      ) : (rentalsQuery.data ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {L("لا توجد عقود إيجار بعد.", "No rental contracts yet.")}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(rentalsQuery.data ?? []).map((row) => {
            const remaining = rentalDaysRemaining(row.ends_on);
            const endingSoon = isRentalEndingSoon(row.ends_on, row.status);
            return (
              <article key={row.id} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{row.tenant_name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {L("المالك", "Owner")}: {row.landlord_name}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{propertyLabel(row)}</p>
                    <p className="mt-2 text-sm font-semibold">
                      {formatMoney(row.monthly_collection, locale)} / {L("شهر", "month")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(row.starts_on, locale)}
                      {row.ends_on ? ` – ${formatDate(row.ends_on, locale)}` : ""}
                      {remaining != null &&
                        ` · ${remaining >= 0 ? L("متبقٍ", "left") : L("منتهٍ منذ", "ended")} ${Math.abs(remaining)} ${L("يوم", "days")}`}
                    </p>
                    <p className="mt-1 text-xs">
                      <span
                        className={`rounded-full px-2 py-0.5 ${
                          row.status === "active"
                            ? "bg-status-won-soft text-status-won"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {row.status}
                      </span>
                      {endingSoon && (
                        <span className="ms-2 rounded-full bg-warning/10 px-2 py-0.5 text-warning">
                          {L("ينتهي قريبًا", "Ending soon")}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("edit")}
                      onClick={() => openEdit(row)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {canDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("delete")}
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm(t("deleteConfirm"))) deleteMutation.mutate(row.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={(open) => !open && setFormOpen(false)}>
        <DialogContent dir={dir}>
          <DialogHeader>
            <DialogTitle>
              {form.id
                ? L("تعديل عقد الإيجار", "Edit rental contract")
                : L("عقد إيجار جديد", "New rental contract")}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={saveRental} className="space-y-4">
            <div className="space-y-2">
              <Label>{L("الوحدة", "Unit")}</Label>
              <NativeSelect
                value={form.property_id}
                onChange={(event) => setForm({ ...form, property_id: event.target.value })}
              >
                <option value="">{L("بدون وحدة", "No unit")}</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.unit_code}
                    {p.projectName ? ` · ${p.projectName}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{L("اسم المالك", "Owner name")}</Label>
                <Input
                  required
                  value={form.landlord_name}
                  onChange={(event) => setForm({ ...form, landlord_name: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{L("اسم المستأجر", "Tenant name")}</Label>
                <Input
                  required
                  value={form.tenant_name}
                  onChange={(event) => setForm({ ...form, tenant_name: event.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{L("الإيجار الشهري (ج.م)", "Monthly rent (EGP)")}</Label>
                <Input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.monthly_collection}
                  onChange={(event) => setForm({ ...form, monthly_collection: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{L("الحالة", "Status")}</Label>
                <NativeSelect
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                >
                  {["active", "ended", "renewed", "cancelled"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{L("تاريخ البدء", "Start date")}</Label>
                <Input
                  required
                  type="date"
                  value={form.starts_on}
                  onChange={(event) => setForm({ ...form, starts_on: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{L("تاريخ الانتهاء", "End date")}</Label>
                <Input
                  type="date"
                  value={form.ends_on}
                  onChange={(event) => setForm({ ...form, ends_on: event.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving}>
                {saving ? t("saving") : t("saveChanges")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                {t("cancel")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
