-- Filtered, workspace-scoped reporting aggregates. This depends on the Phase 5
-- inventory migration because it uses leads.interested_project_id/property_id.
CREATE INDEX leads_ws_assignee_created_idx
  ON public.leads(workspace_id, assigned_to, created_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX leads_ws_source_created_idx
  ON public.leads(workspace_id, source, created_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX follow_ups_ws_lead_completed_idx
  ON public.follow_ups(workspace_id, lead_id, completed_at, due_at);

CREATE OR REPLACE FUNCTION public.report_analytics(
  _workspace_id uuid,
  _from timestamptz,
  _to timestamptz,
  _assigned_to uuid DEFAULT NULL,
  _source public.lead_source DEFAULT NULL,
  _project_id uuid DEFAULT NULL,
  _status public.lead_status DEFAULT NULL,
  _timezone text DEFAULT 'UTC'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_workspace_member(_workspace_id) THEN
    RAISE EXCEPTION 'Not a member of this workspace';
  END IF;
  IF NOT public.has_workspace_role(_workspace_id, 'owner')
    AND _assigned_to IS NOT NULL AND _assigned_to <> auth.uid() THEN
    RAISE EXCEPTION 'Agents can only filter reports to themselves';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from >= _to THEN
    RAISE EXCEPTION 'Invalid report date range';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _timezone) THEN
    RAISE EXCEPTION 'Invalid report timezone';
  END IF;
  IF _assigned_to IS NOT NULL AND NOT public.is_user_in_workspace(_assigned_to, _workspace_id) THEN
    RAISE EXCEPTION 'Employee is not a member of this workspace';
  END IF;
  IF _project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = _project_id AND p.workspace_id = _workspace_id
  ) THEN
    RAISE EXCEPTION 'Project is not part of this workspace';
  END IF;

  WITH selected_leads AS MATERIALIZED (
    SELECT l.id, l.assigned_to, l.status, l.source, l.created_at,
      l.budget_max, l.interested_project_id, l.interested_property_id
    FROM public.leads l
    WHERE l.workspace_id = _workspace_id
      AND l.archived_at IS NULL
      AND l.created_at >= _from AND l.created_at < _to
      AND (public.has_workspace_role(_workspace_id, 'owner') OR l.assigned_to = auth.uid())
      AND (_assigned_to IS NULL OR l.assigned_to = _assigned_to)
      AND (_source IS NULL OR l.source = _source)
      AND (_project_id IS NULL OR l.interested_project_id = _project_id)
      AND (_status IS NULL OR l.status = _status)
  ), selected_follow_ups AS MATERIALIZED (
    SELECT f.id, f.lead_id, f.assigned_to, f.completed_at, f.due_at
    FROM public.follow_ups f
    JOIN selected_leads l ON l.id = f.lead_id
    WHERE f.workspace_id = _workspace_id
      AND (public.has_workspace_role(_workspace_id, 'owner') OR f.assigned_to = auth.uid())
      AND (_assigned_to IS NULL OR f.assigned_to = _assigned_to)
  ),
  lead_kpis AS (
    SELECT count(*) AS total_leads,
      count(*) FILTER (WHERE status = 'new') AS new_leads,
      count(*) FILTER (WHERE status = 'qualified') AS qualified_leads,
      count(*) FILTER (WHERE status = 'won') AS won_leads,
      count(*) FILTER (WHERE status = 'lost') AS lost_leads,
      CASE WHEN count(*) = 0 THEN 0::numeric
        ELSE round(100.0 * count(*) FILTER (WHERE status = 'won') / count(*), 1) END AS conversion_rate,
      coalesce(sum(budget_max) FILTER (WHERE budget_max IS NOT NULL), 0) AS lead_budget_max_sum
    FROM selected_leads
  ), follow_up_kpis AS (
    SELECT count(*) FILTER (WHERE completed_at IS NULL) AS open_follow_ups,
      count(*) FILTER (WHERE completed_at IS NULL AND due_at < now()) AS overdue_follow_ups,
      count(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at >= _from AND completed_at < _to) AS completed_follow_ups
    FROM selected_follow_ups
  ),
  status_counts AS (
    SELECT status, count(*) AS value FROM selected_leads GROUP BY status
  ),
  source_counts AS (
    SELECT source, count(*) AS value FROM selected_leads GROUP BY source
  ),
  monthly_counts AS (
    SELECT date_trunc('month', created_at AT TIME ZONE _timezone) AS month,
      count(*) AS total,
      count(*) FILTER (WHERE status = 'qualified') AS qualified,
      count(*) FILTER (WHERE status = 'won') AS won,
      count(*) FILTER (WHERE status = 'lost') AS lost
    FROM selected_leads GROUP BY date_trunc('month', created_at AT TIME ZONE _timezone)
  ),
  employee_leads AS (
    SELECT assigned_to AS user_id, count(*) AS lead_count,
      count(*) FILTER (WHERE status = 'won') AS won_count,
      count(*) FILTER (WHERE status = 'lost') AS lost_count
    FROM selected_leads WHERE assigned_to IS NOT NULL GROUP BY assigned_to
  ), employee_follow_ups AS (
    SELECT assigned_to AS user_id,
      count(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at >= _from AND completed_at < _to) AS completed_follow_up_count
    FROM selected_follow_ups WHERE assigned_to IS NOT NULL GROUP BY assigned_to
  ), employee_counts AS (
    SELECT wm.user_id, p.full_name, wm.role,
      coalesce(el.lead_count, 0) AS lead_count,
      coalesce(el.won_count, 0) AS won_count,
      coalesce(el.lost_count, 0) AS lost_count,
      coalesce(ef.completed_follow_up_count, 0) AS completed_follow_up_count
    FROM public.workspace_members wm
    JOIN public.profiles p ON p.id = wm.user_id
    LEFT JOIN employee_leads el ON el.user_id = wm.user_id
    LEFT JOIN employee_follow_ups ef ON ef.user_id = wm.user_id
    WHERE wm.workspace_id = _workspace_id
      AND (_assigned_to IS NULL OR wm.user_id = _assigned_to)
      AND (public.has_workspace_role(_workspace_id, 'owner') OR wm.user_id = auth.uid())
  ), project_counts AS (
    SELECT p.id, p.name,
      count(l.id) AS lead_count,
      count(l.id) FILTER (WHERE l.status = 'won') AS won_count,
      count(l.id) FILTER (WHERE l.interested_property_id IS NOT NULL) AS linked_unit_interest_count
    FROM selected_leads l
    JOIN public.projects p ON p.id = l.interested_project_id AND p.workspace_id = _workspace_id
    GROUP BY p.id, p.name
  )
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'total_leads', (SELECT total_leads FROM lead_kpis),
      'new_leads', (SELECT new_leads FROM lead_kpis),
      'qualified_leads', (SELECT qualified_leads FROM lead_kpis),
      'won_leads', (SELECT won_leads FROM lead_kpis),
      'lost_leads', (SELECT lost_leads FROM lead_kpis),
      'conversion_rate', (SELECT conversion_rate FROM lead_kpis),
      'open_follow_ups', (SELECT open_follow_ups FROM follow_up_kpis),
      'overdue_follow_ups', (SELECT overdue_follow_ups FROM follow_up_kpis),
      'completed_follow_ups', (SELECT completed_follow_ups FROM follow_up_kpis),
      'lead_budget_max_sum', (SELECT lead_budget_max_sum FROM lead_kpis)
    ),
    'by_status', coalesce((SELECT jsonb_object_agg(status, value) FROM status_counts), '{}'::jsonb),
    'by_source', coalesce((SELECT jsonb_object_agg(source, value) FROM source_counts), '{}'::jsonb),
    'monthly', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'month', month, 'total', total, 'qualified', qualified, 'won', won, 'lost', lost
    ) ORDER BY month) FROM monthly_counts), '[]'::jsonb),
    'employees', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'user_id', user_id, 'full_name', full_name, 'role', role,
      'lead_count', lead_count, 'won_count', won_count, 'lost_count', lost_count,
      'completed_follow_up_count', completed_follow_up_count
    ) ORDER BY full_name NULLS LAST) FROM employee_counts), '[]'::jsonb),
    'projects', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'project_id', id, 'project_name', name, 'lead_count', lead_count,
      'won_count', won_count, 'linked_unit_interest_count', linked_unit_interest_count
    ) ORDER BY lead_count DESC, name) FROM project_counts), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.report_analytics(uuid, timestamptz, timestamptz, uuid, public.lead_source, uuid, public.lead_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_analytics(uuid, timestamptz, timestamptz, uuid, public.lead_source, uuid, public.lead_status, text) TO authenticated;

COMMENT ON FUNCTION public.report_analytics(uuid, timestamptz, timestamptz, uuid, public.lead_source, uuid, public.lead_status, text) IS
  'Current-state reporting for non-archived leads created in [from,to). Won/lost are current statuses, not historical close events. Budget max sum is buyer budget, not booked sales value. Project analytics include only explicit inventory project links.';
