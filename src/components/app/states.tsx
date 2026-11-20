import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  body,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed bg-card px-6 py-12 text-center",
        className,
      )}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon aria-hidden="true" className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

export function ErrorState({ onRetry }: { error?: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-xl border border-destructive/30 bg-destructive-soft px-6 py-10 text-center"
    >
      <AlertTriangle aria-hidden="true" className="mb-3 h-6 w-6 text-destructive" />
      <p className="font-medium">{t("somethingWrong")}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          {t("retry")}
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2" aria-busy="true" aria-label={t("loading")}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 sm:pt-1">{children}</div>}
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string | null | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-xs text-destructive">
      {message}
    </p>
  );
}
