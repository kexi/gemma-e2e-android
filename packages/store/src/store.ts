import { getApps, initializeApp } from "firebase-admin/app";
import { type Firestore, getFirestore } from "firebase-admin/firestore";
import type { z } from "zod";
import {
  type Action,
  type AccessibilityReview,
  type CaseRun,
  CaseRunSchema,
  type CaseStatus,
  type Run,
  RunSchema,
  type RunStatus,
  type Step,
  StepSchema,
  UNSETTLED_RUN_STATUSES,
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

/** One millisecond, the finest `Date.toISOString` can express. */
const ONE_MS = 1;

/**
 * An acceptance timestamp strictly greater than the previous one.
 *
 * Returns `now` whenever the clock has genuinely moved on; only when it has
 * not — the same millisecond, or a clock that stepped backwards — does it push
 * one millisecond past `previous`. The result is still an ISO 8601 string, so
 * it sorts lexicographically exactly as it sorts chronologically, which is what
 * `listRuns` relies on.
 *
 * *Why the borrowed millisecond is acceptable:* `startedAt` on a queued run is
 * already an acceptance time rather than a measurement, and being off by the
 * number of runs in a batch is invisible next to the seconds a run takes.
 * Ordering that holds across refetches is worth more than sub-millisecond
 * fidelity on a field nobody reads to that precision.
 *
 * *Why not a counter suffix on the string:* it would no longer parse as a date,
 * and both the dashboard and the CLI hand this field straight to `new Date()`.
 */
export function nextAcceptedAt(now: string, previous: string | null): string {
  const isFirst = previous === null;
  if (isFirst) {
    return now;
  }

  const hasAdvanced = now > previous;
  if (hasAdvanced) {
    return now;
  }

  return new Date(Date.parse(previous) + ONE_MS).toISOString();
}

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
  accessibilityReview?: AccessibilityReview | null | undefined;
}

export interface FinishInput {
  status: RunStatus;
  verdictReason?: string | null | undefined;
}

export interface FinishCaseInput extends Omit<FinishInput, "status"> {
  /**
   * Narrower than a run's, because a case has no waiting state: it is created
   * when its turn comes and finishes when its verdict is in. Writing `queued`
   * to a case document would leave it in a state nothing ever moves it out of.
   */
  status: CaseStatus;
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
  /** The last acceptance time handed out, so the next one is strictly after it. */
  #lastAcceptedAt: string | null = null;

  private constructor(db: Firestore) {
    this.#db = db;
  }

  /**
   * The next acceptance timestamp, guaranteed to be after the previous one.
   *
   * `Date` has millisecond resolution and a batch is a handful of sequential
   * writes, so two runs accepted in the same millisecond is ordinary rather
   * than exotic — and identical `startedAt` values leave `listRuns` sorting
   * them by nothing at all, which is to say by whatever Firestore returns that
   * time. The sidebar would then show the same batch in a different order on
   * each refetch, and the run the user pressed the button expecting to go first
   * would sometimes read as last.
   *
   * *Why not sort by document id as a tie-break instead:* the ids are random
   * UUIDs, so ordering by them is arbitrary — stable, but stably wrong, which
   * is worse than visibly wrong because nobody would think to look.
   */
  #acceptedAt(): string {
    const next = nextAcceptedAt(new Date().toISOString(), this.#lastAcceptedAt);
    this.#lastAcceptedAt = next;
    return next;
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
    // Through the same monotonic source as `enqueueRun`: both write the field
    // `listRuns` sorts by, so two runs created back to back must be separable
    // for the same reason two enqueued in a batch must be.
    const startedAt = this.#acceptedAt();
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

  /**
   * Writes the run document before anything drives a device, so an id handed
   * out by the API is fetchable the moment its holder asks for it. A batch
   * mints every id up front; without this the second and third runs would be
   * ids that `getRun` answers `null` for and `listRuns` never shows.
   *
   * `startedAt` here is the ACCEPTANCE time, not the time the device work
   * begins. `listRuns` orders by this field, so a batch whose runs each took
   * their timestamp from whenever they happened to reach the front of the queue
   * would land in the sidebar in completion order rather than in the order the
   * user asked for — and would visibly reshuffle as each one started. The
   * listing is newest-first, so a batch reads bottom-to-top there; what matters
   * is that the order is the one that was ASKED for and that it does not move,
   * which is what {@link acceptedAt} guarantees.
   *
   * *Why not a separate `queuedAt` field:* `startedAt` is already the sort key
   * every listing uses, and a second timestamp would force each ordering site
   * to decide which of the two it means. Reading `startedAt` as "when this run
   * entered the history" is consistent for queued and unqueued runs alike, and
   * it keeps `Run`'s shape unchanged — this feature costs one enum member and
   * no new field.
   */
  async enqueueRun(input: CreateRunInput): Promise<Run> {
    const startedAt = this.#acceptedAt();
    const run: Run = {
      id: input.id,
      scenarioId: input.scenarioId,
      title: input.title,
      status: "queued",
      verdictReason: null,
      startedAt,
      finishedAt: null,
      cases: [],
    };

    await this.#run(input.id).create(toRunDoc(run));
    return run;
  }

  /**
   * Marks the point where a run stops waiting and starts touching the device.
   *
   * One method covers both callers so the runner need not know which one it
   * has. Through the queue the document already exists as `queued` and this
   * only flips the status; through the CLI or a test `runScenario` is called
   * directly and the run genuinely begins the moment it is created, so the
   * missing document is created here rather than treated as an error.
   *
   * *Why not make the runner call `createRun` or `beginRun` depending on its
   * caller:* that pushes a queued-or-not flag through `RunDeps` purely so the
   * runner can pick a store method, and every new entry point would have to
   * remember to set it. The store already knows the answer — the document
   * either exists or it does not.
   *
   * *Why not `set()` with merge:* the update path must not resurrect a run that
   * was deleted between enqueue and begin, and it must not quietly rewrite
   * `startedAt`. Reading first and branching keeps the enqueued acceptance time
   * intact, which is the whole point of writing it early.
   */
  async beginRun(input: CreateRunInput): Promise<Run> {
    const ref = this.#run(input.id);
    const snapshot = await ref.get();
    const data = snapshot.data();

    const wasNeverQueued = data === undefined;
    if (wasNeverQueued) {
      return await this.createRun(input);
    }

    await ref.update({ status: "running" });
    return { ...fromRunDoc(input.id, data), status: "running" };
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
      ...(input.accessibilityReview === undefined
        ? {}
        : { accessibilityReview: input.accessibilityReview }),
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

  /**
   * Closes out runs a previous process left mid-flight.
   *
   * The queue holds its pending jobs in memory, so a restart takes them with it
   * while their documents stay at `queued`, and whatever was on the device when
   * the process died stays at `running`. Both then never move again: nothing is
   * left to finish them, but the dashboard reads them as work still on its way
   * and the CLI's poll never resolves. Settling them to `error` at startup is
   * what turns a lie into a fact the reader can act on.
   *
   * *Why they are abandoned rather than resumed:* a queued job is only a
   * scenario id, and re-running it would drive a device whose state the killed
   * run left behind — an app half-navigated, a recording still open, a CDP
   * target attached to a page nobody owns. Worse, `--watch` restarts on every
   * edit, so resuming would relaunch the same batch on each save. A run that
   * did not reach a verdict is not a failed test; `error` says exactly that.
   *
   * *Why `in` on `status` rather than two queries or a scan:* an equality
   * filter on one field is served by the automatic single-field index, so this
   * needs no composite index in the emulator or in production. `updatedAt`-style
   * age filtering would need one, and would not help — every unsettled run
   * belongs to a process that is gone by the time this runs.
   *
   * The statuses come from `UNSETTLED_RUN_STATUSES` rather than being spelled
   * out here, so this query and the CLI's "still waiting" check cannot come to
   * disagree about what unfinished means.
   */
  async settleOrphanedRuns(reason: string): Promise<string[]> {
    const snapshot = await this.#db
      .collection(RUNS)
      .withConverter(runConverter)
      .where("status", "in", UNSETTLED_RUN_STATUSES)
      .get();

    const isNothingToDo = snapshot.empty;
    if (isNothingToDo) {
      return [];
    }

    // One batch rather than an update per document: the writes are independent,
    // but a partial sweep leaves exactly the state this method exists to
    // remove, and a batch is the cheapest way to make the whole sweep land or
    // none of it.
    const finishedAt = new Date().toISOString();
    const batch = this.#db.batch();
    for (const doc of snapshot.docs) {
      batch.update(doc.ref, { status: "error", verdictReason: reason, finishedAt });
    }
    await batch.commit();

    return snapshot.docs.map((doc) => doc.id);
  }

  /**
   * Newest first. Cases are omitted; the list view does not need them.
   *
   * Descending on purpose, and not in tension with a batch's ordering: the rail
   * is a history, where the run just started belongs at the top and the reader
   * should not have to scroll for it. A batch therefore reads bottom-to-top,
   * which is the same thing every log viewer does. What the batch needs from
   * this query is only that the order be the one it was accepted in and that it
   * never change, and `startedAt` is monotonic per process for exactly that
   * reason (see {@link nextAcceptedAt}).
   */
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
    ...(step.accessibilityReview === undefined
      ? {}
      : { accessibilityReview: step.accessibilityReview }),
    createdAt: step.createdAt,
  };
}

function fromStepDoc(runId: string, caseId: string, index: number, doc: StepDoc): Step {
  return { runId, caseId, index, ...doc };
}
