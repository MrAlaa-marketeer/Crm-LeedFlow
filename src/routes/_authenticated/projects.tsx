import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import type { DictKey } from "@/lib/i18n-dict";
import { inventoryDb, type Developer, type Project, type Property } from "@/lib/inventory-client";
import { UnitMediaActions } from "@/components/app/unit-media-actions";
import { RentalsPanel } from "@/components/app/rentals-panel";

export const Route = createFileRoute("/_authenticated/projects")({
  head: () => ({
    meta: [
      { title: "المشروعات والمخزون — LeadFlow | Projects & inventory" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: InventoryPage,
});

type Tab = "properties" | "projects" | "developers" | "rentals";
type RecordKind = "properties" | "projects" | "developers";
type InventoryForm = {
  id?: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  website: string;
  notes: string;
  developer_id: string;
  location: string;
  project_type: string;
  description: string;
  delivery_date: string;
  status: Project["status"];
  project_id: string;
  unit_code: string;
  property_type: Property["property_type"];
  area: string;
  bedrooms: string;
  bathrooms: string;
  price: string;
  payment_plan: string;
  availability: Property["availability"];
};

const emptyForm = (): InventoryForm => ({
  name: "",
  contact_name: "",
  email: "",
  phone: "",
  website: "",
  notes: "",
  developer_id: "",
  location: "",
  project_type: "",
  description: "",
  delivery_date: "",
  status: "planning",
  project_id: "",
  unit_code: "",
  property_type: "apartment",
  area: "",
  bedrooms: "",
  bathrooms: "",
  price: "",
  payment_plan: "",
  availability: "available",
});

function InventoryPage() {
  const { t, dir } = useI18n();
  const ws = useWorkspaceData();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("properties");
  const [q, setQ] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [propertyTypeFilter, setPropertyTypeFilter] = useState("all");
  const [minimumPrice, setMinimumPrice] = useState("");
  const [maximumPrice, setMaximumPrice] = useState("");
  const [kind, setKind] = useState<RecordKind | null>(null);
  const [form, setForm] = useState<InventoryForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const isArabic = dir === "rtl";

  const developersQuery = useQuery({
    queryKey: ["inventory", "developers", ws.workspace.id],
    queryFn: async () => {
      const { data, error } = await inventoryDb
        .from("developers")
        .select("*")
        .eq("workspace_id", ws.workspace.id)
        .order("name")
        .limit(1000);
      if (error) throw error;
      return data as Developer[];
    },
  });
  const projectsQuery = useQuery({
    queryKey: ["inventory", "projects", ws.workspace.id],
    queryFn: async () => {
      const { data, error } = await inventoryDb
        .from("projects")
        .select("*, developer:developers(name)")
        .eq("workspace_id", ws.workspace.id)
        .order("name")
        .limit(1000);
      if (error) throw error;
      return data as Project[];
    },
  });
  const propertiesQuery = useQuery({
    queryKey: ["inventory", "properties", ws.workspace.id],
    queryFn: async () => {
      const { data, error } = await inventoryDb
        .from("properties")
        .select("*, project:projects(name, location)")
        .eq("workspace_id", ws.workspace.id)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data as Property[];
    },
  });

  const filteredProperties = useMemo(() => {
    const term = q.trim().toLocaleLowerCase();
    return (propertiesQuery.data ?? []).filter((property) => {
      if (projectFilter !== "all" && property.project_id !== projectFilter) return false;
      if (availabilityFilter !== "all" && property.availability !== availabilityFilter)
        return false;
      if (propertyTypeFilter !== "all" && property.property_type !== propertyTypeFilter)
        return false;
      if (minimumPrice && (property.price == null || property.price < Number(minimumPrice)))
        return false;
      if (maximumPrice && (property.price == null || property.price > Number(maximumPrice)))
        return false;
      return (
        !term ||
        [
          property.unit_code,
          property.project?.name,
          property.project?.location,
          property.property_type,
        ].some((value) => value?.toLocaleLowerCase().includes(term))
      );
    });
  }, [
    propertiesQuery.data,
    q,
    projectFilter,
    availabilityFilter,
    propertyTypeFilter,
    minimumPrice,
    maximumPrice,
  ]);

  function openForm(recordKind: RecordKind, record?: Developer | Project | Property) {
    const next = emptyForm();
    if (recordKind === "developers" && record) {
      const d = record as Developer;
      Object.assign(next, {
        id: d.id,
        name: d.name,
        contact_name: d.contact_name ?? "",
        email: d.email ?? "",
        phone: d.phone ?? "",
        website: d.website ?? "",
        notes: d.notes ?? "",
      });
    } else if (recordKind === "projects" && record) {
      const p = record as Project;
      Object.assign(next, {
        id: p.id,
        name: p.name,
        developer_id: p.developer_id ?? "",
        location: p.location ?? "",
        project_type: p.project_type ?? "",
        description: p.description ?? "",
        delivery_date: p.delivery_date ?? "",
        status: p.status,
      });
    } else if (recordKind === "properties" && record) {
      const p = record as Property;
      Object.assign(next, {
        id: p.id,
        project_id: p.project_id,
        unit_code: p.unit_code,
        property_type: p.property_type,
        area: p.area?.toString() ?? "",
        bedrooms: p.bedrooms?.toString() ?? "",
        bathrooms: p.bathrooms?.toString() ?? "",
        price: p.price?.toString() ?? "",
        payment_plan: p.payment_plan ?? "",
        availability: p.availability,
      });
    }
    setForm(next);
    setKind(recordKind);
  }

  async function saveRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind || saving) return;
    setSaving(true);
    try {
      const table: "developers" | "projects" | "properties" = kind;
      let payload: Record<string, unknown>;
      if (kind === "developers")
        payload = {
          name: form.name.trim(),
          contact_name: form.contact_name.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          website: form.website.trim() || null,
          notes: form.notes.trim() || null,
        };
      else if (kind === "projects")
        payload = {
          name: form.name.trim(),
          developer_id: form.developer_id || null,
          location: form.location.trim() || null,
          project_type: form.project_type.trim() || null,
          description: form.description.trim() || null,
          delivery_date: form.delivery_date || null,
          status: form.status,
        };
      else
        payload = {
          project_id: form.project_id,
          unit_code: form.unit_code.trim(),
          property_type: form.property_type,
          area: form.area ? Number(form.area) : null,
          bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
          bathrooms: form.bathrooms ? Number(form.bathrooms) : null,
          price: form.price ? Number(form.price) : null,
          payment_plan: form.payment_plan.trim() || null,
          availability: form.availability,
        };
      const query = form.id
        ? inventoryDb
            .from(table)
            .update(payload)
            .eq("id", form.id)
            .eq("workspace_id", ws.workspace.id)
        : inventoryDb.from(table).insert({ ...payload, workspace_id: ws.workspace.id });
      const { error } = await query;
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success(t("inventorySaved"));
      setKind(null);
    } catch (error) {
      toast.error(t("somethingWrong"));
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord(recordKind: RecordKind, recordId: string) {
    if (ws.role !== "owner" || !window.confirm(t("deleteConfirm"))) return;
    try {
      const { error } = await inventoryDb
        .from(recordKind)
        .delete()
        .eq("id", recordId)
        .eq("workspace_id", ws.workspace.id);
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success(t("inventoryDeleted"));
    } catch (error) {
      toast.error(t("somethingWrong"));
    }
  }

  const error = developersQuery.error || projectsQuery.error || propertiesQuery.error;
  const pending = developersQuery.isPending || projectsQuery.isPending || propertiesQuery.isPending;
  const formTitle =
    kind === "developers"
      ? t("addDeveloper")
      : kind === "projects"
        ? t("addProject")
        : t("addProperty");
  const propertyTypes: Property["property_type"][] = [
    "apartment",
    "villa",
    "townhouse",
    "duplex",
    "penthouse",
    "studio",
    "commercial",
    "land",
    "other",
  ];
  const propertyTypeKey: Record<Property["property_type"], DictKey> = {
    apartment: "typeApartment",
    villa: "typeVilla",
    townhouse: "typeTownhouse",
    duplex: "typeDuplex",
    penthouse: "typePenthouse",
    studio: "typeStudio",
    commercial: "typeCommercial",
    land: "typeLand",
    other: "typeOther",
  };
  const projectStatusKey: Record<Project["status"], DictKey> = {
    planning: "statusPlanning",
    under_construction: "statusConstruction",
    ready: "statusReady",
    paused: "statusPaused",
    completed: "statusCompleted",
  };
  const availabilityKey: Record<Property["availability"], DictKey> = {
    available: "available",
    reserved: "reserved",
    sold: "sold",
    unavailable: "unavailable",
  };

  return (
    <div dir={dir} className="space-y-6">
      <PageHeader title={t("inventoryTitle")} description={t("inventorySubtitle")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("inventoryTitle")}>
          {(["properties", "projects", "developers", "rentals"] as Tab[]).map((item) => (
            <Button
              key={item}
              role="tab"
              aria-selected={tab === item}
              variant={tab === item ? "default" : "outline"}
              onClick={() => setTab(item)}
            >
              {item === "rentals" ? (isArabic ? "الإيجارات" : "Rentals") : t(item)}
            </Button>
          ))}
        </div>
        {tab !== "rentals" && (
          <Button onClick={() => openForm(tab as RecordKind)} className="gap-2">
            <Plus className="h-4 w-4" />
            {t(
              tab === "properties"
                ? "addProperty"
                : tab === "projects"
                  ? "addProject"
                  : "addDeveloper",
            )}
          </Button>
        )}
      </div>

      {tab === "properties" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div className="relative">
            <Search className="absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="ps-9"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("searchInventory")}
            />
          </div>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allProjects")}</SelectItem>
              {(projectsQuery.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={availabilityFilter} onValueChange={setAvailabilityFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allAvailability")}</SelectItem>
              {(["available", "reserved", "sold", "unavailable"] as const).map((s) => (
                <SelectItem key={s} value={s}>
                  {t(availabilityKey[s])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={propertyTypeFilter} onValueChange={setPropertyTypeFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allPropertyTypes")}</SelectItem>
              {propertyTypes.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(propertyTypeKey[s])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min="0"
            value={minimumPrice}
            onChange={(e) => setMinimumPrice(e.target.value)}
            placeholder={`${t("price")} ≥`}
            aria-label={`${t("price")} minimum`}
          />
          <Input
            type="number"
            min="0"
            value={maximumPrice}
            onChange={(e) => setMaximumPrice(e.target.value)}
            placeholder={`${t("price")} ≤`}
            aria-label={`${t("price")} maximum`}
          />
        </div>
      )}

      {tab === "rentals" ? (
        <RentalsPanel
          workspaceId={ws.workspace.id}
          properties={(propertiesQuery.data ?? []).map((p) => ({
            id: p.id,
            unit_code: p.unit_code,
            projectName: p.project?.name ?? null,
          }))}
          canDelete={ws.role === "owner"}
        />
      ) : error ? (
        <ErrorState
          error={error}
          onRetry={() => void qc.invalidateQueries({ queryKey: ["inventory"] })}
        />
      ) : pending ? (
        <ListSkeleton rows={5} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tab === "developers" &&
            (developersQuery.data ?? []).map((item) => (
              <article key={item.id} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{item.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.contact_name || item.email || item.phone || "—"}
                    </p>
                    {item.website && (
                      <a
                        className="mt-2 block text-sm text-primary underline"
                        href={item.website}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {item.website}
                      </a>
                    )}
                  </div>
                  <RecordActions
                    onEdit={() => openForm("developers", item)}
                    onDelete={() => void deleteRecord("developers", item.id)}
                    canDelete={ws.role === "owner"}
                    t={t}
                  />
                </div>
              </article>
            ))}
          {tab === "projects" &&
            (projectsQuery.data ?? []).map((item) => (
              <article key={item.id} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{item.name}</h2>
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      {item.location || "—"}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {item.developer?.name || t("noDeveloper")} ·{" "}
                      {t(projectStatusKey[item.status])}
                    </p>
                    {item.delivery_date && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("deliveryDate")}: {item.delivery_date}
                      </p>
                    )}
                  </div>
                  <RecordActions
                    onEdit={() => openForm("projects", item)}
                    onDelete={() => void deleteRecord("projects", item.id)}
                    canDelete={ws.role === "owner"}
                    t={t}
                  />
                </div>
              </article>
            ))}
          {tab === "properties" &&
            filteredProperties.map((item) => (
              <article key={item.id} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      <h2 className="truncate font-semibold">{item.unit_code}</h2>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.project?.name || t("noProject")} ·{" "}
                      {t(propertyTypeKey[item.property_type])}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {item.project?.location || "—"} {item.area != null && `· ${item.area} m²`}
                    </p>
                    <p className="mt-2 text-sm font-semibold">
                      {item.price == null
                        ? "—"
                        : new Intl.NumberFormat(isArabic ? "ar-EG" : "en-GB", {
                            maximumFractionDigits: 0,
                          }).format(item.price)}{" "}
                      · {t(availabilityKey[item.availability])}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.bedrooms ?? "—"} {t("bedsShort")} · {item.bathrooms ?? "—"}{" "}
                      {t("bathsShort")}
                    </p>
                  </div>
                  <RecordActions
                    onEdit={() => openForm("properties", item)}
                    onDelete={() => void deleteRecord("properties", item.id)}
                    canDelete={ws.role === "owner"}
                    t={t}
                  />
                </div>
                <UnitMediaActions
                  unit={item}
                  workspaceId={ws.workspace.id}
                  company={ws.workspace.name}
                  agent={ws.profile.full_name || ws.email}
                  agentPhone={ws.profile.phone || ""}
                />
              </article>
            ))}
          {tab === "properties" && filteredProperties.length === 0 && (
            <EmptyState icon={Building2} title={t("noProperties")} body={t("inventorySubtitle")} />
          )}
          {tab === "projects" && (projectsQuery.data ?? []).length === 0 && (
            <EmptyState icon={Building2} title={t("noProjects")} body={t("inventorySubtitle")} />
          )}
          {tab === "developers" && (developersQuery.data ?? []).length === 0 && (
            <EmptyState icon={Building2} title={t("noDevelopers")} body={t("inventorySubtitle")} />
          )}
        </div>
      )}

      <Dialog open={kind !== null} onOpenChange={(open) => !open && setKind(null)}>
        <DialogContent dir={dir}>
          <DialogHeader>
            <DialogTitle>{form.id ? t("editRecord") : formTitle}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveRecord} className="space-y-4">
            {kind === "developers" && (
              <>
                <Field
                  label={t("developer")}
                  required
                  value={form.name}
                  onChange={(name) => setForm({ ...form, name })}
                />
                <Field
                  label={t("contactName")}
                  value={form.contact_name}
                  onChange={(contact_name) => setForm({ ...form, contact_name })}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t("email")}
                    type="email"
                    value={form.email}
                    onChange={(email) => setForm({ ...form, email })}
                  />
                  <Field
                    label={t("phone")}
                    value={form.phone}
                    onChange={(phone) => setForm({ ...form, phone })}
                  />
                </div>
                <Field
                  label={t("website")}
                  type="url"
                  value={form.website}
                  onChange={(website) => setForm({ ...form, website })}
                />
                <TextField
                  label={t("description")}
                  value={form.notes}
                  onChange={(notes) => setForm({ ...form, notes })}
                />
              </>
            )}
            {kind === "projects" && (
              <>
                <Field
                  label={t("projects")}
                  required
                  value={form.name}
                  onChange={(name) => setForm({ ...form, name })}
                />
                <Label>{t("developer")}</Label>
                <Select
                  value={form.developer_id || "none"}
                  onValueChange={(developer_id) =>
                    setForm({ ...form, developer_id: developer_id === "none" ? "" : developer_id })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("noDeveloper")}</SelectItem>
                    {(developersQuery.data ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t("location")}
                    value={form.location}
                    onChange={(location) => setForm({ ...form, location })}
                  />
                  <Field
                    label={t("projectType")}
                    value={form.project_type}
                    onChange={(project_type) => setForm({ ...form, project_type })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t("deliveryDate")}
                    type="date"
                    value={form.delivery_date}
                    onChange={(delivery_date) => setForm({ ...form, delivery_date })}
                  />
                  <Select
                    value={form.status}
                    onValueChange={(status: Project["status"]) => setForm({ ...form, status })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        ["planning", "under_construction", "ready", "paused", "completed"] as const
                      ).map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(projectStatusKey[s])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <TextField
                  label={t("description")}
                  value={form.description}
                  onChange={(description) => setForm({ ...form, description })}
                />
              </>
            )}
            {kind === "properties" && (
              <>
                <Field
                  label={t("unitCode")}
                  required
                  value={form.unit_code}
                  onChange={(unit_code) => setForm({ ...form, unit_code })}
                />
                <Label>{t("projects")}</Label>
                <Select
                  required
                  value={form.project_id}
                  onValueChange={(project_id) => setForm({ ...form, project_id })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("allProjects")} />
                  </SelectTrigger>
                  <SelectContent>
                    {(projectsQuery.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    value={form.property_type}
                    onValueChange={(property_type: Property["property_type"]) =>
                      setForm({ ...form, property_type })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {propertyTypes.map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(propertyTypeKey[s])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={form.availability}
                    onValueChange={(availability: Property["availability"]) =>
                      setForm({ ...form, availability })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["available", "reserved", "sold", "unavailable"] as const).map((s) => (
                        <SelectItem key={s} value={s}>
                          {t(availabilityKey[s])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t("areaSqm")}
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.area}
                    onChange={(area) => setForm({ ...form, area })}
                  />
                  <Field
                    label={t("price")}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={(price) => setForm({ ...form, price })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t("bedrooms")}
                    type="number"
                    min="0"
                    max="50"
                    value={form.bedrooms}
                    onChange={(bedrooms) => setForm({ ...form, bedrooms })}
                  />
                  <Field
                    label={t("bathrooms")}
                    type="number"
                    min="0"
                    max="50"
                    value={form.bathrooms}
                    onChange={(bathrooms) => setForm({ ...form, bathrooms })}
                  />
                </div>
                <TextField
                  label={t("paymentPlan")}
                  value={form.payment_plan}
                  onChange={(payment_plan) => setForm({ ...form, payment_plan })}
                />
              </>
            )}
            <DialogFooter>
              <Button
                type="submit"
                disabled={saving || (kind === "properties" && !form.project_id)}
              >
                {saving ? t("saving") : t("saveChanges")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setKind(null)}>
                {t("cancel")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  min,
  max,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        min={min}
        max={max}
        step={step}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function RecordActions({
  onEdit,
  onDelete,
  canDelete,
  t,
}: {
  onEdit: () => void;
  onDelete: () => void;
  canDelete: boolean;
  t: (key: import("@/lib/i18n-dict").DictKey) => string;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <Button variant="ghost" size="icon" aria-label={t("editRecord")} onClick={onEdit}>
        <Pencil className="h-4 w-4" />
      </Button>
      {canDelete && (
        <Button variant="ghost" size="icon" aria-label={t("deleteRecord")} onClick={onDelete}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      )}
    </div>
  );
}
