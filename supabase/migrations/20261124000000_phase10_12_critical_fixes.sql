-- Fix capture phone normalization/rate limiting and suppress recent duplicate submissions.
CREATE OR REPLACE FUNCTION public.capture_lead(
  _workspace_id uuid, _full_name text, _phone text, _budget_min numeric DEFAULT NULL,
  _preferred_area text DEFAULT NULL, _project text DEFAULT NULL, _source public.lead_source DEFAULT 'website',
  _honeypot text DEFAULT ''
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_phone text;
  v_phone_digits text;
  v_phone_hash text;
  v_limiter public.lead_capture_rate_limits%ROWTYPE;
  v_new_id uuid;
  v_assignee uuid;
BEGIN
  IF coalesce(_honeypot,'') <> '' THEN RAISE EXCEPTION 'invalid request'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = _workspace_id) THEN RAISE EXCEPTION 'invalid request'; END IF;
  IF nullif(trim(_full_name),'') IS NULL OR char_length(trim(_full_name)) > 150
    OR (_preferred_area IS NOT NULL AND char_length(_preferred_area)>200)
    OR (_project IS NOT NULL AND char_length(_project)>200)
    OR (_budget_min IS NOT NULL AND (_budget_min<0 OR _budget_min>=100000000000000)) THEN
    RAISE EXCEPTION 'invalid request';
  END IF;

  v_phone := regexp_replace(
    translate(trim(_phone), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
    '[^0-9+]', '', 'g'
  );
  IF v_phone LIKE '0020%' THEN
    v_phone := '+20' || substring(v_phone FROM 5);
  ELSIF v_phone LIKE '+20%' THEN
    NULL;
  ELSIF v_phone LIKE '20%' THEN
    v_phone := '+' || v_phone;
  ELSIF v_phone LIKE '0%' THEN
    v_phone := '+20' || substring(v_phone FROM 2);
  ELSE
    v_phone := '+20' || v_phone;
  END IF;
  IF v_phone !~ '^\+201[0125][0-9]{8}$' THEN RAISE EXCEPTION 'invalid Egyptian mobile'; END IF;

  v_phone_digits := substring(v_phone FROM 2);
  v_phone_hash := encode(extensions.digest(v_phone, 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(_workspace_id::text || v_phone_hash,0));

  SELECT rate_limit.* INTO v_limiter
  FROM public.lead_capture_rate_limits AS rate_limit
  WHERE rate_limit.workspace_id = _workspace_id
    AND rate_limit.phone_hash = v_phone_hash
  FOR UPDATE;
  IF v_limiter.window_started_at IS NOT NULL
    AND v_limiter.window_started_at > now() - interval '1 hour'
    AND v_limiter.attempts >= 5 THEN
    RAISE EXCEPTION 'rate limit exceeded';
  END IF;
  IF v_limiter.window_started_at IS NULL OR v_limiter.window_started_at <= now() - interval '1 hour' THEN
    INSERT INTO public.lead_capture_rate_limits AS rate_limit(workspace_id,phone_hash,window_started_at,attempts)
      VALUES (_workspace_id,v_phone_hash,now(),1)
      ON CONFLICT (workspace_id,phone_hash)
      DO UPDATE SET window_started_at=now(), attempts=1;
  ELSE
    UPDATE public.lead_capture_rate_limits AS rate_limit
      SET attempts=rate_limit.attempts+1
      WHERE rate_limit.workspace_id=_workspace_id AND rate_limit.phone_hash=v_phone_hash;
  END IF;

  SELECT l.id INTO v_new_id
  FROM public.leads AS l
  WHERE l.workspace_id = _workspace_id
    AND l.created_at >= now() - interval '24 hours'
    AND regexp_replace(l.phone, '[^0-9]', '', 'g') IN (
      v_phone_digits,
      '0' || substring(v_phone_digits FROM 3)
    )
  ORDER BY l.created_at
  LIMIT 1;
  IF v_new_id IS NOT NULL THEN RETURN v_new_id; END IF;

  v_assignee := public.assign_capture_lead(_workspace_id);
  INSERT INTO public.leads(workspace_id,full_name,phone,budget_min,preferred_area,interested_project,source,assigned_to)
    VALUES (_workspace_id, left(trim(_full_name),150), v_phone, _budget_min,
      left(nullif(trim(_preferred_area),''),200), left(nullif(trim(_project),''),200), _source, v_assignee)
    RETURNING id INTO v_new_id;
  RETURN v_new_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.capture_lead(uuid,text,text,numeric,text,text,public.lead_source,text) TO anon;

-- The trigger NEW record is a follow_up or activity, never a lead.
CREATE OR REPLACE FUNCTION public.mark_lead_first_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  v_first_response_at timestamptz;
  v_created_at timestamptz;
BEGIN
  SELECT l.first_response_at,l.created_at INTO v_first_response_at,v_created_at
  FROM public.leads AS l
  WHERE l.id=NEW.lead_id AND l.workspace_id=NEW.workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_first_response_at IS NULL THEN
    UPDATE public.leads AS l
    SET first_response_at=now(),
        first_response_minutes=round(extract(epoch FROM (now()-v_created_at))/60.0,2)
    WHERE l.id=NEW.lead_id AND l.workspace_id=NEW.workspace_id
      AND l.first_response_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS follow_up_first_response ON public.follow_ups;
CREATE TRIGGER follow_up_first_response
  AFTER UPDATE OF completed_at ON public.follow_ups
  FOR EACH ROW WHEN (OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL)
  EXECUTE FUNCTION public.mark_lead_first_response();
DROP TRIGGER IF EXISTS lead_activity_first_response ON public.lead_activities;
CREATE TRIGGER lead_activity_first_response
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW WHEN (NEW.activity_type IN ('lead.response_call','lead.response_whatsapp'))
  EXECUTE FUNCTION public.mark_lead_first_response();

-- Serialize claims per workspace/unit, reject another reserved or won deal,
-- and never release a unit held by another reserved/won deal.
CREATE OR REPLACE FUNCTION public.guard_deal_unit_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_unit_id uuid;
BEGIN
  v_unit_id := coalesce(NEW.unit_id,NEW.property_id);
  IF v_unit_id IS NULL OR NEW.stage NOT IN ('reserved','won') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text || v_unit_id::text,0));
  IF EXISTS (
    SELECT 1 FROM public.deals AS other_deal
    WHERE other_deal.workspace_id=NEW.workspace_id
      AND coalesce(other_deal.unit_id,other_deal.property_id)=v_unit_id
      AND other_deal.stage IN ('reserved','won')
      AND other_deal.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Unit already has an active or won deal';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS deals_guard_unit_claim ON public.deals;
CREATE TRIGGER deals_guard_unit_claim
  BEFORE INSERT OR UPDATE OF unit_id,property_id,stage ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.guard_deal_unit_claim();

CREATE OR REPLACE FUNCTION public.sync_deal_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE v_unit_id uuid;
BEGIN
  v_unit_id := coalesce(NEW.unit_id,NEW.property_id);
  IF v_unit_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.stage = 'reserved' THEN
    UPDATE public.properties AS p SET availability='reserved', updated_at=now()
      WHERE p.id=v_unit_id AND p.workspace_id=NEW.workspace_id AND p.availability IN ('available','reserved');
  ELSIF NEW.stage = 'won' THEN
    UPDATE public.properties AS p SET availability='sold', updated_at=now()
      WHERE p.id=v_unit_id AND p.workspace_id=NEW.workspace_id AND p.availability IN ('available','reserved','sold');
  ELSIF NEW.stage IN ('lost','cancelled') THEN
    UPDATE public.properties AS p SET availability='available', updated_at=now()
      WHERE p.id=v_unit_id AND p.workspace_id=NEW.workspace_id
        AND p.availability IN ('reserved','sold')
        AND NOT EXISTS (
          SELECT 1 FROM public.deals AS other_deal
          WHERE other_deal.workspace_id=NEW.workspace_id
            AND coalesce(other_deal.unit_id,other_deal.property_id)=v_unit_id
            AND other_deal.stage IN ('reserved','won')
            AND other_deal.id IS DISTINCT FROM NEW.id
        );
  END IF;
  RETURN NEW;
END; $$;
