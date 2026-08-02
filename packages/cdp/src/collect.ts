/**
 * The source evaluated inside the page to produce a {@link RawTree}.
 *
 * A string rather than a function serialised with `toString()`: this never runs
 * in this process, so the bundler must not touch it, and reading it as source
 * is the only way to see what actually reaches the browser. It collects and
 * measures; it interprets nothing, because everything it could interpret is
 * testable without a browser and this is not (see `toUiNode`).
 *
 * *Why not `Accessibility.getFullAXTree`:* the AX tree carries no geometry, so
 * every node would need a `DOM.getBoxModel` round trip or a second
 * `DOMSnapshot.captureSnapshot` joined on `backendDOMNodeId`. Both are
 * experimental, the join is fiddly, and `getBoundingClientRect` hands us the
 * coordinates alongside the semantics in one evaluation.
 */
export const COLLECT_JS = String.raw`(() => {
  const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "head", "link", "meta"]);
  const CLICKABLE_ROLES = new Set(["button", "link", "checkbox", "radio", "tab", "menuitem", "switch", "option"]);

  const elements = [];
  const roots = [];

  const labelOf = (el) =>
    el.getAttribute("aria-label") ||
    el.getAttribute("placeholder") ||
    el.getAttribute("title") ||
    el.getAttribute("alt") ||
    el.getAttribute("role") ||
    "";

  /** Own text only: a parent repeating its children's words doubles the prompt. */
  const ownText = (el) => {
    let out = "";
    for (const child of el.childNodes) {
      if (child.nodeType === 3) out += child.nodeValue;
    }
    return out.replace(/\s+/g, " ").trim();
  };

  const isEditable = (el, tag) => {
    if (tag === "textarea") return true;
    if (el.isContentEditable) return true;
    if (tag !== "input") return false;
    // Buttons and checkboxes are <input> too, but nothing is typed into them.
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return !["button", "submit", "reset", "checkbox", "radio", "file", "image", "hidden"].includes(type);
  };

  const isClickable = (el, tag, style) => {
    if (["button", "select", "summary"].includes(tag)) return true;
    if (tag === "a" && el.hasAttribute("href")) return true;
    if (tag === "input") return true;
    if (tag === "label" && el.htmlFor) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (CLICKABLE_ROLES.has(role)) return true;
    if (el.hasAttribute("onclick") || el.tabIndex >= 0) return true;
    return style.cursor === "pointer";
  };

  const checkedOf = (el, tag) => {
    const aria = el.getAttribute("aria-checked");
    if (aria === "true") return true;
    if (aria === "false") return false;
    if (tag !== "input") return undefined;
    const type = (el.getAttribute("type") || "").toLowerCase();
    return type === "checkbox" || type === "radio" ? el.checked : undefined;
  };

  /**
   * Reports the element and returns its index, or -1 when it is not worth
   * reporting. Children are walked even when the parent is skipped, so a
   * wrapper never hides what is inside it.
   */
  const visit = (el, into) => {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (el.getAttribute("aria-hidden") === "true") return;

    const style = getComputedStyle(el);
    // display:none removes the subtree outright; the others hide this element
    // while its children may still be painted, so only it is skipped.
    if (style.display === "none") return;
    const isHidden = style.visibility === "hidden" || style.opacity === "0";

    const rect = el.getBoundingClientRect();
    const editable = isEditable(el, tag);
    const clickable = !editable && isClickable(el, tag, style);
    const text = ownText(el);
    const label = labelOf(el);

    // Off-screen elements are dropped rather than reported at their real
    // coordinates: an action against one would land outside the viewport, and
    // the model cannot see them either.
    const onScreen =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth;

    const carriesInformation = text !== "" || label !== "" || clickable || editable;
    const worthReporting = onScreen && !isHidden && carriesInformation;

    let index = -1;
    let childrenInto = into;
    if (worthReporting) {
      index = elements.length;
      const entry = {
        tag,
        id: el.id || "",
        label,
        text,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        clickable,
        editable,
        disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
        focused: document.activeElement === el,
        children: [],
      };
      const checked = checkedOf(el, tag);
      if (checked !== undefined) entry.checked = checked;
      elements.push(entry);
      into.push(index);
      childrenInto = entry.children;
    }

    for (const child of el.children) visit(child, childrenInto);
  };

  for (const child of document.body.children) visit(child, roots);
  return { elements, roots };
})()`;
