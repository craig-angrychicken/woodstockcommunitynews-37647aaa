import { Hono } from "hono";
import type { Env } from "../../env";
import { all, first, run, insert, fromJson, toJson } from "../../_shared/db";
import type { ScheduleRow, AppSettingRow } from "../../_shared/types";

/**
 * Admin config sub-router — /schedules* and /app-settings* endpoints.
 * Mounted under /api/admin (parent applies the Cloudflare Access gate).
 *
 * SQLite/D1 notes:
 *  - schedules.scheduled_times and app_settings.value are JSON TEXT — fromJson on
 *    read where the SPA expects objects/arrays, toJson on write.
 *  - schedules.is_enabled is INTEGER 0/1; the SPA expects a boolean.
 *  - timestamps via datetime('now'); new ids via crypto.randomUUID().
 */
export const configRouter = new Hono<{ Bindings: Env }>();

type ScheduleType = "artifact_fetch" | "ai_journalism" | "ai_editor";

/** Shape the SPA's useSchedule hook expects (scheduled_times[], is_enabled boolean). */
function serializeSchedule(row: ScheduleRow) {
  return {
    ...row,
    scheduled_times: fromJson<string[]>(row.scheduled_times, []),
    is_enabled: row.is_enabled === 1,
  };
}

// --- Schedules ---

// GET /schedules/:type — single schedule by type (maybeSingle on the client).
configRouter.get("/schedules/:type", async (c) => {
  const type = c.req.param("type") as ScheduleType;
  const row = await first<ScheduleRow>(
    c.env,
    `SELECT * FROM schedules WHERE schedule_type = ?`,
    type,
  );
  return c.json(row ? serializeSchedule(row) : null);
});

// POST /schedules — upsert a schedule keyed on schedule_type.
configRouter.post("/schedules", async (c) => {
  const body = await c.req.json<{
    scheduleType: ScheduleType;
    scheduledTimes: string[];
    isEnabled: boolean;
  }>();

  const scheduleType = body.scheduleType;
  const scheduledTimes = toJson(body.scheduledTimes ?? []);
  const isEnabled = body.isEnabled ? 1 : 0;

  await run(
    c.env,
    `INSERT INTO schedules (id, schedule_type, scheduled_times, is_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT (schedule_type) DO UPDATE SET
       scheduled_times = excluded.scheduled_times,
       is_enabled = excluded.is_enabled,
       updated_at = datetime('now')`,
    crypto.randomUUID(),
    scheduleType,
    scheduledTimes,
    isEnabled,
  );

  const row = await first<ScheduleRow>(
    c.env,
    `SELECT * FROM schedules WHERE schedule_type = ?`,
    scheduleType,
  );
  return c.json(row ? serializeSchedule(row) : null);
});

// --- App settings ---

// POST /app-settings — insert a setting (value is JSON-encoded TEXT).
configRouter.post("/app-settings", async (c) => {
  const body = await c.req.json<{ key: string; value: Record<string, unknown> }>();
  const inserted = await insert<AppSettingRow>(c.env, "app_settings", {
    id: crypto.randomUUID(),
    key: body.key,
    value: toJson(body.value),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (!inserted) return c.json({ error: "insert failed" }, 500);
  return c.json({ ...inserted, value: fromJson(inserted.value, null) });
});

// GET /app-settings/:key — single setting; SPA reads parsed `value`.
configRouter.get("/app-settings/:key", async (c) => {
  const key = c.req.param("key");
  const row = await first<{ value: string }>(
    c.env,
    `SELECT value FROM app_settings WHERE key = ?`,
    key,
  );
  if (!row) return c.json(null);
  return c.json({ value: fromJson(row.value, null) });
});

// PATCH /app-settings/:key — update a setting's value.
configRouter.patch("/app-settings/:key", async (c) => {
  const key = c.req.param("key");
  const body = await c.req.json<{ value: Record<string, unknown> }>();
  await run(
    c.env,
    `UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ?`,
    toJson(body.value),
    key,
  );
  const row = await first<{ value: string }>(
    c.env,
    `SELECT value FROM app_settings WHERE key = ?`,
    key,
  );
  if (!row) return c.json(null);
  return c.json({ value: fromJson(row.value, null) });
});
