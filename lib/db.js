import { createClient } from "@supabase/supabase-js";

export function createDatabaseClient(environment = process.env) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase server credentials are required");
  }
  return createClient(
    environment.SUPABASE_URL,
    environment.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
}
