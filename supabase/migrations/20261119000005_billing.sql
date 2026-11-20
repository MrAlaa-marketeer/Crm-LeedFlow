CREATE TABLE public.companies (
  id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  owner_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.billing_max_users(p text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE p WHEN 'starter' THEN 3 WHEN 'pro' THEN 10 END
$$;

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter','pro','business')),
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','expired','suspended')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '336 hours'),
  max_users integer GENERATED ALWAYS AS (public.billing_max_users(plan)) STORED,
  suspended_from text CHECK (suspended_from IN ('trial','active','expired'))
);

CREATE TABLE public.license_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies ON DELETE CASCADE,
  key text NOT NULL UNIQUE CHECK (key ~ '^LEAD-[A-F0-9]{4}-[A-F0-9]{4}$'),
  max_devices integer NOT NULL CHECK (max_devices BETWEEN 1 AND 1000),
  devices uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX license_one_active ON public.license_keys(company_id) WHERE status = 'active';

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('starter','pro','business')),
  term text NOT NULL CHECK (term IN ('monthly','annual')),
  amount_egp integer GENERATED ALWAYS AS (
    (CASE plan WHEN 'starter' THEN 699 WHEN 'pro' THEN 1499 ELSE 2999 END)
    * (CASE term WHEN 'annual' THEN 10 ELSE 1 END)) STORED,
  method text NOT NULL CHECK (method IN ('instapay','vodafone_cash','bank_transfer')),
  transaction_ref text NOT NULL CHECK (length(btrim(transaction_ref)) BETWEEN 3 AND 120),
  screenshot_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_reference_unique ON public.payments(method, lower(btrim(transaction_ref)))
  WHERE status <> 'rejected';
CREATE INDEX payments_company_created ON public.payments(company_id, created_at DESC);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.companies, public.subscriptions, public.license_keys, public.payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.companies, public.subscriptions, public.payments TO authenticated;
GRANT ALL ON public.companies, public.subscriptions, public.license_keys, public.payments TO service_role;
CREATE POLICY company_read ON public.companies FOR SELECT TO authenticated USING (public.is_workspace_member(id));
CREATE POLICY subscription_read ON public.subscriptions FOR SELECT TO authenticated USING (public.is_workspace_member(company_id));
CREATE POLICY payment_read ON public.payments FOR SELECT TO authenticated USING (public.has_workspace_role(company_id, 'owner'));

CREATE FUNCTION public.billing_bootstrap() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO public.companies(id,name,owner_email)
    VALUES (NEW.id,NEW.name,coalesce((SELECT email FROM auth.users WHERE id = NEW.created_by),''));
  INSERT INTO public.subscriptions(company_id) VALUES (NEW.id);
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.billing_bootstrap() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER workspace_billing AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.billing_bootstrap();

INSERT INTO public.companies(id,name,owner_email,created_at)
  SELECT w.id,w.name,coalesce(u.email,''),w.created_at FROM public.workspaces w
  LEFT JOIN auth.users u ON u.id=w.created_by;
-- Give existing workspaces a rollout grace period and preserve their current roster.
INSERT INTO public.subscriptions(company_id,plan)
  SELECT c.id, CASE WHEN count(m.id)>10 THEN 'business' WHEN count(m.id)>3 THEN 'pro' ELSE 'starter' END
  FROM public.companies c LEFT JOIN public.workspace_members m ON m.workspace_id=c.id GROUP BY c.id;

CREATE FUNCTION public.billing_workspace_open(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT public.is_workspace_member(cid) AND EXISTS (
    SELECT FROM public.subscriptions s WHERE s.company_id=cid
      AND s.status IN ('trial','active') AND s.starts_at<=now() AND s.expires_at>now())
$$;
REVOKE EXECUTE ON FUNCTION public.billing_workspace_open(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_workspace_open(uuid) TO authenticated;

CREATE FUNCTION public.billing_crm_open(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT public.billing_workspace_open(cid) AND (
    NOT EXISTS (SELECT FROM public.license_keys k WHERE k.company_id=cid)
    OR EXISTS (SELECT FROM public.license_keys k WHERE k.company_id=cid AND k.status='active'
      AND (nullif(current_setting('request.headers',true),'')::jsonb->>'x-leadflow-device')
        = ANY(ARRAY(SELECT unnest(k.devices)::text))))
$$;
REVOKE EXECUTE ON FUNCTION public.billing_crm_open(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_crm_open(uuid) TO authenticated;

-- Restrictive policies preserve every existing per-role policy.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_catalog.pg_tables
    WHERE schemaname='public' AND tablename NOT IN ('workspaces','workspace_members')
      AND EXISTS (SELECT FROM information_schema.columns
        WHERE table_schema='public' AND table_name=tablename AND column_name='workspace_id')
  LOOP
    EXECUTE format('CREATE POLICY billing_open ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (public.billing_crm_open(workspace_id)) WITH CHECK (public.billing_crm_open(workspace_id))',t);
  END LOOP;
END $$;

-- These owner RPCs bypass RLS internally; route them through the same entitlement check.
ALTER FUNCTION public.remove_workspace_member(uuid,uuid) RENAME TO billing_remove_member_internal;
ALTER FUNCTION public.cancel_workspace_invitation(uuid,uuid) RENAME TO billing_cancel_invitation_internal;
ALTER FUNCTION public.retry_automation_execution(uuid) RENAME TO billing_retry_internal;
REVOKE EXECUTE ON FUNCTION public.billing_remove_member_internal(uuid,uuid),
  public.billing_cancel_invitation_internal(uuid,uuid), public.billing_retry_internal(uuid)
  FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.remove_workspace_member(_workspace_id uuid,_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.billing_crm_open(_workspace_id) THEN RAISE EXCEPTION 'CRM access unavailable'; END IF;
  PERFORM public.billing_remove_member_internal(_workspace_id,_user_id);
END $$;
CREATE FUNCTION public.cancel_workspace_invitation(_workspace_id uuid,_invitation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.billing_crm_open(_workspace_id) THEN RAISE EXCEPTION 'CRM access unavailable'; END IF;
  PERFORM public.billing_cancel_invitation_internal(_workspace_id,_invitation_id);
END $$;
CREATE FUNCTION public.retry_automation_execution(_execution_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS(SELECT FROM public.automation_executions e WHERE e.id=_execution_id
    AND public.billing_crm_open(e.workspace_id)) THEN RAISE EXCEPTION 'CRM access unavailable'; END IF;
  PERFORM public.billing_retry_internal(_execution_id);
END $$;
REVOKE EXECUTE ON FUNCTION public.remove_workspace_member(uuid,uuid),
  public.cancel_workspace_invitation(uuid,uuid), public.retry_automation_execution(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.remove_workspace_member(uuid,uuid),
  public.cancel_workspace_invitation(uuid,uuid), public.retry_automation_execution(uuid) TO authenticated;

CREATE FUNCTION public.billing_seat_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s public.subscriptions;
BEGIN
  SELECT * INTO STRICT s FROM public.subscriptions WHERE company_id=NEW.workspace_id FOR UPDATE;
  IF s.status NOT IN ('trial','active') OR s.expires_at<=now() THEN
    RAISE EXCEPTION 'Subscription is not open';
  END IF;
  IF s.max_users IS NOT NULL AND (SELECT count(*) FROM public.workspace_members WHERE workspace_id=NEW.workspace_id)>=s.max_users THEN
    RAISE EXCEPTION 'Plan user limit reached';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.billing_seat_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER billing_seats BEFORE INSERT OR UPDATE OF workspace_id ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION public.billing_seat_guard();

CREATE FUNCTION public.billing_access(device uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('companyId',s.company_id,'plan',s.plan,'maxUsers',s.max_users,
    'status',CASE WHEN s.status <> 'suspended' AND s.expires_at<=now() THEN 'expired' ELSE s.status END,
    'expiresAt',s.expires_at,'allowed',public.billing_workspace_open(s.company_id),
    'owner',m.role='owner','needsLicense',
      EXISTS (SELECT FROM public.license_keys k WHERE k.company_id=s.company_id)
      AND NOT EXISTS (SELECT FROM public.license_keys k WHERE k.company_id=s.company_id AND k.status='active' AND device=ANY(k.devices)))
  FROM public.workspace_members m JOIN public.subscriptions s ON s.company_id=m.workspace_id
  WHERE m.user_id=auth.uid() ORDER BY m.created_at, m.id LIMIT 1
$$;

CREATE FUNCTION public.billing_activate(cid uuid, code text, device uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE k public.license_keys;
BEGIN
  IF device IS NULL OR NOT public.billing_workspace_open(cid) THEN RETURN false; END IF;
  SELECT * INTO k FROM public.license_keys WHERE company_id=cid AND key=code AND status='active' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF device=ANY(k.devices) THEN RETURN true; END IF;
  IF cardinality(k.devices)>=k.max_devices THEN RETURN false; END IF;
  UPDATE public.license_keys SET devices=array_append(devices,device) WHERE id=k.id;
  RETURN true;
END $$;
REVOKE EXECUTE ON FUNCTION public.billing_access(uuid), public.billing_activate(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_access(uuid), public.billing_activate(uuid,text,uuid) TO authenticated;

CREATE FUNCTION public.billing_admin_action(action text, target uuid, months integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE p public.payments;
DECLARE s public.subscriptions;
DECLARE cap integer;
BEGIN
  IF action IN ('confirm','reject') THEN
    SELECT * INTO STRICT p FROM public.payments WHERE id=target FOR UPDATE;
    IF p.status <> 'pending' THEN RAISE EXCEPTION 'Payment already reviewed'; END IF;
    IF action='reject' THEN
      UPDATE public.payments SET status='rejected' WHERE id=target;
      RETURN;
    END IF;
    target := p.company_id;
    months := CASE p.term WHEN 'annual' THEN 12 ELSE 1 END;
  END IF;
  SELECT * INTO STRICT s FROM public.subscriptions WHERE company_id=target FOR UPDATE;
  IF action IN ('confirm','extend') AND months IN (1,3,12) THEN
    cap := public.billing_max_users(coalesce(p.plan,s.plan));
    IF cap IS NOT NULL AND (SELECT count(*) FROM public.workspace_members WHERE workspace_id=target)>cap THEN
      RAISE EXCEPTION 'Reduce the roster before changing plans';
    END IF;
    UPDATE public.subscriptions SET plan=coalesce(p.plan,s.plan),
      status=CASE WHEN s.status='suspended' THEN 'suspended' ELSE 'active' END,
      suspended_from=CASE WHEN s.status='suspended' THEN 'active' END,
      expires_at=greatest(s.expires_at,now())+make_interval(months=>months)
      WHERE id=s.id;
    IF action='confirm' THEN UPDATE public.payments SET status='confirmed' WHERE id=p.id; END IF;
  ELSIF action='suspend' THEN
    UPDATE public.subscriptions SET status='suspended', suspended_from=s.status
      WHERE id=s.id AND s.status<>'suspended';
  ELSIF action='reactivate' THEN
    UPDATE public.subscriptions SET status=CASE WHEN s.expires_at<=now() THEN 'expired'
      ELSE coalesce(s.suspended_from,'active') END, suspended_from=NULL
      WHERE id=s.id AND s.status='suspended';
  ELSE
    RAISE EXCEPTION 'Invalid billing action';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.billing_admin_action(text,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_admin_action(text,uuid,integer) TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('payment-receipts','payment-receipts',false,5242880,ARRAY['image/png','image/jpeg','image/webp']);
