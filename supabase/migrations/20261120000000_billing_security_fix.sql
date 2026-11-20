ALTER TABLE public.license_keys ADD COLUMN key_hash bytea, ADD COLUMN key_suffix text;
UPDATE public.license_keys SET key_hash=sha256(convert_to(key,'UTF8')), key_suffix=right(key,4);
ALTER TABLE public.license_keys
  ALTER COLUMN key_hash SET NOT NULL, ALTER COLUMN key_suffix SET NOT NULL,
  ADD CONSTRAINT license_hash_length CHECK (octet_length(key_hash)=32),
  ADD CONSTRAINT license_hash_unique UNIQUE (key_hash),
  ADD CONSTRAINT license_suffix_format CHECK (key_suffix ~ '^[A-Z0-9]{4}$');

CREATE FUNCTION public.billing_device_cap(plan text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT CASE plan WHEN 'starter' THEN 3 WHEN 'pro' THEN 10 WHEN 'business' THEN 20 END
$$;
UPDATE public.license_keys k SET max_devices=least(k.max_devices, public.billing_device_cap(s.plan)),
  devices=k.devices[1:least(k.max_devices,public.billing_device_cap(s.plan))]
  FROM public.subscriptions s WHERE s.company_id=k.company_id;
ALTER TABLE public.license_keys ADD CONSTRAINT license_device_ceiling CHECK (max_devices<=20);
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.license_keys FROM service_role;
REVOKE SELECT ON public.license_keys FROM service_role;
GRANT SELECT (id,company_id,key_suffix,max_devices,status) ON public.license_keys TO service_role;

CREATE TABLE public.billing_activation_attempts (
  company_id uuid NOT NULL REFERENCES public.companies ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('device','account')),
  subject_id uuid NOT NULL,
  key_hash_prefix text NOT NULL,
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count BETWEEN 0 AND 5),
  last_attempt timestamptz NOT NULL,
  locked_until timestamptz,
  PRIMARY KEY (company_id,scope,subject_id)
);
ALTER TABLE public.billing_activation_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_activation_attempts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.billing_digest_matches(a bytea,b bytea) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
DECLARE diff integer := 0;
BEGIN
  IF octet_length(a)<>32 OR octet_length(b)<>32 THEN RETURN false; END IF;
  FOR i IN 0..31 LOOP
    diff := diff | (get_byte(a,i) # get_byte(b,i));
  END LOOP;
  RETURN diff=0;
END $$;
REVOKE EXECUTE ON FUNCTION public.billing_digest_matches(bytea,bytea) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.billing_activate(cid uuid, code text, device uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid := auth.uid();
DECLARE k public.license_keys;
DECLARE s public.subscriptions;
DECLARE ts timestamptz;
DECLARE prefix text;
DECLARE candidate bytea;
DECLARE matches boolean;
BEGIN
  IF cid IS NULL OR device IS NULL OR actor IS NULL OR NOT public.is_workspace_member(cid) THEN RETURN false; END IF;
  -- All activation and license writes serialize on the company subscription.
  SELECT * INTO s FROM public.subscriptions WHERE company_id=cid FOR UPDATE;
  SELECT * INTO k FROM public.license_keys WHERE company_id=cid AND status='active' FOR UPDATE;
  ts := clock_timestamp();
  candidate := sha256(convert_to(upper(btrim(left(coalesce(code,''),64))),'UTF8'));
  prefix := left(encode(candidate,'hex'),12);
  DELETE FROM public.billing_activation_attempts
    WHERE company_id=cid AND last_attempt<=ts-interval '15 minutes'
      AND (locked_until IS NULL OR locked_until<=ts);
  IF EXISTS (SELECT FROM public.billing_activation_attempts a WHERE a.company_id=cid
    AND ((scope='device' AND subject_id=device) OR (scope='account' AND subject_id=actor))
    AND locked_until>ts) THEN RETURN false; END IF;
  matches := public.billing_digest_matches(candidate,coalesce(k.key_hash,decode(repeat('00',32),'hex')));
  IF matches AND k.id IS NOT NULL AND s.status IN ('active','trial')
     AND s.starts_at<=ts AND s.expires_at>ts
     AND (device=ANY(k.devices) OR cardinality(k.devices)<least(k.max_devices,public.billing_device_cap(s.plan))) THEN
    IF NOT device=ANY(k.devices) THEN
      UPDATE public.license_keys SET devices=array_append(devices,device) WHERE id=k.id;
    END IF;
    DELETE FROM public.billing_activation_attempts WHERE company_id=cid AND
      ((scope='device' AND subject_id=device) OR (scope='account' AND subject_id=actor));
    RETURN true;
  END IF;
  INSERT INTO public.billing_activation_attempts AS a
    (company_id,scope,subject_id,key_hash_prefix,failed_count,last_attempt,locked_until)
    VALUES (cid,'device',device,prefix,1,ts,NULL),(cid,'account',actor,prefix,1,ts,NULL)
  ON CONFLICT (company_id,scope,subject_id) DO UPDATE
    SET key_hash_prefix=excluded.key_hash_prefix, failed_count=a.failed_count+1,
        last_attempt=ts, locked_until=CASE WHEN a.failed_count=4 THEN ts+interval '15 minutes' END;
  RETURN false;
END $$;
ALTER TABLE public.license_keys DROP COLUMN key;

ALTER TABLE public.subscriptions ADD COLUMN paid_needs_reactivation boolean NOT NULL DEFAULT false;

CREATE TABLE public.billing_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  admin_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('confirm','reject','extend','suspend','reactivate','license_issue','license_revoke')),
  company_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  payment_id uuid,
  license_key_id uuid,
  old_status text,
  new_status text NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX billing_audit_recent ON public.billing_audit(created_at DESC,id DESC);
CREATE INDEX billing_audit_company ON public.billing_audit(company_id,created_at DESC,id DESC);
ALTER TABLE public.billing_audit ENABLE ROW LEVEL SECURITY;
-- Only the server gateway can read, after checking the verified JWT against BILLING_OWNER_IDS.
REVOKE ALL ON public.billing_audit FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.billing_audit TO service_role;

DROP FUNCTION public.billing_admin_action(text,uuid,integer);
CREATE FUNCTION public.billing_admin_action(
  action text, target uuid, actor uuid, note text,
  months integer DEFAULT NULL, digest_hex text DEFAULT NULL,
  suffix text DEFAULT NULL, devices integer DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.payments;
DECLARE s public.subscriptions;
DECLARE k public.license_keys;
DECLARE old_sub public.subscriptions;
DECLARE cap integer;
DECLARE previous_status text;
DECLARE result_status text;
BEGIN
  -- The trusted server supplies the subject of its verified, allowlisted Auth token.
  IF actor IS NULL OR NOT EXISTS(SELECT FROM auth.users WHERE id=actor)
    OR (auth.uid() IS NOT NULL AND auth.uid()<>actor) THEN RAISE EXCEPTION 'Invalid billing actor'; END IF;
  note := coalesce(nullif(btrim(note),''),action);
  IF action IN ('confirm','reject') THEN
    SELECT * INTO STRICT p FROM public.payments WHERE id=target FOR UPDATE;
    IF p.status<>'pending' THEN RAISE EXCEPTION 'Payment already reviewed'; END IF;
    SELECT * INTO STRICT s FROM public.subscriptions WHERE company_id=p.company_id FOR UPDATE;
    months := CASE p.term WHEN 'annual' THEN 12 ELSE 1 END;
  ELSIF action='license_revoke' THEN
    SELECT * INTO STRICT s FROM public.subscriptions WHERE company_id=(
      SELECT company_id FROM public.license_keys WHERE id=target) FOR UPDATE;
    SELECT * INTO STRICT k FROM public.license_keys WHERE id=target AND status='active' FOR UPDATE;
  ELSE
    SELECT * INTO STRICT s FROM public.subscriptions WHERE company_id=target FOR UPDATE;
  END IF;
  old_sub := s;
  previous_status := s.status;
  IF action IN ('confirm','extend') AND months IN (1,3,12) THEN
    cap := public.billing_max_users(coalesce(p.plan,s.plan));
    IF cap IS NOT NULL AND (SELECT count(*) FROM public.workspace_members WHERE workspace_id=s.company_id)>cap
      THEN RAISE EXCEPTION 'Reduce the roster before changing plans'; END IF;
    UPDATE public.subscriptions SET plan=coalesce(p.plan,s.plan),
      status=CASE WHEN s.status='suspended' THEN 'suspended' ELSE 'active' END,
      suspended_from=CASE WHEN s.status='suspended' THEN 'active' END,
      paid_needs_reactivation=s.status='suspended' AND (s.paid_needs_reactivation OR action='confirm'),
      expires_at=greatest(s.expires_at,now())+make_interval(months=>months)
      WHERE id=s.id RETURNING * INTO s;
    IF action='confirm' THEN
      UPDATE public.payments SET status='confirmed' WHERE id=p.id;
      UPDATE public.license_keys lk SET max_devices=least(lk.max_devices,public.billing_device_cap(s.plan)),
        devices=lk.devices[1:least(lk.max_devices,public.billing_device_cap(s.plan))]
        WHERE lk.company_id=s.company_id AND lk.status='active';
    END IF;
  ELSIF action='reject' THEN
    UPDATE public.payments SET status='rejected' WHERE id=p.id;
  ELSIF action='suspend' AND s.status<>'suspended' THEN
    UPDATE public.subscriptions SET status='suspended',suspended_from=s.status
      WHERE id=s.id RETURNING * INTO s;
  ELSIF action='reactivate' AND s.status='suspended' THEN
    UPDATE public.subscriptions SET status=CASE WHEN s.expires_at<=now() THEN 'expired'
      ELSE coalesce(s.suspended_from,'active') END, suspended_from=NULL,paid_needs_reactivation=false
      WHERE id=s.id RETURNING * INTO s;
  ELSIF action='license_issue' THEN
    IF devices IS NULL OR devices NOT BETWEEN 1 AND public.billing_device_cap(s.plan)
      OR digest_hex IS NULL OR digest_hex !~ '^[0-9a-f]{64}$'
      OR suffix IS NULL OR suffix !~ '^[A-HJ-NP-Z2-9]{4}$' THEN RAISE EXCEPTION 'Invalid license parameters'; END IF;
    INSERT INTO public.license_keys(company_id,key_hash,key_suffix,max_devices)
      VALUES (s.company_id,decode(digest_hex,'hex'),suffix,devices) RETURNING * INTO k;
    previous_status := NULL;
  ELSIF action='license_revoke' THEN
    previous_status := k.status;
    UPDATE public.license_keys SET status='revoked' WHERE id=k.id RETURNING * INTO k;
  ELSE
    RAISE EXCEPTION 'Invalid billing action';
  END IF;
  result_status := coalesce(k.status,CASE WHEN action='reject' THEN 'rejected' ELSE s.status END);
  INSERT INTO public.billing_audit(admin_id,action,company_id,subscription_id,payment_id,
    license_key_id,old_status,new_status,reason,details)
  VALUES (actor,action,s.company_id,s.id,p.id,k.id,
    CASE WHEN action='reject' THEN p.status ELSE previous_status END,result_status,note,
    jsonb_strip_nulls(jsonb_build_object('old_plan',old_sub.plan,'new_plan',s.plan,
      'old_expires_at',old_sub.expires_at,'new_expires_at',s.expires_at,
      'months',CASE WHEN action IN ('confirm','extend') THEN months END,
      'payment_status',CASE action WHEN 'confirm' THEN 'confirmed' WHEN 'reject' THEN 'rejected' END,
      'max_devices',k.max_devices,'paid_needs_reactivation',s.paid_needs_reactivation)));
  RETURN s.paid_needs_reactivation;
END $$;
REVOKE EXECUTE ON FUNCTION public.billing_admin_action(text,uuid,uuid,text,integer,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_admin_action(text,uuid,uuid,text,integer,text,text,integer) TO service_role;
