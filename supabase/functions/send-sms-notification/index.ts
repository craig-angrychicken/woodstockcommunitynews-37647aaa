import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

interface NotificationRequest {
  storyId: string;
  storyTitle: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { storyId, storyTitle }: NotificationRequest = await req.json();
    
    console.log(`📱 Sending SMS notification for story: ${storyTitle}`);

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

    // Create Supabase client with service role for fetching recipients
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch active notification recipients
    const { data: recipients, error: recipientsError } = await supabase
      .from("notification_recipients")
      .select("id, phone_number, name")
      .eq("is_active", true);

    if (recipientsError) {
      console.error("❌ Error fetching recipients:", recipientsError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch recipients" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!recipients || recipients.length === 0) {
      console.log("⚠️ No active notification recipients found");
      return new Response(
        JSON.stringify({ success: true, message: "No active recipients to notify" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📋 Found ${recipients.length} active recipient(s)`);

    // Create Basic auth header
    const authString = btoa(`${clientId}:${clientSecret}`);
    const results: { recipientId: string; success: boolean; error?: string }[] = [];

    // Send SMS to each recipient via NotificationAPI
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
              message: `New story ready for review: ${storyTitle}`,
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

    return new Response(
      JSON.stringify({
        success: true,
        totalRecipients: recipients.length,
        successCount,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("❌ Error in send-sms-notification:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
