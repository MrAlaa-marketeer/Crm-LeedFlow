import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { FollowUpFormDialog } from "@/components/app/follow-up-form-dialog";
import { FollowUpItem } from "@/components/app/follow-up-item";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { useWorkspaceData } from "@/hooks/use-workspace";
import { useI18n } from "@/lib/i18n";
import {
  addCalendarDays,
  addCalendarMonths,
  localDateKey,
  localMonthGrid,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
} from "@/lib/calendar-dates";
import { dayBounds, dueBucket, formatDate, formatDateTime } from "@/lib/leads";
import { openFollowUpsQuery, followUpTasksQuery, type FollowUpTaskFilters } from "@/lib/queries";
import { summarizeReminders } from "@/lib/reminders";

export const Route = createFileRoute("/_authenticated/follow-ups")({
  head: () => ({
    meta: [
      { title: "المهام والمتابعات — LeadFlow | Tasks & follow-ups" },
      { name: "description", content: "Plan and manage real-estate lead follow-ups." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FollowUpsPage,
});

type Scope = "mine" | "team";
type ListFilter = "all" | "overdue" | "today" | "upcoming" | "completed";
type CalendarView = "day" | "week" | "month";
type PageView = "tasks" | "calendar";
const PAGE_SIZE = 500;

function FollowUpsPage() {
  const { t, dir, locale } = useI18n();
  const ws = useWorkspaceData();
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("mine");
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [pageView, setPageView] = useState<PageView>("tasks");
  const [calendarView, setCalendarView] = useState<CalendarView>("week");
  const [selectedDate, setSelectedDate] = useState(() => startOfLocalDay(new Date()));
  const [formOpen, setFormOpen] = useState(false);
  const [listLimit, setListLimit] = useState(PAGE_SIZE);
  const [calendarLimit, setCalendarLimit] = useState(PAGE_SIZE);

  const today = dayBounds();
  const todayStartIso = today.start.toISOString();
  const todayEndIso = today.end.toISOString();
  const listRange = useMemo(() => {
    if (listFilter === "overdue") return { from: null, to: todayStartIso };
    if (listFilter === "today") return { from: todayStartIso, to: todayEndIso };
    if (listFilter === "upcoming") return { from: todayEndIso, to: null };
    return { from: null, to: null };
  }, [listFilter, todayStartIso, todayEndIso]);

  const listFilters = useMemo<FollowUpTaskFilters>(
    () => ({
      assignedTo: scope === "mine" ? ws.userId : null,
      state: listFilter === "completed" ? "completed" : "open",
      from: listRange.from,
      to: listRange.to,
      limit: listLimit,
    }),
    [scope, ws.userId, listFilter, listRange, listLimit],
  );

  const calendarDates = useMemo(() => {
    if (calendarView === "day") return [startOfLocalDay(selectedDate)];
    if (calendarView === "week") {
      const first = startOfLocalWeek(selectedDate);
      return Array.from({ length: 7 }, (_, index) => addCalendarDays(first, index));
    }
    return localMonthGrid(selectedDate);
  }, [calendarView, selectedDate]);
  const calendarRange = useMemo(
    () => ({
      from: calendarDates[0]?.toISOString() ?? startOfLocalMonth(selectedDate).toISOString(),
      to: calendarDates.length
        ? addCalendarDays(calendarDates[calendarDates.length - 1]!, 1).toISOString()
        : undefined,
    }),
    [calendarDates, selectedDate],
  );
  const calendarFilters = useMemo<FollowUpTaskFilters>(
    () => ({
      assignedTo: scope === "mine" ? ws.userId : null,
      state: "all",
      from: calendarRange.from,
      to: calendarRange.to ?? null,
      limit: calendarLimit,
    }),
    [scope, ws.userId, calendarRange, calendarLimit],
  );

  const listQuery = useQuery({
    ...followUpTasksQuery(ws.workspace.id, listFilters),
    enabled: pageView === "tasks",
  });
  // Due-now banner source: all open follow-ups (any assignee/scope), so the
  // banner is correct whatever list filter or scope is selected. It does not
  // block the page — the banner simply stays hidden until it loads.
  const dueNowQuery = useQuery({
    ...openFollowUpsQuery(ws.workspace.id),
    enabled: pageView === "tasks",
  });
  const calendarQuery = useQuery({
    ...followUpTasksQuery(ws.workspace.id, calendarFilters),
    enabled: pageView === "calendar",
  });

  // Due-now banner: overdue + due within 24h across the whole workspace.
  // The per-item due date is already shown by FollowUpItem; the lead's
  // "next follow-up" is its earliest open item, which this list surfaces
  // first (openFollowUpsQuery orders by due_at ascending).
  // NOTE: these hooks must stay above the early returns below — hooks
  // cannot be called conditionally.
  const dueNowSummary = useMemo(
    () => (dueNowQuery.data ? summarizeReminders(dueNowQuery.data) : null),
    [dueNowQuery.data],
  );
  const dueNowOverdue = useMemo(
    () =>
      (dueNowQuery.data ?? []).filter((item) => dueBucket(item.due_at) === "overdue").slice(0, 3),
    [dueNowQuery.data],
  );

  if (pageView === "tasks" && listQuery.isPending) return <ListSkeleton rows={6} />;
  if (pageView === "tasks" && listQuery.isError)
    return <ErrorState error={listQuery.error} onRetry={() => router.invalidate()} />;
  if (pageView === "calendar" && calendarQuery.isPending) return <ListSkeleton rows={6} />;
  if (pageView === "calendar" && calendarQuery.isError)
    return <ErrorState error={calendarQuery.error} onRetry={() => router.invalidate()} />;

  const listData = listQuery.data;
  const calendarData = calendarQuery.data;
  const calendarRows = calendarData?.rows ?? [];
  const byDay = new Map<string, typeof calendarRows>();
  for (const row of calendarRows) {
    const key = localDateKey(new Date(row.due_at));
    const rows = byDay.get(key) ?? [];
    rows.push(row);
    byDay.set(key, rows);
  }
  const selectedDayRows = byDay.get(localDateKey(selectedDate)) ?? [];

  function moveDate(direction: -1 | 1) {
    setSelectedDate((date) => {
      if (calendarView === "day") return addCalendarDays(date, direction);
      if (calendarView === "week") return addCalendarDays(date, direction * 7);
      return addCalendarMonths(date, direction);
    });
    setCalendarLimit(PAGE_SIZE);
  }

  const monthTitle = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    selectedDate,
  );
  const dateLabel = (
    date: Date,
    options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" },
  ) => new Intl.DateTimeFormat(locale, options).format(date);
  const timeLabel = (iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  const listEmptyKey =
    listFilter === "overdue"
      ? "noOverdue"
      : listFilter === "today"
        ? "noToday"
        : listFilter === "upcoming"
          ? "noUpcoming"
          : listFilter === "completed"
            ? "noCompleted"
            : "noOpenTasks";

  return (
    <div className="space-y-6">
      <PageHeader title={t("tasksPageTitle")} description={t("tasksPageHint")}>
        <Button type="button" onClick={() => setFormOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          {t("newFollowUp")}
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("taskScopeMy")}>
          <Button
            type="button"
            variant={scope === "mine" ? "default" : "outline"}
            aria-pressed={scope === "mine"}
            onClick={() => {
              setScope("mine");
              setListLimit(PAGE_SIZE);
              setCalendarLimit(PAGE_SIZE);
            }}
          >
            {t("taskScopeMy")}
          </Button>
          <Button
            type="button"
            variant={scope === "team" ? "default" : "outline"}
            aria-pressed={scope === "team"}
            onClick={() => {
              setScope("team");
              setListLimit(PAGE_SIZE);
              setCalendarLimit(PAGE_SIZE);
            }}
          >
            <Users className="me-1 h-4 w-4" />
            {t("taskScopeTeam")}
          </Button>
        </div>
        <div className="flex gap-2" role="group" aria-label={t("viewLabel")}>
          <Button
            type="button"
            variant={pageView === "tasks" ? "default" : "outline"}
            aria-pressed={pageView === "tasks"}
            onClick={() => setPageView("tasks")}
          >
            {t("taskViewTasks")}
          </Button>
          <Button
            type="button"
            variant={pageView === "calendar" ? "default" : "outline"}
            aria-pressed={pageView === "calendar"}
            onClick={() => setPageView("calendar")}
          >
            {t("taskViewCalendar")}
          </Button>
        </div>
      </div>

      {pageView === "tasks" ? (
        <>
          {dueNowSummary && (dueNowSummary.overdue > 0 || dueNowSummary.dueSoon > 0) && (
            <section
              aria-label={t("dueNowTitle")}
              className={`space-y-3 rounded-xl border p-4 ${
                dueNowSummary.overdue > 0
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-warning/40 bg-warning/5"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{t("dueNowTitle")}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t("kpiDueHint", {
                      overdue: dueNowSummary.overdue,
                      today: dueNowSummary.dueSoon,
                    })}
                    {dueNowSummary.escalated > 0 &&
                      (dir === "rtl"
                        ? ` — ${dueNowSummary.escalated} متأخرة أكثر من 24 ساعة، راجع صفحة الأتمتة للتصعيد.`
                        : ` — ${dueNowSummary.escalated} overdue more than 24h, see Automation for escalation.`)}
                  </p>
                </div>
                {dueNowSummary.overdue > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setListFilter("overdue");
                      setListLimit(PAGE_SIZE);
                    }}
                  >
                    {t("tabOverdue")}
                  </Button>
                )}
              </div>
              {dueNowOverdue.length > 0 && (
                <ul className="space-y-2">
                  {dueNowOverdue.map((item) => (
                    <FollowUpItem key={item.id} item={item} />
                  ))}
                </ul>
              )}
            </section>
          )}
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("filtersLabel")}>
            {(["all", "overdue", "today", "upcoming", "completed"] as const).map((filter) => {
              const label =
                filter === "all"
                  ? t("taskFilterAll")
                  : t(
                      filter === "overdue"
                        ? "tabOverdue"
                        : filter === "today"
                          ? "tabToday"
                          : filter === "upcoming"
                            ? "tabUpcoming"
                            : "tabCompleted",
                    );
              return (
                <Button
                  key={filter}
                  type="button"
                  aria-pressed={listFilter === filter}
                  variant={listFilter === filter ? "default" : "outline"}
                  onClick={() => {
                    setListFilter(filter);
                    setListLimit(PAGE_SIZE);
                  }}
                >
                  {label}
                </Button>
              );
            })}
          </div>
          {listData?.rows.length ? (
            <ul className="space-y-2">
              {listData.rows.map((item) => (
                <FollowUpItem key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <EmptyState icon={CalendarClock} title={t("noResultsTitle")} body={t(listEmptyKey)} />
          )}
          {listData?.truncated && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => setListLimit((limit) => limit + PAGE_SIZE)}
              >
                {t("pipelineLoadMore", { shown: listData.rows.length, total: listData.total })}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("inAppOnly")}</p>
        </>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("calendarPrevious")}
                onClick={() => moveDate(-1)}
              >
                <ChevronLeft className="rtl:rotate-180" />
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSelectedDate(startOfLocalDay(new Date()));
                  setCalendarLimit(PAGE_SIZE);
                }}
              >
                {t("calendarToday")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("calendarNext")}
                onClick={() => moveDate(1)}
              >
                <ChevronRight className="rtl:rotate-180" />
              </Button>
              <h2 className="ms-2 min-w-32 font-semibold">
                {calendarView === "month"
                  ? monthTitle
                  : dateLabel(selectedDate, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
              </h2>
            </div>
            <div
              className="flex gap-1 rounded-lg border p-1"
              role="group"
              aria-label={t("calendarView")}
            >
              {(["day", "week", "month"] as const).map((view) => (
                <Button
                  key={view}
                  type="button"
                  size="sm"
                  variant={calendarView === view ? "default" : "ghost"}
                  aria-pressed={calendarView === view}
                  onClick={() => {
                    setCalendarView(view);
                    setCalendarLimit(PAGE_SIZE);
                  }}
                >
                  {t(
                    view === "day"
                      ? "calendarDay"
                      : view === "week"
                        ? "calendarWeek"
                        : "calendarMonth",
                  )}
                </Button>
              ))}
            </div>
          </div>

          {calendarView === "month" ? (
            <div className="overflow-x-auto rounded-xl border bg-card p-2">
              <div className="grid min-w-[700px] grid-cols-7 gap-1">
                {Array.from({ length: 7 }, (_, index) =>
                  addCalendarDays(startOfLocalWeek(startOfLocalMonth(selectedDate)), index),
                ).map((date) => (
                  <div
                    key={`weekday-${date.getDay()}`}
                    className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
                  >
                    {dateLabel(date, { weekday: "short" })}
                  </div>
                ))}
                {calendarDates.map((date) => {
                  const dateKey = localDateKey(date);
                  const dayTasks = byDay.get(dateKey) ?? [];
                  const currentMonth = date.getMonth() === selectedDate.getMonth();
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      aria-pressed={dateKey === localDateKey(selectedDate)}
                      onClick={() => setSelectedDate(date)}
                      className={`min-h-28 min-w-0 rounded-lg border p-1.5 text-start transition-colors hover:bg-accent ${dateKey === localDateKey(selectedDate) ? "border-primary bg-accent" : "border-transparent"} ${currentMonth ? "" : "opacity-50"}`}
                    >
                      <span className="text-xs font-medium">
                        {new Intl.DateTimeFormat(locale, { day: "numeric" }).format(date)}
                      </span>
                      <span className="mt-1 block space-y-1">
                        {dayTasks.slice(0, 2).map((item) => (
                          <span
                            key={item.id}
                            className="block truncate rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary"
                          >
                            {timeLabel(item.due_at)} · {item.title}
                          </span>
                        ))}
                        {dayTasks.length > 2 && (
                          <span className="block px-1 text-[10px] text-muted-foreground">
                            {t("calendarMoreTasks", { count: dayTasks.length - 2 })}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              className={`grid gap-3 ${calendarView === "day" ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-7"}`}
            >
              {calendarDates.map((date) => {
                const dateKey = localDateKey(date);
                const dayTasks = byDay.get(dateKey) ?? [];
                return (
                  <section key={dateKey} className="min-h-44 rounded-xl border bg-card p-3">
                    <button
                      type="button"
                      aria-pressed={dateKey === localDateKey(selectedDate)}
                      onClick={() => setSelectedDate(date)}
                      className="mb-3 w-full text-start font-semibold hover:text-primary"
                    >
                      {dateLabel(date, { weekday: "long", day: "numeric", month: "short" })}
                    </button>
                    {dayTasks.length ? (
                      <ul className="space-y-2">
                        {dayTasks.map((item) => (
                          <FollowUpItem key={item.id} item={item} compact />
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t("calendarNoTasks")}</p>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {calendarView === "month" && (
            <section className="space-y-3">
              <h3 className="font-semibold">
                {t("calendarSelectedDay", { date: formatDate(selectedDate, locale) })}
              </h3>
              {selectedDayRows.length ? (
                <ul className="space-y-2">
                  {selectedDayRows.map((item) => (
                    <FollowUpItem key={item.id} item={item} />
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
                  {t("calendarNoTasks")}
                </p>
              )}
            </section>
          )}
          {calendarData?.truncated && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCalendarLimit((limit) => limit + PAGE_SIZE)}
              >
                {t("pipelineLoadMore", {
                  shown: calendarData.rows.length,
                  total: calendarData.total,
                })}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("inAppOnly")}</p>
        </section>
      )}

      <FollowUpFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
