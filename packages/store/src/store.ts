import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Action, ActionSchema, type Run, type RunStatus, type Step } from "@gemma-e2e/core";

export interface CreateRunInput {
  id: string;
  scenarioId: string;
  title: string;
  prompt: string;
}

export interface AddStepInput {
  runId: string;
  index: number;
  action: Action;
  uiText: string;
  screenshotPath?: string | null | undefined;
  note?: string | null | undefined;
}

export interface FinishRunInput {
  status: RunStatus;
  verdictReason?: string | null | undefined;
}

interface RunRow {
  id: string;
  scenario_id: string;
  title: string;
  prompt: string;
  status: string;
  verdict_reason: string | null;
  started_at: string;
  finished_at: string | null;
}

interface StepRow {
  id: number;
  run_id: string;
  step_index: number;
  action: string;
  ui_text: string;
  screenshot_path: string | null;
  note: string | null;
  created_at: string;
}

/**
 * Applied in order, each exactly once. Appending a statement is the only way to
 * change the schema -- editing an existing one would leave older databases
 * silently different from new ones.
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE runs (
     id             TEXT PRIMARY KEY,
     scenario_id    TEXT NOT NULL,
     title          TEXT NOT NULL,
     prompt         TEXT NOT NULL,
     status         TEXT NOT NULL,
     verdict_reason TEXT,
     started_at     TEXT NOT NULL,
     finished_at    TEXT
   )`,
  `CREATE TABLE steps (
     id              INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id          TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
     step_index      INTEGER NOT NULL,
     action          TEXT NOT NULL,
     ui_text         TEXT NOT NULL,
     screenshot_path TEXT,
     note            TEXT,
     created_at      TEXT NOT NULL,
     UNIQUE (run_id, step_index)
   )`,
  `CREATE INDEX idx_steps_run ON steps(run_id, step_index)`,
  `CREATE INDEX idx_runs_started ON runs(started_at DESC)`,
];

export class StoreError extends Error {
  override readonly name = "StoreError";
}

function toStep(row: StepRow): Step {
  return {
    id: row.id,
    runId: row.run_id,
    index: row.step_index,
    // Actions are stored as JSON text; re-validating on read means a
    // hand-edited or schema-drifted database fails loudly here rather than
    // somewhere far downstream.
    action: ActionSchema.parse(JSON.parse(row.action)),
    uiText: row.ui_text,
    screenshotPath: row.screenshot_path,
    note: row.note,
    createdAt: row.created_at,
  };
}

function toRun(row: RunRow, steps: Step[]): Run {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    title: row.title,
    prompt: row.prompt,
    status: row.status as RunStatus,
    verdictReason: row.verdict_reason,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    steps,
  };
}

export class Store {
  readonly #db: Database;

  private constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Opens (creating if absent) a database and brings it to the current schema.
   * `:memory:` is passed straight through for tests.
   */
  static open(dbPath: string): Store {
    const isFile = dbPath !== ":memory:";
    if (isFile) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    const db = new Database(dbPath, { create: true });
    // WAL keeps the dashboard's reads from blocking the runner's writes.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    Store.#migrate(db);
    return new Store(db);
  }

  static #migrate(db: Database): void {
    db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");

    const row = db.query<{ version: number }, []>("SELECT version FROM schema_version").get();
    const isFresh = row === null;
    if (isFresh) {
      db.run("INSERT INTO schema_version (version) VALUES (0)");
    }

    const current = row?.version ?? 0;
    const pending = MIGRATIONS.slice(current);
    const isUpToDate = pending.length === 0;
    if (isUpToDate) {
      return;
    }

    db.transaction(() => {
      for (const statement of pending) {
        db.exec(statement);
      }
      db.run("UPDATE schema_version SET version = ?", [MIGRATIONS.length]);
    })();
  }

  createRun(input: CreateRunInput): Run {
    const startedAt = new Date().toISOString();

    this.#db.run(
      `INSERT INTO runs (id, scenario_id, title, prompt, status, verdict_reason, started_at, finished_at)
       VALUES (?, ?, ?, ?, 'running', NULL, ?, NULL)`,
      [input.id, input.scenarioId, input.title, input.prompt, startedAt],
    );

    return {
      id: input.id,
      scenarioId: input.scenarioId,
      title: input.title,
      prompt: input.prompt,
      status: "running",
      verdictReason: null,
      startedAt,
      finishedAt: null,
      steps: [],
    };
  }

  addStep(input: AddStepInput): Step {
    const createdAt = new Date().toISOString();

    const inserted = this.#db
      .query<
        { id: number },
        [string, number, string, string, string | null, string | null, string]
      >(
        `INSERT INTO steps (run_id, step_index, action, ui_text, screenshot_path, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .get(
        input.runId,
        input.index,
        JSON.stringify(input.action),
        input.uiText,
        input.screenshotPath ?? null,
        input.note ?? null,
        createdAt,
      );

    if (inserted === null) {
      throw new StoreError(`failed to insert step ${input.index} for run ${input.runId}`);
    }

    return {
      id: inserted.id,
      runId: input.runId,
      index: input.index,
      action: input.action,
      uiText: input.uiText,
      screenshotPath: input.screenshotPath ?? null,
      note: input.note ?? null,
      createdAt,
    };
  }

  finishRun(runId: string, input: FinishRunInput): void {
    const result = this.#db.run(
      `UPDATE runs SET status = ?, verdict_reason = ?, finished_at = ? WHERE id = ?`,
      [input.status, input.verdictReason ?? null, new Date().toISOString(), runId],
    );

    const isMissing = result.changes === 0;
    if (isMissing) {
      throw new StoreError(`no such run: ${runId}`);
    }
  }

  /** Newest first. Steps are omitted; the list view does not need them. */
  listRuns(limit = 50): Run[] {
    const rows = this.#db
      .query<RunRow, [number]>("SELECT * FROM runs ORDER BY started_at DESC, rowid DESC LIMIT ?")
      .all(limit);

    return rows.map((row) => toRun(row, []));
  }

  getRun(id: string): Run | null {
    const row = this.#db.query<RunRow, [string]>("SELECT * FROM runs WHERE id = ?").get(id);
    if (row === null) {
      return null;
    }

    const stepRows = this.#db
      .query<StepRow, [string]>("SELECT * FROM steps WHERE run_id = ? ORDER BY step_index")
      .all(id);

    return toRun(row, stepRows.map(toStep));
  }

  close(): void {
    this.#db.close();
  }
}
