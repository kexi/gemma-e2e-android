import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import type { z } from "zod";
import {
  type Action,
  type CaseRun,
  CaseRunSchema,
  type Run,
  RunSchema,
  type RunStatus,
  type Step,
  StepSchema,
} from "@gemma-e2e/core";
import { zodConverter } from "./converter.ts";

export class StoreError extends Error {
  override readonly name = "StoreError";
}

/**
 * Documents drop the fields their own path already encodes: `runs/{runId}`
 * carries the run id, `cases/{caseId}` the case id, `steps/{index}` the index.
 * Storing them twice invites the two copies to disagree; the reader puts them
 * back from the document id.
 */
const RunDocSchema = RunSchema.omit({ id: true, cases: true });
const CaseDocSchema = CaseRunSchema.omit({ runId: true, caseId: true, steps: true });
const StepDocSchema = StepSchema.omit({ runId: true, caseId: true, index: true });

const runConverter = zodConverter(RunDocSchema, "run");
const caseConverter = zodConverter(CaseDocSchema, "case");
const stepConverter = zodConverter(StepDocSchema, "step");

const RUNS = "runs";
const CASES = "cases";
const STEPS = "steps";

/** Zero-padded so Firestore's lexicographic document order matches step order. */
function stepDocId(index: number): string {
  return String(index).padStart(6, "0");
}

export interface CreateRunInput {
  id: string;
  scenarioId: string;
  title: string;
}

export interface CreateCaseInput {
  runId: string;
  caseId: string;
  order: number;
  title: string;
  prompt: string;
  model: string;
}

export interface AddStepInput {
  runId: string;
  caseId: string;
  index: number;
  action: Action;
  uiText: string;
  screenshotPath?: string | null | undefined;
  note?: string | null | undefined;
}

export interface FinishInput {
  status: RunStatus;
  verdictReason?: string | null | undefined;
}

export interface FinishCaseInput extends FinishInput {
  /** Written only when recording produced a file; omitted leaves it null. */
  videoPath?: string | null | undefined;
}

export interface StoreOptions {
  /** Defaults to GOOGLE_CLOUD_PROJECT, then the emulator's demo project. */
  projectId?: string | undefined;
  /** Injection seam: tests and the emulator path share the same class. */
  firestore?: Firestore | undefined;
}

export const DEFAULT_PROJECT_ID = "demo-gemma-e2e";

/**
 * Firestore-backed run history.
 *
 * Why timestamps stay ISO 8601 strings rather than Firestore `Timestamp`:
 * every consumer (the JSON API, the SSE payloads, the dashboard) already speaks
 * ISO strings, and a Timestamp would have to be converted at each boundary
 * while gaining nothing — the queries this store runs order by document id or
 * by a string field, both of which sort correctly on ISO 8601 anyway.
 */
export class Store {
  readonly #db: Firestore;

  private constructor(db: Firestore) {
    this.#db = db;
  }

  /**
   * Connects to Firestore. With FIRESTORE_EMULATOR_HOST set, the Admin SDK
   * talks to the emulator and needs no credentials at all, which is what keeps
   * development and CI fully offline.
   */
  static open(options: StoreOptions = {}): Store {
    const injected = options.firestore;
    if (injected !== undefined) {
      return new Store(injected);
    }

    const projectId =
      options.projectId ?? process.env["GOOGLE_CLOUD_PROJECT"] ?? DEFAULT_PROJECT_ID;

    // getApps() rather than an unconditional initializeApp: the Admin SDK
    // throws on a duplicate default app, and the dashboard's --watch reload
    // re-imports this module in the same process.
    //
    // No credentials are passed: with FIRESTORE_EMULATOR_HOST set the SDK skips
    // auth entirely, and against real Firestore it falls back to application
    // default credentials, so hard-coding a key here would only get in the way.
    const app = getApps()[0] ?? initializeApp({ projectId });

    return new Store(getFirestore(app));
  }

  #run(runId: string) {
    return this.#db.collection(RUNS).doc(runId).withConverter(runConverter);
  }

  #case(runId: string, caseId: string) {
    return this.#db
      .collection(RUNS)
      .doc(runId)
      .collection(CASES)
      .doc(caseId)
      .withConverter(caseConverter);
  }

  #steps(runId: string, caseId: string) {
    return this.#db
      .collection(RUNS)
      .doc(runId)
      .collection(CASES)
      .doc(caseId)
      .collection(STEPS)
      .withConverter(stepConverter);
  }

  async createRun(input: CreateRunInput): Promise<Run> {
    const startedAt = new Date().toISOString();
    const run: Run = {
      id: input.id,
      scenarioId: input.scenarioId,
      title: input.title,
      status: "running",
      verdictReason: null,
      startedAt,
      finishedAt: null,
      cases: [],
    };

    // create() rather than set(): a repeated run id is a bug in the caller, and
    // set() would silently overwrite the earlier run's summary while orphaning
    // its cases.
    await this.#run(input.id).create(toRunDoc(run));
    return run;
  }

  async createCase(input: CreateCaseInput): Promise<CaseRun> {
    const startedAt = new Date().toISOString();
    const caseRun: CaseRun = {
      runId: input.runId,
      caseId: input.caseId,
      order: input.order,
      title: input.title,
      prompt: input.prompt,
      model: input.model,
      status: "running",
      verdictReason: null,
      startedAt,
      finishedAt: null,
      videoPath: null,
      steps: [],
    };

    await this.#case(input.runId, input.caseId).create(toCaseDoc(caseRun));
    return caseRun;
  }

  async addStep(input: AddStepInput): Promise<Step> {
    const step: Step = {
      runId: input.runId,
      caseId: input.caseId,
      index: input.index,
      action: input.action,
      uiText: input.uiText,
      screenshotPath: input.screenshotPath ?? null,
      note: input.note ?? null,
      createdAt: new Date().toISOString(),
    };

    await this.#steps(input.runId, input.caseId)
      .doc(stepDocId(input.index))
      .create(toStepDoc(step));
    return step;
  }

  async finishCase(runId: string, caseId: string, input: FinishCaseInput): Promise<void> {
    const ref = this.#case(runId, caseId);
    const snapshot = await ref.get();
    const isMissing = !snapshot.exists;
    if (isMissing) {
      throw new StoreError(`no such case: ${runId}/${caseId}`);
    }

    await ref.update({
      status: input.status,
      verdictReason: input.verdictReason ?? null,
      finishedAt: new Date().toISOString(),
      videoPath: input.videoPath ?? null,
    });
  }

  async finishRun(runId: string, input: FinishInput): Promise<void> {
    const ref = this.#run(runId);
    const snapshot = await ref.get();
    const isMissing = !snapshot.exists;
    if (isMissing) {
      throw new StoreError(`no such run: ${runId}`);
    }

    await ref.update({
      status: input.status,
      verdictReason: input.verdictReason ?? null,
      finishedAt: new Date().toISOString(),
    });
  }

  /** Newest first. Cases are omitted; the list view does not need them. */
  async listRuns(limit = 50): Promise<Run[]> {
    const snapshot = await this.#db
      .collection(RUNS)
      .withConverter(runConverter)
      .orderBy("startedAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => fromRunDoc(doc.id, doc.data()));
  }

  /** The full run: every case in declaration order, each with its steps. */
  async getRun(id: string): Promise<Run | null> {
    const runDoc = await this.#run(id).get();
    const data = runDoc.data();
    if (data === undefined) {
      return null;
    }

    const caseDocs = await this.#db
      .collection(RUNS)
      .doc(id)
      .collection(CASES)
      .withConverter(caseConverter)
      .orderBy("order")
      .get();

    // Steps are fetched per case in parallel: a run has a handful of cases, so
    // the round trips are worth avoiding a collection-group query that would
    // need its own composite index in the emulator and in production.
    const cases = await Promise.all(
      caseDocs.docs.map(async (doc) => {
        const stepDocs = await this.#steps(id, doc.id).orderBy("__name__").get();
        const steps = stepDocs.docs.map((stepDoc) =>
          fromStepDoc(id, doc.id, Number(stepDoc.id), stepDoc.data()),
        );
        return fromCaseDoc(id, doc.id, doc.data(), steps);
      }),
    );

    return { ...fromRunDoc(id, data), cases };
  }

  /** Deletes a run and everything beneath it. Used by tests to stay isolated. */
  async deleteRun(id: string): Promise<void> {
    await this.#db.recursiveDelete(this.#db.collection(RUNS).doc(id));
  }

  /**
   * No-op: the Firestore client pools connections for the process lifetime and
   * closing it would break the next run. Kept so callers written against the
   * previous SQLite store need no change.
   */
  close(): void {}
}

type RunDoc = z.output<typeof RunDocSchema>;
type CaseDoc = z.output<typeof CaseDocSchema>;
type StepDoc = z.output<typeof StepDocSchema>;

function toRunDoc(run: Run): RunDoc {
  return {
    scenarioId: run.scenarioId,
    title: run.title,
    status: run.status,
    verdictReason: run.verdictReason,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function fromRunDoc(id: string, doc: RunDoc): Run {
  return { id, ...doc, cases: [] };
}

function toCaseDoc(caseRun: CaseRun): CaseDoc {
  return {
    order: caseRun.order,
    title: caseRun.title,
    prompt: caseRun.prompt,
    model: caseRun.model,
    status: caseRun.status,
    verdictReason: caseRun.verdictReason,
    startedAt: caseRun.startedAt,
    finishedAt: caseRun.finishedAt,
    videoPath: caseRun.videoPath,
  };
}

function fromCaseDoc(runId: string, caseId: string, doc: CaseDoc, steps: Step[]): CaseRun {
  return { runId, caseId, ...doc, steps };
}

function toStepDoc(step: Step): StepDoc {
  return {
    action: step.action,
    uiText: step.uiText,
    screenshotPath: step.screenshotPath,
    note: step.note,
    createdAt: step.createdAt,
  };
}

function fromStepDoc(runId: string, caseId: string, index: number, doc: StepDoc): Step {
  return { runId, caseId, index, ...doc };
}
