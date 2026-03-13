import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function logCronJob(
  supabase: SupabaseClient,
  log: Record<string, unknown>
): Promise<void> {
  try {
    const { error } = await supabase.from("cron_job_logs").insert(log);
    if (error) {
      console.error("Failed to log cron job:", error);
    }
  } catch (err) {
    console.error("Failed to log cron job (exception):", err);
  }
}
