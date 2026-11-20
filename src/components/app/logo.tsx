import { cn } from "@/lib/utils";

export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-bold tracking-tight", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg text-sm",
          inverted
            ? "bg-sidebar-primary text-sidebar-primary-foreground"
            : "bg-navy-gradient text-primary-foreground",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M4 18 L10 11 L14 14 L20 6" />
          <circle cx="20" cy="6" r="1.5" fill="currentColor" />
        </svg>
      </span>
      <span lang="en" dir="ltr">
        LeadFlow
      </span>
    </span>
  );
}
