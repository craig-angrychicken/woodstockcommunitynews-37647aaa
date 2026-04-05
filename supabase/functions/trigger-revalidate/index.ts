import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";

// Small utility: call Vercel's on-demand revalidation endpoint for one or
// more paths. Useful for refreshing a single story page after a DB-level
// fix without having to re-publish the story (which would move
// published_at and otherwise mutate the row).
//
// Request body: { paths: string[] }  // e.g. ["/", "/some-slug"]
serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  try {
    const { paths } = await req.json();
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error("paths (string[]) is required");
    }

    const secret = Deno.env.get("VERCEL_REVALIDATION_SECRET");
    if (!secret) {
      throw new Error("VERCEL_REVALIDATION_SECRET is not set");
    }

    const base = "https://woodstockcommunity.news/api/revalidate";
    const results = await Promise.all(
      paths.map(async (path: string) => {
        const normalized = path.startsWith("/") ? path : `/${path}`;
        const res = await fetch(
          `${base}?secret=${encodeURIComponent(secret)}&path=${encodeURIComponent(normalized)}`,
          { method: "POST" }
        );
        return { path: normalized, status: res.status, ok: res.ok };
      })
    );

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ trigger-revalidate error:", error);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
