import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LAST_NOTIFICATION_KEY = "last_sms_notification_at";
const SMS_SETTINGS_KEY = "sms_notification_settings";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("📅 Running scheduled SMS notification check");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get last notification timestamp
    const { data: settingData } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", LAST_NOTIFICATION_KEY)
      .maybeSingle();

    const lastNotificationAt = settingData?.value?.timestamp 
      ? new Date(settingData.value.timestamp) 
      : new Date(0); // If never sent, count all stories

    console.log(`📆 Last notification sent at: ${lastNotificationAt.toISOString()}`);

    // Count stories published since last notification
    const { count: newStoriesCount, error: countError } = await supabase
      .from("stories")
      .select("*", { count: "exact", head: true })
      .not("published_at", "is", null)
      .gt("published_at", lastNotificationAt.toISOString());

    if (countError) {
      console.error("❌ Error counting stories:", countError);
      throw countError;
    }

    console.log(`📰 Found ${newStoriesCount} new stories since last notification`);

    // If no new stories, skip sending
    if (!newStoriesCount || newStoriesCount === 0) {
      console.log("ℹ️ No new stories to notify about, skipping SMS");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No new stories since last notification",
          newStoriesCount: 0 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get NotificationAPI credentials
    const clientId = Deno.env.get("NOTIFICATIONAPI_CLIENT_ID");
    const clientSecret = Deno.env.get("NOTIFICATIONAPI_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      console.error("❌ NotificationAPI credentials not configured");
      return new Response(
        JSON.stringify({ error: "NotificationAPI credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch active notification recipients
    const { data: recipients, error: recipientsError } = await supabase
      .from("notification_recipients")
      .select("id, phone_number, name")
      .eq("is_active", true);

    if (recipientsError) {
      console.error("❌ Error fetching recipients:", recipientsError);
      throw recipientsError;
    }

    if (!recipients || recipients.length === 0) {
      console.log("⚠️ No active notification recipients found");
      return new Response(
        JSON.stringify({ success: true, message: "No active recipients to notify" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 Sending to ${recipients.length} recipient(s)`);

    // Get message template from settings
    const { data: smsSettingsData } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", SMS_SETTINGS_KEY)
      .maybeSingle();

    const defaultTemplate = "Check woodstockcommunity.news - there have been {{count}} {{stories}} published since the last notification";
    const messageTemplate = smsSettingsData?.value?.message_template || defaultTemplate;

    // Create the message by replacing placeholders
    const storyWord = newStoriesCount === 1 ? "story" : "stories";
    const message = messageTemplate
      .replace(/\{\{count\}\}/g, String(newStoriesCount))
      .replace(/\{\{stories\}\}/g, storyWord);

    // Create Basic auth header
    const authString = btoa(`${clientId}:${clientSecret}`);
    const results: { recipientId: string; success: boolean; error?: string }[] = [];

    // Send SMS to each recipient
    for (const recipient of recipients) {
      try {
        console.log(`📤 Sending SMS to ${recipient.name || recipient.phone_number}`);

        const response = await fetch(`https://api.notificationapi.com/${clientId}/sender`, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${authString}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "woodstock_community_news",
            to: {
              id: recipient.id,
              number: recipient.phone_number,
            },
            sms: {
              message: message,
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ NotificationAPI error for ${recipient.phone_number}:`, errorText);
          results.push({ recipientId: recipient.id, success: false, error: errorText });
        } else {
          console.log(`✅ SMS sent successfully to ${recipient.name || recipient.phone_number}`);
          results.push({ recipientId: recipient.id, success: true });
        }
      } catch (error) {
        console.error(`❌ Error sending SMS to ${recipient.phone_number}:`, error);
        results.push({ recipientId: recipient.id, success: false, error: String(error) });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`📊 SMS notifications complete: ${successCount}/${recipients.length} successful`);

    // Update last notification timestamp only if at least one SMS was sent successfully
    if (successCount > 0) {
      const now = new Date().toISOString();
      const { error: upsertError } = await supabase
        .from("app_settings")
        .upsert({
          key: LAST_NOTIFICATION_KEY,
          value: { timestamp: now },
          updated_at: now,
        }, { onConflict: "key" });

      if (upsertError) {
        console.error("⚠️ Failed to update last notification timestamp:", upsertError);
      } else {
        console.log(`✅ Updated last notification timestamp to ${now}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        newStoriesCount,
        totalRecipients: recipients.length,
        successCount,
        message: message,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Error in scheduled-sms-notification:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
