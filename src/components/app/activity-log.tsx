import { CalendarClock, PhoneCall, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { formatDateTime } from "@/lib/leads";

export type CallEntry = {
  id: string;
  duration_seconds: number | null;
  outcome: string | null;
  notes: string | null;
  created_at: string;
};

export type VisitEntry = {
  id: string;
  property_id: string | null;
  starts_at: string;
  ends_at: string | null;
  status: string;
  feedback: string | null;
  created_at: string;
};

/**
 * Combined calls + visits history for one lead. Entries come straight from
 * the `calls` and `visits` tables (workspace-filtered by the caller).
 * `propertyLabel` resolves a visit's property_id to a display name.
 */
export function ActivityLog({
  calls,
  visits,
  propertyLabel,
  onDeleteCall,
  onDeleteVisit,
}: {
  calls: CallEntry[];
  visits: VisitEntry[];
  propertyLabel?: (propertyId: string | null) => string;
  onDeleteCall?: (id: string) => void;
  onDeleteVisit?: (id: string) => void;
}) {
  const { dir, locale } = useI18n();
  const L = (ar: string, en: string) => (dir === "rtl" ? ar : en);
  type Row =
    | { kind: "call"; at: string; call: CallEntry }
    | { kind: "visit"; at: string; visit: VisitEntry };
  const rows: Row[] = [
    ...calls.map((call): Row => ({ kind: "call", at: call.created_at, call })),
    ...visits.map((visit): Row => ({ kind: "visit", at: visit.starts_at, visit })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        {L("لا توجد مكالمات أو زيارات مسجلة بعد.", "No calls or visits logged yet.")}
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {rows.map((row) => {
        if (row.kind === "call") {
          const call = row.call;
          return (
            <li
              key={`call-${call.id}`}
              className="flex items-start gap-3 rounded-lg border bg-card p-3"
            >
              <span className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
                <PhoneCall className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {L("مكالمة", "Call")}
                  {call.outcome ? ` · ${call.outcome}` : ""}
                  {call.duration_seconds != null
                    ? ` · ${Math.round(call.duration_seconds / 60)} ${L("دقيقة", "min")}`
                    : ""}
                </p>
                {call.notes && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {call.notes}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(call.created_at, locale)}
                </p>
              </div>
              {onDeleteCall && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={L("حذف المكالمة", "Delete call")}
                  onClick={() => onDeleteCall(call.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </li>
          );
        }
        const visit = row.visit;
        return (
          <li
            key={`visit-${visit.id}`}
            className="flex items-start gap-3 rounded-lg border bg-card p-3"
          >
            <span className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
              <CalendarClock className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {L("زيارة", "Visit")}
                {` · ${propertyLabel ? propertyLabel(visit.property_id) : (visit.property_id ?? "—")}`}
                {` · ${visit.status}`}
              </p>
              {visit.feedback && (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {visit.feedback}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {formatDateTime(visit.starts_at, locale)}
                {visit.ends_at ? ` – ${formatDateTime(visit.ends_at, locale)}` : ""}
              </p>
            </div>
            {onDeleteVisit && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={L("حذف الزيارة", "Delete visit")}
                onClick={() => onDeleteVisit(visit.id)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
