BEGIN;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('10000000-0000-0000-0000-000000000001','owner-a@example.test','{"agency_name":"Billing fixture A"}'),
 ('10000000-0000-0000-0000-000000000002','owner-b@example.test','{"agency_name":"Billing fixture B"}');
SELECT set_config('test.a',(SELECT id::text FROM public.companies WHERE owner_email='owner-a@example.test'),true);
SELECT set_config('test.b',(SELECT id::text FROM public.companies WHERE owner_email='owner-b@example.test'),true);
INSERT INTO public.workspace_invitations(id,workspace_id,email,invited_by) VALUES
 ('30000000-0000-0000-0000-000000000001',current_setting('test.a')::uuid,'agent@example.test','10000000-0000-0000-0000-000000000001');
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('10000000-0000-0000-0000-000000000003','agent@example.test','{"workspace_invitation_id":"30000000-0000-0000-0000-000000000001"}');
INSERT INTO public.leads(workspace_id,full_name,phone) VALUES
 (current_setting('test.a')::uuid,'Fixture A','0123456789'),
 (current_setting('test.b')::uuid,'Fixture B','0123456789');
INSERT INTO public.payments(id,company_id,plan,term,method,transaction_ref) VALUES
 ('20000000-0000-0000-0000-000000000001',current_setting('test.a')::uuid,'pro','annual','instapay','test-billing-ref-a'),
 ('20000000-0000-0000-0000-000000000002',current_setting('test.b')::uuid,'starter','monthly','instapay','test-billing-ref-b');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
DO $$
DECLARE a uuid := current_setting('test.a')::uuid;
BEGIN
  IF (SELECT count(*) FROM public.companies) <> 1 OR (SELECT count(*) FROM public.leads) <> 1
    OR (SELECT count(*) FROM public.payments) <> 1 THEN RAISE EXCEPTION 'Owner isolation failed'; END IF;
  IF NOT EXISTS(SELECT FROM public.subscriptions WHERE company_id=a AND status='trial'
    AND expires_at-starts_at=interval '336 hours' AND max_users=3)
    OR public.billing_access(NULL)->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Trial failed'; END IF;
  IF has_function_privilege(current_user,'public.billing_admin_action(text,uuid,uuid,text,integer,text,text,integer)','execute')
    OR has_table_privilege(current_user,'public.license_keys','select')
    OR has_table_privilege(current_user,'public.billing_audit','select')
    OR has_table_privilege(current_user,'public.billing_activation_attempts','select')
    OR has_table_privilege(current_user,'public.payments','update')
    THEN RAISE EXCEPTION 'Billing privileges are too broad'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.leads) <> 1 OR EXISTS(SELECT FROM public.payments)
    OR public.billing_access(NULL)->>'owner' IS DISTINCT FROM 'false'
    THEN RAISE EXCEPTION 'Agent permissions failed'; END IF;
END $$;

RESET ROLE;
UPDATE public.subscriptions SET expires_at=now()-interval '1 second' WHERE company_id=current_setting('test.a')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
DO $$ BEGIN
  IF public.billing_access(NULL)->>'status' IS DISTINCT FROM 'expired' OR EXISTS(SELECT FROM public.leads)
    OR (SELECT count(*) FROM public.payments)<>1 THEN RAISE EXCEPTION 'Expired gate failed'; END IF;
END $$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.billing_admin_action('confirm','20000000-0000-0000-0000-000000000001',auth.uid(),'Transfer matched');
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM public.subscriptions WHERE company_id=current_setting('test.a')::uuid
    AND plan='pro' AND status='active' AND expires_at=now()+interval '12 months' AND max_users=10)
    OR NOT EXISTS(SELECT FROM public.payments WHERE id='20000000-0000-0000-0000-000000000001'
      AND status='confirmed' AND amount_egp=14990) THEN RAISE EXCEPTION 'Annual confirmation failed'; END IF;
END $$;
SELECT public.billing_admin_action('extend',current_setting('test.a')::uuid,auth.uid(),'Extension verified',3);
DO $$ BEGIN
  BEGIN
    PERFORM public.billing_admin_action('confirm','20000000-0000-0000-0000-000000000001',auth.uid(),NULL);
    RAISE EXCEPTION 'Duplicate confirmation accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Payment already reviewed' THEN RAISE; END IF;
  END;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM public.subscriptions WHERE company_id=current_setting('test.a')::uuid
    AND expires_at=(now()+interval '12 months')+interval '3 months')
    THEN RAISE EXCEPTION 'Manual extension failed'; END IF;
END $$;
SELECT public.billing_admin_action('suspend',current_setting('test.a')::uuid,auth.uid(),'Manual hold');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.billing_audit WHERE company_id=current_setting('test.a')::uuid
    AND admin_id=auth.uid() AND action IN ('confirm','extend','suspend'))<>3
    OR NOT EXISTS(SELECT FROM public.billing_audit WHERE company_id=current_setting('test.a')::uuid
      AND action='confirm' AND reason='Transfer matched' AND payment_id IS NOT NULL)
    OR has_table_privilege(current_user,'public.billing_audit','insert')
    THEN RAISE EXCEPTION 'Audit is missing or directly writable'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF public.billing_access(NULL)->>'status' IS DISTINCT FROM 'suspended' OR EXISTS(SELECT FROM public.leads)
    THEN RAISE EXCEPTION 'Suspension failed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  INSERT INTO public.payments(id,company_id,plan,term,method,transaction_ref)
    VALUES ('20000000-0000-0000-0000-000000000003',current_setting('test.a')::uuid,'pro','monthly','instapay','test-suspended-payment');
  IF NOT public.billing_admin_action('confirm','20000000-0000-0000-0000-000000000003',auth.uid(),NULL)
    THEN RAISE EXCEPTION 'Paid suspension response failed'; END IF;
  IF NOT EXISTS (SELECT FROM public.subscriptions WHERE company_id=current_setting('test.a')::uuid
      AND status='suspended' AND paid_needs_reactivation)
    THEN RAISE EXCEPTION 'Paid suspension state failed'; END IF;
END $$;
SELECT public.billing_admin_action('reactivate',current_setting('test.a')::uuid,auth.uid(),NULL);
SELECT set_config('test.code','LEAD-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345',true);
SELECT public.billing_admin_action('license_issue',current_setting('test.a')::uuid,auth.uid(),NULL,
  digest_hex=>encode(sha256(convert_to(current_setting('test.code'),'UTF8')),'hex'),suffix=>'2345',devices=>1);
DO $$ BEGIN
  IF current_setting('test.code') !~ '^LEAD(-[A-HJ-NP-Z2-9]{4}){7}$'
    OR NOT EXISTS(SELECT FROM public.license_keys WHERE company_id=current_setting('test.a')::uuid AND key_suffix='2345')
    OR has_column_privilege(current_user,'public.license_keys','key_hash','select')
    THEN RAISE EXCEPTION 'License format or hash storage failed'; END IF;
  BEGIN
    PERFORM public.billing_admin_action('license_issue',current_setting('test.b')::uuid,auth.uid(),NULL,
      digest_hex=>repeat('1',64),suffix=>'6789',devices=>4);
    RAISE EXCEPTION 'Starter device cap bypassed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Invalid license parameters' THEN RAISE; END IF;
  END;
END $$;

RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM public.license_keys WHERE company_id=current_setting('test.a')::uuid
    AND key_hash=sha256(convert_to(current_setting('test.code'),'UTF8')))
    OR EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='license_keys' AND column_name='key')
    THEN RAISE EXCEPTION 'Expected hash-only license storage'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE a uuid := current_setting('test.a')::uuid;
DECLARE device uuid := '40000000-0000-0000-0000-000000000001';
BEGIN
  IF EXISTS(SELECT FROM public.leads) OR public.billing_access(device)->>'needsLicense' IS DISTINCT FROM 'true'
    THEN RAISE EXCEPTION 'Unlicensed gate failed'; END IF;
  IF public.billing_activate(current_setting('test.b')::uuid,current_setting('test.code'),device)
    OR NOT public.billing_activate(a,current_setting('test.code'),device)
    OR NOT public.billing_activate(a,current_setting('test.code'),device)
    OR public.billing_activate(a,current_setting('test.code'),'40000000-0000-0000-0000-000000000002')
    THEN RAISE EXCEPTION 'Activation or device limit failed'; END IF;
  PERFORM set_config('request.headers',jsonb_build_object('x-leadflow-device',device)::text,true);
  IF (SELECT count(*) FROM public.leads)<>1 THEN RAISE EXCEPTION 'Activated access failed'; END IF;
END $$;

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT public.billing_admin_action('license_revoke',(SELECT id FROM public.license_keys
  WHERE company_id=current_setting('test.a')::uuid),auth.uid(),NULL);
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT FROM public.leads) THEN RAISE EXCEPTION 'Revoked device access failed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  IF has_function_privilege(current_user,'public.billing_access(uuid)','execute')
    OR has_table_privilege(current_user,'public.companies','select')
    THEN RAISE EXCEPTION 'Anonymous billing access'; END IF;
END $$;
ROLLBACK;
