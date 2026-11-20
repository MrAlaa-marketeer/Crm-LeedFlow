export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addCalendarDays(date: Date, days: number): Date {
  const result = startOfLocalDay(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function startOfLocalWeek(date: Date): Date {
  return addCalendarDays(date, -date.getDay());
}

export function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addCalendarMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localMonthGrid(date: Date): Date[] {
  const first = startOfLocalMonth(date);
  const gridStart = startOfLocalWeek(first);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(gridStart, index));
}
