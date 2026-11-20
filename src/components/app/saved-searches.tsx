import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import {
  buildSavedSearchCriteria,
  parseSavedSearchCriteria,
  type LeadSearchCriteria,
} from "@/lib/phase-features";

type SavedSearchRow = {
  id: string;
  name: string;
  criteria: unknown;
  created_at: string;
};

const phaseDb = supabase as unknown as {
  from: (table: "saved_searches") => {
    select: (cols: string) => {
      eq: (
        col: string,
        value: string,
      ) => {
        order: (
          col: string,
          opts: { ascending: boolean },
        ) => Promise<{
          data: SavedSearchRow[] | null;
          error: Error | null;
        }>;
      };
    };
    insert: (row: Record<string, unknown>) => Promise<{ error: Error | null }>;
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

/**
 * Save the current lead-list filter into `saved_searches`, list the user's
 * saved searches, apply one (restores the filter state) or delete one.
 * Always scoped to the current workspace + user.
 */
export function SavedSearches({
  workspaceId,
  userId,
  currentFilters,
  onApply,
}: {
  workspaceId: string;
  userId: string;
  currentFilters: LeadSearchCriteria;
  onApply: (filters: LeadSearchCriteria) => void;
}) {
  const { t, dir } = useI18n();
  const L = (ar: string, en: string) => (dir === "rtl" ? ar : en);
  const qc = useQueryClient();
  const [name, setName] = useState("");

  const savedQuery = useQuery({
    queryKey: ["saved-searches", workspaceId, userId],
    queryFn: async () => {
      const { data, error } = await phaseDb
        .from("saved_searches")
        .select("id, name, criteria, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SavedSearchRow[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (searchName: string) => {
      const { error } = await phaseDb.from("saved_searches").insert({
        workspace_id: workspaceId,
        user_id: userId,
        name: searchName,
        criteria: buildSavedSearchCriteria(currentFilters),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setName("");
      await qc.invalidateQueries({ queryKey: ["saved-searches", workspaceId, userId] });
      toast.success(L("تم حفظ البحث.", "Search saved."));
    },
    onError: () => toast.error(t("somethingWrong")),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await phaseDb
        .from("saved_searches")
        .delete()
        .eq("id", id)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["saved-searches", workspaceId, userId] });
      toast.success(L("تم حذف البحث المحفوظ.", "Saved search deleted."));
    },
    onError: () => toast.error(t("somethingWrong")),
  });

  const hasActiveFilter = Object.values(currentFilters).some((v) => v !== "" && v !== "active");

  return (
    <section
      className="space-y-2 rounded-xl border bg-card p-4"
      aria-label={L("عمليات بحث محفوظة", "Saved searches")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Bookmark className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{L("عمليات بحث محفوظة", "Saved searches")}</h2>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={L("اسم البحث…", "Search name…")}
            aria-label={L("اسم البحث المحفوظ", "Saved search name")}
            className="w-44"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!name.trim() || !hasActiveFilter || saveMutation.isPending}
            onClick={() => saveMutation.mutate(name.trim())}
          >
            {L("حفظ الفلتر الحالي", "Save current filter")}
          </Button>
        </div>
      </div>
      {savedQuery.isPending ? (
        <p className="text-xs text-muted-foreground">{t("loading")}</p>
      ) : savedQuery.isError ? (
        <p className="text-xs text-destructive">{t("somethingWrong")}</p>
      ) : (savedQuery.data ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {L(
            "لا توجد عمليات بحث محفوظة. طبّق فلترًا ثم احفظه باسم.",
            "No saved searches yet. Apply a filter, then save it with a name.",
          )}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {(savedQuery.data ?? []).map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-1 rounded-full border bg-muted/50 py-1 pe-1 ps-3 text-xs"
            >
              <button
                type="button"
                className="font-medium hover:underline"
                onClick={() => onApply(parseSavedSearchCriteria(row.criteria))}
              >
                {row.name}
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label={L("حذف البحث المحفوظ", "Delete saved search")}
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(row.id)}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
