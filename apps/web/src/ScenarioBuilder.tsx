import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import EditIcon from "@mui/icons-material/Edit";
import {
  createScenario,
  type CreateScenarioRequest,
  type ModelInfo,
  type Scenario,
  updateScenario,
} from "./api.ts";

/** Sentinel for "let the server decide", which is not a model id. */
const SERVER_DEFAULT = "";

/** Mirrors the server's slug rule so the browser can refuse it first. */
const SLUG_PATTERN = "[a-z0-9][a-z0-9-]*";

let nextCaseKey = 0;

interface CaseDraft {
  /** Stable across reorders and removals, unlike an array index. */
  key: number;
  id: string;
  title: string;
  prompt: string;
  model: string;
  maxSteps: string;
}

function emptyCase(): CaseDraft {
  nextCaseKey += 1;
  return { key: nextCaseKey, id: "", title: "", prompt: "", model: SERVER_DEFAULT, maxSteps: "20" };
}

/** Every editable value, so one object can be swapped in as a unit. */
interface Draft {
  id: string;
  title: string;
  appPackage: string;
  appActivity: string;
  model: string;
  cases: CaseDraft[];
}

function emptyDraft(): Draft {
  return {
    id: "",
    title: "",
    appPackage: "",
    appActivity: "",
    model: SERVER_DEFAULT,
    cases: [emptyCase()],
  };
}

/**
 * Turns a saved scenario back into form state. Fresh case keys each time, so a
 * reopened dialog never reuses a key React has already seen for other values.
 */
function draftOf(scenario: Scenario): Draft {
  return {
    id: scenario.id,
    title: scenario.title,
    appPackage: scenario.app?.package ?? "",
    appActivity: scenario.app?.activity ?? "",
    model: scenario.model ?? SERVER_DEFAULT,
    cases: scenario.cases.map((one) => {
      nextCaseKey += 1;
      return {
        key: nextCaseKey,
        id: one.id,
        title: one.title ?? "",
        prompt: one.prompt,
        model: one.model ?? SERVER_DEFAULT,
        maxSteps: String(one.maxSteps),
      };
    }),
  };
}

/**
 * Derives a slug from a title so the id field starts filled in. Kept
 * deliberately dumb: the user can always overwrite it, and the field carries
 * the same `pattern` the server enforces.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface ScenarioBuilderProps {
  /** Fills the two model dropdowns; empty while `/api/models` is unavailable. */
  models: ModelInfo[];
  /**
   * Omitted, the dialog creates a new scenario; supplied, it edits that one in
   * place. The same form serves both because a scenario has no fields that
   * exist only at creation -- only the id stops being editable.
   */
  scenario?: Scenario;
  /** Lets the rail re-read `/api/scenarios` so the change shows up at once. */
  onSaved: () => void;
}

/**
 * The scenario form and the dialog behind it, in create and edit flavours.
 * Native `<dialog>` rather than MUI's: the platform already gives the top
 * layer, the focus trap, Esc handling, and -- with `closedby="any"` -- light
 * dismiss, none of which need re-implementing. MUI is used only for the
 * surrounding rail, so this component styles itself.
 */
export function ScenarioBuilder({ models, scenario, onSaved }: ScenarioBuilderProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogId = useId();
  const isEditing = scenario !== undefined;

  // Not a stale-prop hazard despite being read only on close and on open: the
  // rail refetches after every save, so an edited scenario arrives as a new
  // prop before the dialog is opened again.
  const initial = () => (scenario === undefined ? emptyDraft() : draftOf(scenario));

  const [id, setId] = useState(() => initial().id);
  // Tracks whether the user has taken the id over, so typing a title stops
  // overwriting an id they chose on purpose. An existing id is always the
  // user's, so editing never re-slugs it.
  const [idIsCustom, setIdIsCustom] = useState(isEditing);
  const [title, setTitle] = useState(() => initial().title);
  const [appPackage, setAppPackage] = useState(() => initial().appPackage);
  const [appActivity, setAppActivity] = useState(() => initial().appActivity);
  const [model, setModel] = useState(() => initial().model);
  const [cases, setCases] = useState<CaseDraft[]>(() => initial().cases);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invoker commands (command/commandfor) drive the button declaratively where
  // they exist -- Baseline Newly available, and Chrome is what this dashboard
  // targets. Elsewhere the click handler below opens the same dialog, so the
  // fallback costs one showModal() call rather than a polyfill.
  const hasInvokerCommands =
    typeof HTMLButtonElement !== "undefined" && "commandForElement" in HTMLButtonElement.prototype;

  // `closedby` is not in Safari yet. Without it a backdrop click does nothing,
  // which is a lesser dialog rather than a broken one; Esc still closes.
  const hasClosedBy =
    typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype;

  // "Reset" is back to the values this dialog opens with, not back to blank:
  // an abandoned edit has to reopen showing the saved scenario again, and an
  // abandoned draft has to reopen empty.
  function reset() {
    const start = initial();
    setId(start.id);
    setIdIsCustom(isEditing);
    setTitle(start.title);
    setAppPackage(start.appPackage);
    setAppActivity(start.appActivity);
    setModel(start.model);
    setCases(start.cases);
    setError(null);
  }

  // The listener below is attached once, so it must not close over the `reset`
  // from the render that attached it -- that one would restore the scenario as
  // it looked before the last save.
  const resetRef = useRef(reset);
  resetRef.current = reset;

  // A dialog dismissed by Esc or the backdrop never runs the submit path, so
  // the reset hangs off `close` rather than off any one button.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    const onClose = () => resetRef.current();
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, []);

  function updateCase(key: number, patch: Partial<CaseDraft>) {
    setCases((current) => current.map((one) => (one.key === key ? { ...one, ...patch } : one)));
  }

  function changeTitle(value: string) {
    setTitle(value);
    if (!idIsCustom) {
      setId(slugify(value));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const body: CreateScenarioRequest = {
      id,
      title,
      ...(appPackage.trim() === ""
        ? {}
        : {
            app: {
              package: appPackage.trim(),
              ...(appActivity.trim() === "" ? {} : { activity: appActivity.trim() }),
            },
          }),
      ...(model === SERVER_DEFAULT ? {} : { model }),
      cases: cases.map((one) => ({
        id: one.id,
        ...(one.title.trim() === "" ? {} : { title: one.title.trim() }),
        prompt: one.prompt.trim(),
        ...(one.model === SERVER_DEFAULT ? {} : { model: one.model }),
        ...(one.maxSteps.trim() === "" ? {} : { maxSteps: Number(one.maxSteps) }),
      })),
    };

    try {
      await (isEditing ? updateScenario(body) : createScenario(body));
      // Closing fires `close`, which resets the form. The rail refetches first
      // so an edit reopens showing what was just saved, not what it replaced.
      onSaved();
      dialogRef.current?.close();
    } catch (cause) {
      // A 409 from a name already on disk belongs next to the field that
      // caused it, not in the rail behind a dialog the user is still looking at.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  const onlyOneCase = cases.length === 1;

  // Shared by both triggers: the invoker attributes where they exist, and the
  // showModal() fallback where they do not.
  const openProps = {
    ...(hasInvokerCommands ? { command: "show-modal", commandfor: dialogId } : {}),
    onClick: () => {
      if (!hasInvokerCommands) {
        dialogRef.current?.showModal();
      }
    },
  };

  return (
    <>
      {isEditing ? (
        <Tooltip title={`Edit ${scenario.id}`}>
          <IconButton size="small" aria-label={`Edit ${scenario.title}`} {...openProps}>
            <EditIcon />
          </IconButton>
        </Tooltip>
      ) : (
        <button type="button" className="builder-open" {...openProps}>
          New scenario
        </button>
      )}

      <dialog
        id={dialogId}
        ref={dialogRef}
        className="builder-dialog"
        aria-labelledby={`${dialogId}-heading`}
        {...(hasClosedBy ? { closedby: "any" } : {})}
      >
        <form className="builder-form" method="dialog" onSubmit={submit} noValidate={false}>
          <h2 id={`${dialogId}-heading`} className="builder-heading">
            {isEditing ? "Edit scenario" : "New scenario"}
          </h2>
          <p className="builder-lede">
            {isEditing ? (
              <>
                Rewrites <code>scenarios/{id}.yaml</code>, which is git-managed — commit the change
                to keep it.
              </>
            ) : (
              <>
                Saved as <code>scenarios/&lt;id&gt;.yaml</code>, which is git-managed — commit it to
                keep it. An existing file is never overwritten.
              </>
            )}
          </p>

          {error !== null && (
            <p className="builder-error" role="alert">
              <span aria-hidden="true">❌</span> {error}
            </p>
          )}

          <fieldset className="builder-fieldset">
            <legend>Scenario</legend>

            <div className="builder-field">
              <label htmlFor={`${dialogId}-title`}>Title *</label>
              <input
                id={`${dialogId}-title`}
                name="title"
                value={title}
                onChange={(e) => changeTitle(e.target.value)}
                required
                autoComplete="off"
                enterKeyHint="next"
              />
              <p className="builder-error-msg">
                <span aria-hidden="true">❌</span> A title is required.
              </p>
            </div>

            <div className="builder-field">
              <label htmlFor={`${dialogId}-id`}>File name{isEditing ? "" : " *"}</label>
              <span id={`${dialogId}-id-hint`} className="builder-hint">
                {isEditing
                  ? "The file name is the id, so it cannot be changed here."
                  : "Lowercase letters, digits and hyphens. Becomes scenarios/<id>.yaml."}
              </span>
              {/* readOnly, not disabled: the value stays selectable and
                  copyable, and a read-only field is still announced with its
                  content rather than skipped as unavailable. */}
              <input
                id={`${dialogId}-id`}
                name="id"
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  setIdIsCustom(true);
                }}
                required
                pattern={SLUG_PATTERN}
                autoComplete="off"
                aria-describedby={`${dialogId}-id-hint`}
                readOnly={isEditing}
              />
              <p className="builder-error-msg">
                <span aria-hidden="true">❌</span> Use lowercase letters, digits and hyphens, e.g.
                &ldquo;checkout-flow&rdquo;.
              </p>
            </div>

            <div className="builder-row">
              <div className="builder-field">
                <label htmlFor={`${dialogId}-package`}>App package</label>
                <input
                  id={`${dialogId}-package`}
                  name="appPackage"
                  value={appPackage}
                  onChange={(e) => setAppPackage(e.target.value)}
                  placeholder="dev.kexi.gemmae2e.example"
                  autoComplete="off"
                />
              </div>

              <div className="builder-field">
                <label htmlFor={`${dialogId}-activity`}>Activity</label>
                <input
                  id={`${dialogId}-activity`}
                  name="appActivity"
                  value={appActivity}
                  onChange={(e) => setAppActivity(e.target.value)}
                  placeholder=".MainActivity"
                  autoComplete="off"
                  // Only meaningful alongside a package, so it follows it.
                  disabled={appPackage.trim() === ""}
                />
              </div>
            </div>

            <div className="builder-field">
              <label htmlFor={`${dialogId}-model`}>Default model</label>
              <select
                id={`${dialogId}-model`}
                name="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              >
                <option value={SERVER_DEFAULT}>Server default</option>
                {models.map((info) => (
                  <option key={info.id} value={info.id}>
                    {info.id}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>

          {cases.map((one, index) => (
            <fieldset key={one.key} className="builder-fieldset">
              <legend>
                Case {index + 1}
                {!onlyOneCase && (
                  <button
                    type="button"
                    className="builder-remove"
                    onClick={() => setCases((c) => c.filter((x) => x.key !== one.key))}
                  >
                    Remove
                  </button>
                )}
              </legend>

              <div className="builder-field">
                <label htmlFor={`${dialogId}-case-${one.key}-id`}>Case id *</label>
                <input
                  id={`${dialogId}-case-${one.key}-id`}
                  name={`case-${index}-id`}
                  value={one.id}
                  onChange={(e) => updateCase(one.key, { id: e.target.value })}
                  required
                  pattern={SLUG_PATTERN}
                  autoComplete="off"
                />
                <p className="builder-error-msg">
                  <span aria-hidden="true">❌</span> Use lowercase letters, digits and hyphens.
                </p>
              </div>

              <div className="builder-field">
                <label htmlFor={`${dialogId}-case-${one.key}-title`}>Case title</label>
                <input
                  id={`${dialogId}-case-${one.key}-title`}
                  name={`case-${index}-title`}
                  value={one.title}
                  onChange={(e) => updateCase(one.key, { title: e.target.value })}
                  autoComplete="off"
                />
              </div>

              <div className="builder-field">
                <label htmlFor={`${dialogId}-case-${one.key}-prompt`}>Prompt *</label>
                <span id={`${dialogId}-case-${one.key}-hint`} className="builder-hint">
                  What the agent should check, in plain language.
                </span>
                <textarea
                  id={`${dialogId}-case-${one.key}-prompt`}
                  name={`case-${index}-prompt`}
                  value={one.prompt}
                  onChange={(e) => updateCase(one.key, { prompt: e.target.value })}
                  required
                  rows={3}
                  aria-describedby={`${dialogId}-case-${one.key}-hint`}
                />
                <p className="builder-error-msg">
                  <span aria-hidden="true">❌</span> A prompt is required.
                </p>
              </div>

              <div className="builder-row">
                <div className="builder-field">
                  <label htmlFor={`${dialogId}-case-${one.key}-model`}>Model</label>
                  <select
                    id={`${dialogId}-case-${one.key}-model`}
                    name={`case-${index}-model`}
                    value={one.model}
                    onChange={(e) => updateCase(one.key, { model: e.target.value })}
                  >
                    <option value={SERVER_DEFAULT}>Scenario default</option>
                    {models.map((info) => (
                      <option key={info.id} value={info.id}>
                        {info.id}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="builder-field">
                  <label htmlFor={`${dialogId}-case-${one.key}-steps`}>Max steps</label>
                  <input
                    id={`${dialogId}-case-${one.key}-steps`}
                    name={`case-${index}-maxSteps`}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={one.maxSteps}
                    onChange={(e) => updateCase(one.key, { maxSteps: e.target.value })}
                  />
                </div>
              </div>
            </fieldset>
          ))}

          <button
            type="button"
            className="builder-add"
            onClick={() => setCases((current) => [...current, emptyCase()])}
          >
            Add case
          </button>

          <div className="builder-actions">
            {/* Not formMethod="dialog": a submit-typed button still runs
                constraint validation (an empty draft blocks the close), and the
                form's React onSubmit cannot tell the submitter apart, so a
                filled draft would save instead of cancel. A plain button that
                closes directly has neither trap; `close` clears the draft. */}
            <button
              type="button"
              className="builder-cancel"
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </button>
            {/* Left enabled while incomplete: the browser then reports the first
                offending field and focuses it, which is better than a dead button. */}
            <button type="submit" className="builder-save" disabled={saving}>
              {saving ? "Saving…" : isEditing ? "Save changes" : "Save scenario"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
