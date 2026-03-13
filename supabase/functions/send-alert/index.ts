import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  try {
    const { functionName, errorMessage, timestamp, context } = await req.json();

    console.log("🚨 Alert triggered:", { functionName, errorMessage, timestamp });

    // Check for email service configuration
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const alertEmail = Deno.env.get("ALERT_EMAIL");

    if (!resendApiKey || !alertEmail) {
      console.warn("⚠️ Alert email not configured (RESEND_API_KEY or ALERT_EMAIL missing). Logging only.");
      console.error(`[ALERT] ${functionName}: ${errorMessage} at ${timestamp}`);
      return new Response(
        JSON.stringify({
          success: true,
          delivered: false,
          reason: "Email not configured — alert logged to console only",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send email via Resend
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Woodstock Wire Alerts <alerts@woodstockwire.com>",
        to: [alertEmail],
        subject: `[Alert] ${functionName} failed`,
        html: `
          <h2>Pipeline Alert</h2>
          <p><strong>Function:</strong> ${functionName}</p>
          <p><strong>Error:</strong> ${errorMessage}</p>
          <p><strong>Time:</strong> ${timestamp || new Date().toISOString()}</p>
          ${context ? `<p><strong>Context:</strong> <pre>${JSON.stringify(context, null, 2)}</pre></p>` : ""}
          <hr>
          <p><em>Sent by Woodstock Wire monitoring system</em></p>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("❌ Failed to send alert email:", errorText);
      return new Response(
        JSON.stringify({ success: false, error: `Email send failed: ${emailResponse.status}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ Alert email sent successfully");
    return new Response(
      JSON.stringify({ success: true, delivered: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("💥 Error in send-alert:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
