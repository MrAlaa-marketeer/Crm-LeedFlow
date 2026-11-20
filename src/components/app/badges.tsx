import { FlaskConical } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { STATUS_STYLES, sourceKey, statusKey, type LeadSource, type LeadStatus } from "@/lib/leads";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  const { t } = useI18n();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLES[status].badge,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", STATUS_STYLES[status].dot)}
      />
      {t(statusKey(status))}
    </span>
  );
}

export function SourceBadge({ source }: { source: LeadSource }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-md border bg-card px-2 py-0.5 text-xs text-muted-foreground">
      {t(sourceKey(source))}
    </span>
  );
}

export function DemoBadge({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span
      title={t("demoBadgeTitle")}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-warning bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-warning-foreground",
        className,
      )}
    >
      <FlaskConical aria-hidden="true" className="h-3 w-3" />
      {t("demo")}
    </span>
  );
}
