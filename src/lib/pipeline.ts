import { LEAD_STATUSES, type LeadStatus } from "./leads";

export type PipelineStageCounts = Record<LeadStatus, number>;

export function groupPipelineLeads<T extends { status: LeadStatus }>(
  leads: readonly T[],
): Record<LeadStatus, T[]> {
  const groups = Object.fromEntries(
    LEAD_STATUSES.map((status) => [status, []]),
  ) as unknown as Record<LeadStatus, T[]>;
  for (const lead of leads) groups[lead.status].push(lead);
  return groups;
}

/** Won rate is measured only among closed outcomes (won + lost). */
export function pipelineWinRate(counts: PipelineStageCounts): number | null {
  const closed = counts.won + counts.lost;
  return closed ? Math.round((counts.won / closed) * 100) : null;
}
