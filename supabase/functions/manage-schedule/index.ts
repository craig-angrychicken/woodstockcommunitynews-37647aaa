import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ScheduleRequest {
  scheduleType: "artifact_fetch" | "ai_journalism" | "ai_editor";
  scheduledTimes: string[];
  isEnabled: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { scheduleType, scheduledTimes, isEnabled }: ScheduleRequest = await req.json();

    console.log(`📅 Managing schedule for ${scheduleType}:`, {
      times: scheduledTimes,
      enabled: isEnabled,
    });

    // Upsert schedule configuration in database
    const { data: schedule, error: upsertError } = await supabase
      .from("schedules")
      .upsert(
        {
          schedule_type: scheduleType,
          scheduled_times: scheduledTimes,
          is_enabled: isEnabled,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "schedule_type",
        }
      )
      .select()
      .single();

    if (upsertError) {
      throw new Error(`Failed to upsert schedule: ${upsertError.message}`);
    }

    console.log("✅ Schedule saved to database:", schedule);

    // Note: Actual cron job scheduling needs to be configured manually via SQL
    // The schedule configuration is now saved and can be used by cron jobs
    // to determine when to run

    return new Response(
      JSON.stringify({
        success: true,
        schedule,
        message: isEnabled && scheduledTimes.length > 0
          ? `Schedule configured with ${scheduledTimes.length} time(s). Cron jobs need to be set up via SQL.`
          : "Schedule saved but disabled or empty",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("💥 Error in manage-schedule:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
