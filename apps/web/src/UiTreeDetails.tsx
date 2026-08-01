import { useCallback, useEffect, useRef, useState } from "react";

/** `hidden="until-found"` is the value; React types only accept `boolean`. */
const UNTIL_FOUND = "until-found" as unknown as boolean;

const SUPPORTS_UNTIL_FOUND = "onbeforematch" in HTMLElement.prototype;

export interface UiTreeDetailsProps {
  /** The uiautomator dump the model was shown for this step. */
  uiText: string;
}

/**
 * A step's UI tree, collapsed but still reachable by the browser's find-in-page.
 *
 * The dump is the only record of what the model actually saw, and finding the
 * step that mentions a widget is the usual way into a failed run — so the text
 * has to survive being collapsed. `<details>` keeps it in the find-in-page
 * index and expands itself on a match; `hidden="until-found"` on the body makes
 * that work on the browsers where `details-content` is otherwise skipped.
 */
export function UiTreeDetails({ uiText }: UiTreeDetailsProps) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLPreElement>(null);

  // Without `beforematch` support the body would stay hidden forever, so it is
  // revealed up front and the <details> alone does the collapsing.
  const isHiddenUntilFound = SUPPORTS_UNTIL_FOUND && !open;

  const handleBeforeMatch = useCallback(() => {
    setOpen(true);
  }, []);

  useEffect(() => {
    const body = bodyRef.current;
    if (body === null) {
      return;
    }
    body.addEventListener("beforematch", handleBeforeMatch);
    return () => body.removeEventListener("beforematch", handleBeforeMatch);
  }, [handleBeforeMatch]);

  const lineCount = uiText === "" ? 0 : uiText.split("\n").length;

  return (
    <details
      className="ui-tree-details"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>UI tree ({lineCount} lines)</summary>
      <pre className="ui-tree-body" ref={bodyRef} hidden={isHiddenUntilFound ? UNTIL_FOUND : false}>
        {uiText}
      </pre>
    </details>
  );
}
