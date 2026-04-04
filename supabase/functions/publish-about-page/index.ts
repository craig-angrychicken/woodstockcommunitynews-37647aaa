import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, handleCorsPrelight } from "../_shared/cors.ts";
import { generateGhostToken } from "../_shared/ghost-token.ts";

const ABOUT_PAGE_SLUG = "about";

const ABOUT_HTML = `<!--kg-card-begin: html-->
<div style="border-top: 3px solid #1a1a1a; padding-top: 1.2em; margin-bottom: 1.5em;">
  <p style="margin: 0; font-size: 1.4em; font-weight: 700; letter-spacing: -0.02em;">Woodstock Community News</p>
  <p style="margin: 0.2em 0 0; color: #555; font-size: 0.95em;">Woodstock, Georgia</p>
  <p style="margin: 0.4em 0 0; color: #555; font-size: 0.9em; font-style: italic;">The Woodstock Community News Staff</p>
  <p style="margin: 0.3em 0 0; color: #777; font-size: 0.85em;">Community journalism powered by AI, guided by AP standards</p>
</div>
<!--kg-card-end: html-->

<hr>

<h2>Who We Are</h2>
<p>Woodstock Community News is a local news publication covering Woodstock, Georgia. We believe that every community deserves quality journalism, even when traditional newsrooms can no longer provide it.</p>
<p>We are not a replacement for professional journalists. We are a complement, built to cover the primary source beats that local papers once staffed but increasingly do not.</p>

<hr>

<h2>Why We Exist</h2>
<p>Local news is disappearing. The United States has lost more than 2,500 newspapers since 2005. The communities most affected are often mid-sized and fast-growing cities, places like Woodstock, where civic life is active and consequential but coverage is thin.</p>
<p>Woodstock is a growing city with an engaged local government and a community that genuinely cares about where it lives. Quality local journalism isn't the responsibility of local or regional government, but market forces have reduced both the amount and quality of coverage available.</p>
<p>We built Woodstock Community News to help bridge that gap. Informed citizens make stronger neighbors, better voters, and more engaged members of their community. When people know what's happening around them, they show up to meetings, to elections, to the conversations that shape where they live.</p>

<hr>

<h2>How We Work: Transparency About AI</h2>
<p>We want to be fully transparent about how our journalism is produced.</p>
<p>Stories on this site are drafted by artificial intelligence (specifically, large language models) working from primary sources. Those sources include public records, official government documents, press releases from local agencies, RSS feeds from official channels, and official social media accounts of government bodies and public agencies. We do not generate content from rumors, unverified claims, or unofficial sources. We do not copy or use information from other journalistic outlets. We focus exclusively on primary source material directly from the sources in the communities we cover.</p>
<p>Every story passes through an automated fact-check that compares published claims against source documents before publication. Every story then undergoes an AI editorial review.</p>
<p>We do not generate opinion. We do not speculate. We do not editorialize. If a source document is ambiguous, we say so. If we cannot confirm a fact from primary sources, we do not include it.</p>
<p>This process is not perfect. No journalism is. But it is structured, sourced, and supervised.</p>

<hr>

<h2>Our Standards</h2>
<p>We follow Associated Press style.</p>
<p>We report from primary sources only. We do not relay secondhand accounts or unverified claims.</p>
<p>We do not editorialize. Our job is to surface what is already public, not to tell readers what to think about it.</p>
<p>When facts are disputed, we say so explicitly and cite the dispute.</p>
<p>We correct errors promptly and visibly. Corrections are noted in the body of the story, not buried or deleted.</p>
<p>We do not cover stories we cannot source. If we cannot point to a primary document, we do not publish.</p>

<hr>

<h2>What We Are Not</h2>
<p>We are not a replacement for professional journalism.</p>
<p>We do not do investigative reporting. We do not cultivate sources, conduct interviews, or do the on-the-ground work that accountability journalism requires. That work is irreplaceable, and we do not claim to replicate it.</p>
<p>We do not editorialize, endorse, or advocate.</p>
<p>We exist to do one thing: surface public information about Woodstock and make it readable, accessible, and available to the people who live here.</p>

<hr>

<!--kg-card-begin: html-->
<p><em>Woodstock Community News is an independent publication. It is not affiliated with any government agency, political party, business, or advocacy organization.</em></p>
<!--kg-card-end: html-->`;

serve(async (req) => {
  const corsResponse = handleCorsPrelight(req);
  if (corsResponse) return corsResponse;

  try {
    const ghostApiKey = Deno.env.get("GHOST_ADMIN_API_KEY");
    let ghostApiUrl = Deno.env.get("GHOST_API_URL");

    if (!ghostApiKey || !ghostApiUrl) {
      throw new Error("Ghost credentials not configured");
    }

    ghostApiUrl = ghostApiUrl.trim();
    if (!ghostApiUrl.startsWith("http://") && !ghostApiUrl.startsWith("https://")) {
      ghostApiUrl = `https://${ghostApiUrl}`;
    }
    ghostApiUrl = ghostApiUrl.replace(/\/$/, "");

    const token = await generateGhostToken(ghostApiKey);

    const authHeaders = {
      Authorization: `Ghost ${token}`,
      "Content-Type": "application/json",
      "Accept-Version": "v5.0",
    };

    // Check if the page already exists
    let pageId: string | null = null;
    let updatedAt: string | null = null;

    const getResponse = await fetch(
      `${ghostApiUrl}/ghost/api/admin/pages/slug/${ABOUT_PAGE_SLUG}/`,
      { method: "GET", headers: authHeaders }
    );

    if (getResponse.ok) {
      const existing = await getResponse.json();
      const page = existing.pages?.[0];
      if (page) {
        pageId = page.id;
        updatedAt = page.updated_at;
        console.log(`🔄 Existing about page found: ${pageId} (updated_at: ${updatedAt})`);
      }
    } else {
      console.log(`ℹ️ No existing page at slug '${ABOUT_PAGE_SLUG}' — will create`);
    }

    const pagePayload = {
      pages: [
        {
          title: "About",
          slug: ABOUT_PAGE_SLUG,
          html: ABOUT_HTML,
          status: "published",
          ...(pageId && updatedAt ? { updated_at: updatedAt } : {}),
        },
      ],
    };

    const method = pageId ? "PUT" : "POST";
    const endpoint = pageId
      ? `${ghostApiUrl}/ghost/api/admin/pages/${pageId}/?source=html`
      : `${ghostApiUrl}/ghost/api/admin/pages/?source=html`;

    console.log(`📝 ${method} about page to Ghost: ${endpoint}`);

    const response = await fetch(endpoint, {
      method,
      headers: authHeaders,
      body: JSON.stringify(pagePayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ghost API error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    const page = result.pages?.[0];

    console.log(`✅ About page ${pageId ? "updated" : "created"}: ${page?.url}`);

    return new Response(
      JSON.stringify({ success: true, pageId: page?.id, url: page?.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ publish-about-page error:", error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
