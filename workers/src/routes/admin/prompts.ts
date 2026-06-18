import { Hono } from "hono";
import type { Env } from "../../env";
import { all, first, run, insert, fromJson, toJson } from "../../_shared/db";
import type { PromptVersionRow } from "../../_shared/types";

export const promptsRouter = new Hono<{ Bindings: Env }>();

/** Decode JSON TEXT columns the SPA expects as objects. */
function decodePrompt(row: PromptVersionRow): Record<string, unknown> {
  return {
    ...row,
    test_results: fromJson<unknown>(row.test_results, null),
  };
}

// GET /prompt-versions — active (default) / test-draft filtered list.
// Mirrors useActivePrompts: is_active=true AND is_test_draft=false ORDER BY prompt_type.
promptsRouter.get("/prompt-versions", async (c) => {
  const activeOnly = c.req.query("activeOnly") !== "false"; // default true
  const excludeTestDrafts = c.req.query("excludeTestDrafts") !== "false"; // default true

  const rows = await all<PromptVersionRow>(
    c.env,
    `SELECT * FROM prompt_versions WHERE is_active = ? AND is_test_draft = ? ORDER BY prompt_type`,
    activeOnly ? 1 : 0,
    excludeTestDrafts ? 0 : 1,
  );
  return c.json(rows.map(decodePrompt));
});

// GET /prompt-versions/drafts — useTestDrafts: is_test_draft=true ORDER BY created_at DESC.
promptsRouter.get("/prompt-versions/drafts", async (c) => {
  const testDraftsOnly = c.req.query("testDraftsOnly") !== "false"; // default true

  const rows = await all<PromptVersionRow>(
    c.env,
    `SELECT * FROM prompt_versions WHERE is_test_draft = ? ORDER BY created_at DESC`,
    testDraftsOnly ? 1 : 0,
  );
  return c.json(rows.map(decodePrompt));
});

// GET /prompt-versions/history — usePromptHistory: is_test_draft=false ORDER BY created_at DESC.
promptsRouter.get("/prompt-versions/history", async (c) => {
  const rows = await all<PromptVersionRow>(
    c.env,
    `SELECT * FROM prompt_versions WHERE is_test_draft = ? ORDER BY created_at DESC`,
    0,
  );
  return c.json(rows.map(decodePrompt));
});

// GET /prompt-versions/:id — usePromptVersion.
promptsRouter.get("/prompt-versions/:id", async (c) => {
  const id = c.req.param("id");
  const row = await first<PromptVersionRow>(
    c.env,
    `SELECT * FROM prompt_versions WHERE id = ?`,
    id,
  );
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(decodePrompt(row));
});

// POST /prompt-versions — EditPromptModal create / new test draft.
promptsRouter.post("/prompt-versions", async (c) => {
  const body = await c.req.json<{
    version_name: string;
    content: string;
    prompt_type: string;
    is_active?: boolean;
    is_test_draft?: boolean;
    update_notes?: string;
    based_on_version_id?: string | null;
    test_status?: string;
    author?: string;
  }>();

  const now = new Date().toISOString();
  const row = await insert<PromptVersionRow>(c.env, "prompt_versions", {
    id: crypto.randomUUID(),
    version_name: body.version_name,
    content: body.content,
    prompt_type: body.prompt_type,
    is_active: body.is_active ?? false, // encodeValue → 0/1
    is_test_draft: body.is_test_draft ?? false,
    update_notes: body.update_notes ?? null,
    based_on_version_id: body.based_on_version_id ?? null,
    test_status: body.test_status ?? null,
    author: body.author ?? null,
    created_at: now,
    updated_at: now,
  });
  return c.json(row ? decodePrompt(row) : null, 201);
});

// PATCH /prompt-versions/:id/activate — atomic 2-statement transaction.
// 1) deactivate every prompt of this type, 2) activate target & clear test-draft flag.
promptsRouter.patch("/prompt-versions/:id/activate", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ promptType?: string; prompt_type?: string }>();
  let promptType = body.promptType ?? body.prompt_type;

  // Fall back to the target row's prompt_type if not supplied.
  if (!promptType) {
    const target = await first<PromptVersionRow>(
      c.env,
      `SELECT prompt_type FROM prompt_versions WHERE id = ?`,
      id,
    );
    if (!target) return c.json({ error: "Not found" }, 404);
    promptType = target.prompt_type;
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE prompt_versions SET is_active = ?, updated_at = ? WHERE prompt_type = ?`)
      .bind(0, new Date().toISOString(), promptType),
    c.env.DB.prepare(
      `UPDATE prompt_versions SET is_active = ?, is_test_draft = ?, updated_at = ? WHERE id = ?`,
    ).bind(1, 0, new Date().toISOString(), id),
  ]);

  return c.json({ success: true, id, prompt_type: promptType });
});

// PATCH /prompt-versions/:id — EditPromptModal direct edit / test-draft update.
promptsRouter.patch("/prompt-versions/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    content: string;
    version_name: string;
    update_notes: string;
  }>();

  await run(
    c.env,
    `UPDATE prompt_versions SET content = ?, version_name = ?, update_notes = ?, updated_at = ? WHERE id = ?`,
    body.content,
    body.version_name,
    body.update_notes,
    new Date().toISOString(),
    id,
  );

  const row = await first<PromptVersionRow>(
    c.env,
    `SELECT * FROM prompt_versions WHERE id = ?`,
    id,
  );
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(decodePrompt(row));
});

// DELETE /prompt-versions/:id — Prompts.tsx deleteMutation.
promptsRouter.delete("/prompt-versions/:id", async (c) => {
  const id = c.req.param("id");
  await run(c.env, `DELETE FROM prompt_versions WHERE id = ?`, id);
  return c.json({ success: true, id });
});
