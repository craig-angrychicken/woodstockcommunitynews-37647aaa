import type { Env } from "../env";

/**
 * Send an alert/briefing email via Resend.
 * Workers call this directly on their error paths.
 */
export async function sendEmail(
  env: Env,
  opts: { subject: string; html: string; to?: string; from?: string },
): Promise<{ sent: boolean; id?: string; error?: string }> {
  if (!env.RESEND_API_KEY) {
    console.warn("[alert] RESEND_API_KEY not configured — skipping email");
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }
  const to = opts.to ?? env.ALERT_EMAIL;
  if (!to) {
    return { sent: false, error: "No recipient (ALERT_EMAIL unset)" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from ?? "WCN Pipeline <alerts@woodstockcommunity.news>",
      to: [to],
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!res.ok) {
    const error = await res.text();
    console.error("[alert] Resend error:", res.status, error);
    return { sent: false, error };
  }
  const data = (await res.json()) as { id?: string };
  return { sent: true, id: data.id };
}
