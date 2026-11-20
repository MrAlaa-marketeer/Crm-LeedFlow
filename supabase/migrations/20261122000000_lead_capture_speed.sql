-- Public capture writes go through capture_lead(); anon never receives table access.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_response_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_response_minutes numeric(12,2);
CREATE INDEX IF NOT EXISTS leads_workspace_response_idx ON public.leads(workspace_id, first_response_at);

CREATE TABLE public.lead_capture_rate_limits (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  phone_hash text NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, phone_hash)
);
CREATE TABLE public.lead_assignment_cursors (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  last_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
ALTER TABLE public.lead_capture_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_assignment_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_capture_rate_limits, public.lead_assignment_cursors FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assign_capture_lead(_workspace_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE last_id uuid; next_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_workspace_id::text,0));
  SELECT last_user_id INTO last_id FROM public.lead_assignment_cursors WHERE workspace_id=_workspace_id;
  SELECT wm.user_id INTO next_id FROM public.workspace_members wm
  WHERE wm.workspace_id=_workspace_id AND wm.role IN ('agent','owner')
  ORDER BY CASE WHEN last_id IS NULL OR (wm.created_at,wm.user_id) >
    (SELECT prev.created_at,prev.user_id FROM public.workspace_members prev
     WHERE prev.workspace_id=_workspace_id AND prev.user_id=last_id)
    THEN 0 ELSE 1 END, wm.created_at, wm.user_id LIMIT 1;
  IF next_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.lead_assignment_cursors(workspace_id,last_user_id) VALUES (_workspace_id,next_id)
    ON CONFLICT (workspace_id) DO UPDATE SET last_user_id=excluded.last_user_id;
  RETURN next_id;
END; $$;

CREATE OR REPLACE FUNCTION public.capture_lead(
  _workspace_id uuid, _full_name text, _phone text, _budget_min numeric DEFAULT NULL,
  _preferred_area text DEFAULT NULL, _project text DEFAULT NULL, _source public.lead_source DEFAULT 'website',
  _honeypot text DEFAULT ''
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  normalized text; phone_hash text; limiter public.lead_capture_rate_limits%ROWTYPE; new_id uuid;
  assignee uuid;
BEGIN
  IF coalesce(_honeypot,'') <> '' THEN RAISE EXCEPTION 'invalid request'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = _workspace_id) THEN RAISE EXCEPTION 'invalid request'; END IF;
  IF nullif(trim(_full_name),'') IS NULL OR char_length(trim(_full_name)) > 150
    OR (_preferred_area IS NOT NULL AND char_length(_preferred_area)>200)
    OR (_project IS NOT NULL AND char_length(_project)>200)
    OR (_budget_min IS NOT NULL AND (_budget_min<0 OR _budget_min>=100000000000000)) THEN
    RAISE EXCEPTION 'invalid request';
  END IF;
  normalized := regexp_replace(trim(_phone), '[^0-9+]', '', 'g');
  IF normalized LIKE '00%' THEN normalized := '+' || substring(normalized from 3); END IF;
  IF normalized LIKE '0%' THEN normalized := '+20' || substring(normalized from 2); END IF;
  IF normalized NOT LIKE '+%' THEN normalized := '+' || normalized; END IF;
  IF length(normalized) < 8 OR length(normalized) > 20 THEN RAISE EXCEPTION 'invalid phone'; END IF;
  phone_hash := encode(extensions.digest(normalized, 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(_workspace_id::text || phone_hash,0));
  SELECT * INTO limiter FROM public.lead_capture_rate_limits WHERE workspace_id = _workspace_id AND phone_hash = capture_lead.phone_hash FOR UPDATE;
  IF limiter.window_started_at IS NOT NULL AND limiter.window_started_at > now() - interval '1 hour' AND limiter.attempts >= 5 THEN
    RAISE EXCEPTION 'rate limit exceeded';
  END IF;
  IF limiter.window_started_at IS NULL OR limiter.window_started_at <= now() - interval '1 hour' THEN
    INSERT INTO public.lead_capture_rate_limits(workspace_id,phone_hash,window_started_at,attempts)
      VALUES (_workspace_id,phone_hash,now(),1)
      ON CONFLICT (workspace_id,phone_hash) DO UPDATE SET window_started_at=now(), attempts=1;
  ELSE UPDATE public.lead_capture_rate_limits r SET attempts=r.attempts+1 WHERE r.workspace_id=_workspace_id AND r.phone_hash=capture_lead.phone_hash; END IF;
  assignee := public.assign_capture_lead(_workspace_id);
  INSERT INTO public.leads(workspace_id,full_name,phone,budget_min,preferred_area,interested_project,source,assigned_to)
    VALUES (_workspace_id, left(trim(_full_name),150), normalized, _budget_min, left(nullif(trim(_preferred_area),''),200), left(nullif(trim(_project),''),200), _source, assignee)
    RETURNING id INTO new_id;
  RETURN new_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.capture_lead(uuid,text,text,numeric,text,text,public.lead_source,text) TO anon;
REVOKE ALL ON FUNCTION public.assign_capture_lead(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_lead_first_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF NEW.first_response_at IS NULL THEN
    UPDATE public.leads SET first_response_at=now(), first_response_minutes=round(extract(epoch from (now()-created_at))/60.0,2)
      WHERE id=NEW.lead_id AND first_response_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER follow_up_first_response AFTER UPDATE OF completed_at ON public.follow_ups
FOR EACH ROW WHEN (OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL)
EXECUTE FUNCTION public.mark_lead_first_response();
ALTER TABLE public.lead_activities DROP CONSTRAINT lead_activities_activity_type_check;
ALTER TABLE public.lead_activities ADD CONSTRAINT lead_activities_activity_type_check CHECK (activity_type IN (
  'lead.created','lead.updated','lead.status_changed','lead.archived','lead.restored','lead.deleted',
  'follow_up.created','follow_up.updated','follow_up.completed','follow_up.reopened','follow_up.deleted',
  'lead.response_call','lead.response_whatsapp'
));
CREATE TRIGGER lead_activity_first_response AFTER INSERT ON public.lead_activities
FOR EACH ROW WHEN (NEW.activity_type IN ('lead.response_call','lead.response_whatsapp'))
EXECUTE FUNCTION public.mark_lead_first_response();
CREATE POLICY "Members record lead responses" ON public.lead_activities FOR INSERT TO authenticated
WITH CHECK (
  activity_type IN ('lead.response_call','lead.response_whatsapp')
  AND actor_id=auth.uid()
  AND public.is_workspace_member(workspace_id)
  AND EXISTS (SELECT 1 FROM public.leads l WHERE l.id=lead_id AND l.workspace_id=lead_activities.workspace_id)
);

CREATE OR REPLACE FUNCTION public.speed_to_lead_report(_workspace_id uuid)
RETURNS TABLE(agent_id uuid, average_minutes numeric, waiting_over_five bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF NOT public.is_workspace_member(_workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
  SELECT l.assigned_to, round(avg(l.first_response_minutes) FILTER (WHERE l.first_response_minutes IS NOT NULL),2),
    count(*) FILTER (WHERE l.first_response_at IS NULL AND l.created_at < now()-interval '5 minutes')
  FROM public.leads l
  WHERE l.workspace_id=_workspace_id AND l.archived_at IS NULL
  GROUP BY l.assigned_to;
END; $$;
GRANT EXECUTE ON FUNCTION public.speed_to_lead_report(uuid) TO authenticated;
