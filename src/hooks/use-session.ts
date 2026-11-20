import { useQuery } from "@tanstack/react-query";
import { isSupabaseConfigured, supabase } from "@/integrations/supabase/client";

/** Current signed-in user (or null). Kept fresh by the root onAuthStateChange subscriber. */
export function useSessionUser() {
  return useQuery({
    queryKey: ["session-user"],
    enabled: isSupabaseConfigured(),
    queryFn: async () => {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;
      return { id: data.user.id, email: data.user.email ?? "" };
    },
    staleTime: 30_000,
  });
}

/** Only same-origin, path-only redirects are allowed after sign-in. */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.startsWith("/auth") || value.startsWith("/reset-password")) return null;
  return value;
}
