import { useId, useRef, useState } from "react";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import DeleteIcon from "@mui/icons-material/Delete";
import { deleteScenario, type Scenario } from "./api.ts";
import { code, useI18n } from "./I18nProvider.tsx";

export interface ScenarioDeleteProps {
  scenario: Scenario;
  /** Lets the rail re-read `/api/scenarios` so the card disappears at once. */
  onDeleted: () => void;
}

/**
 * The delete affordance for one scenario card, plus the confirmation behind it.
 * Native `<dialog>` rather than `window.confirm`: the platform dialog can name
 * the file and say how to get it back, which a one-line browser prompt cannot,
 * and it matches the builder beside it.
 */
export function ScenarioDelete({ scenario, onDeleted }: ScenarioDeleteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogId = useId();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  // Same reasoning as the builder: invoker commands where they exist, a
  // showModal() call where they do not, rather than a polyfill.
  const hasInvokerCommands =
    typeof HTMLButtonElement !== "undefined" && "commandForElement" in HTMLButtonElement.prototype;

  // `closedby` is not in Safari yet. Without it a backdrop click does nothing,
  // which for a confirmation is the safer half of the loss anyway; Esc closes.
  const hasClosedBy =
    typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype;

  async function confirm() {
    setDeleting(true);
    setError(null);
    try {
      await deleteScenario(scenario.id);
      onDeleted();
      dialogRef.current?.close();
    } catch (cause) {
      // Kept inside the dialog the user is still looking at: the rail behind it
      // is about to lose this card, so an error there would have nothing to
      // point at.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Tooltip title={t.deleteScenario.tooltip(scenario.id)}>
        <IconButton
          size="small"
          aria-label={t.deleteScenario.label(scenario.title)}
          {...(hasInvokerCommands ? { command: "show-modal", commandfor: dialogId } : {})}
          onClick={() => {
            setError(null);
            if (!hasInvokerCommands) {
              dialogRef.current?.showModal();
            }
          }}
        >
          <DeleteIcon />
        </IconButton>
      </Tooltip>

      <dialog
        id={dialogId}
        ref={dialogRef}
        className="builder-dialog"
        aria-labelledby={`${dialogId}-heading`}
        {...(hasClosedBy ? { closedby: "any" } : {})}
      >
        <div className="builder-form">
          <h2 id={`${dialogId}-heading`} className="builder-heading">
            {t.deleteScenario.heading(scenario.title)}
          </h2>
          <p className="builder-lede">{t.deleteScenario.lede(code, scenario.id)}</p>

          {error !== null && (
            <p className="builder-error" role="alert">
              <span aria-hidden="true">❌</span> {error}
            </p>
          )}

          <div className="builder-actions">
            {/* Plain button, not a dialog-method submit: same lesson as the
                builder's Cancel -- nothing here should be able to run a form. */}
            <button
              type="button"
              className="builder-cancel"
              onClick={() => dialogRef.current?.close()}
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              className="builder-delete"
              disabled={deleting}
              onClick={() => void confirm()}
            >
              {deleting ? t.deleteScenario.deleting : t.deleteScenario.confirm}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
