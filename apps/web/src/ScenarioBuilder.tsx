import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { createScenario, type CreateScenarioRequest, type ModelInfo } from "./api.ts";

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
  /** Lets the rail re-read `/api/scenarios` so the new one is runnable at once. */
  onCreated: () => void;
}

/**
 * "New scenario" and the dialog behind it. Native `<dialog>` rather than MUI's:
 * the platform already gives the top layer, the focus trap, Esc handling, and
 * -- with `closedby="any"` -- light dismiss, none of which need re-implementing.
 * MUI is used only for the surrounding rail, so this component styles itself.
 */
export function ScenarioBuilder({ models, onCreated }: ScenarioBuilderProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogId = useId();

  const [id, setId] = useState("");
  // Tracks whether the user has taken the id over, so typing a title stops
  // overwriting an id they chose on purpose.
  const [idIsCustom, setIdIsCustom] = useState(false);
  const [title, setTitle] = useState("");
  const [appPackage, setAppPackage] = useState("");
  const [appActivity, setAppActivity] = useState("");
  const [model, setModel] = useState(SERVER_DEFAULT);
  const [cases, setCases] = useState<CaseDraft[]>(() => [emptyCase()]);
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

  function reset() {
    setId("");
    setIdIsCustom(false);
    setTitle("");
    setAppPackage("");
    setAppActivity("");
    setModel(SERVER_DEFAULT);
    setCases([emptyCase()]);
    setError(null);
  }

  // A dialog dismissed by Esc or the backdrop never runs the submit path, so
  // the reset hangs off `close` rather than off any one button.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) {
      return;
    }
    dialog.addEventListener("close", reset);
    return () => dialog.removeEventListener("close", reset);
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
      await createScenario(body);
      // Closing fires `close`, which resets the form for the next scenario.
      dialogRef.current?.close();
      onCreated();
    } catch (cause) {
      // A 409 from a name already on disk belongs next to the field that
      // caused it, not in the rail behind a dialog the user is still looking at.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }

  const onlyOneCase = cases.length === 1;

  return (
    <>
      <button
        type="button"
        className="builder-open"
        {...(hasInvokerCommands ? { command: "show-modal", commandfor: dialogId } : {})}
        onClick={() => {
          if (!hasInvokerCommands) {
            dialogRef.current?.showModal();
          }
        }}
      >
        New scenario
      </button>

      <dialog
        id={dialogId}
        ref={dialogRef}
        className="builder-dialog"
        aria-labelledby={`${dialogId}-heading`}
        {...(hasClosedBy ? { closedby: "any" } : {})}
      >
        <form className="builder-form" method="dialog" onSubmit={submit} noValidate={false}>
          <h2 id={`${dialogId}-heading`} className="builder-heading">
            New scenario
          </h2>
          <p className="builder-lede">
            Saved as <code>scenarios/&lt;id&gt;.yaml</code>, which is git-managed — commit it to
            keep it. An existing file is never overwritten.
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
              <label htmlFor={`${dialogId}-id`}>File name *</label>
              <span id={`${dialogId}-id-hint`} className="builder-hint">
                Lowercase letters, digits and hyphens. Becomes scenarios/&lt;id&gt;.yaml.
              </span>
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
            {/* formMethod="dialog" closes without submitting, so Cancel needs no
                handler of its own; `close` clears the draft. */}
            <button type="submit" formMethod="dialog" className="builder-cancel">
              Cancel
            </button>
            {/* Left enabled while incomplete: the browser then reports the first
                offending field and focuses it, which is better than a dead button. */}
            <button type="submit" className="builder-save" disabled={saving}>
              {saving ? "Saving…" : "Save scenario"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
