import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Access, Payment } from "./model";
import { deviceId } from "./device";

// Narrow adapter until the Supabase type generator is run against the new schema.
export const billingDb = (client: unknown) => client as SupabaseClient;

export async function loadAccess(): Promise<Access | null> {
  const { data, error } = await billingDb(supabase).rpc("billing_access", { device: deviceId() });
  if (error) throw error;
  return data as Access | null;
}

export async function activateLicense(companyId: string, code: string) {
  const { data, error } = await billingDb(supabase).rpc("billing_activate", {
    cid: companyId,
    code: code.trim().toUpperCase(),
    device: deviceId(),
  });
  if (error) throw error;
  return data === true;
}

export async function loadPayments(companyId: string): Promise<Payment[]> {
  const { data, error } = await billingDb(supabase)
    .from("payments")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data as Payment[];
}
