import type { UiNode } from "@gemma-e2e/core";

/**
 * One element as the page reported it, before any interpretation.
 *
 * Deliberately flat and primitive: this crosses the CDP boundary as JSON, and
 * everything downstream of it is a pure function -- which is what lets the
 * mapping be tested without a browser. `children` holds indices into the same
 * array rather than nested objects, so the collector can emit it in one pass.
 */
export interface RawElement {
  tag: string;
  id: string;
  /** `aria-label` ?? `placeholder` ?? `title` ?? `alt` ?? the role, in that order. */
  label: string;
  /** Own text only -- a parent must not repeat what its children already say. */
  text: string;
  /** Viewport-relative, which is the coordinate space input events use. */
  rect: { x: number; y: number; width: number; height: number };
  clickable: boolean;
  editable: boolean;
  disabled: boolean;
  focused: boolean;
  /** Absent unless the element is a checkbox, a radio, or aria-checked. */
  checked?: boolean | undefined;
  children: number[];
}

/** What {@link COLLECT_JS} evaluates to: a flat pool plus the roots into it. */
export interface RawTree {
  elements: RawElement[];
  roots: number[];
}

/**
 * Maps what the page reported onto the tree the serializer already knows how
 * to render.
 *
 * The field names are Android's because `UiNode` was uiautomator's shape
 * first, and keeping that shape is the point: `serializeForLlm`, the ref
 * numbering, the action vocabulary, and the system prompt all stay single
 * implementations. `className` therefore carries a tag name and `resourceId`
 * an `id` attribute -- the serializer's shorteners are the identity on both.
 *
 * *Why editability is carried rather than re-derived:* the serializer decides
 * it from `className`, which is a tag here, and a `<div contenteditable>` is
 * editable while its tag says nothing. The collector already knows, so the tag
 * is reported as `contenteditable` in exactly that case and the one pattern
 * keeps working for both platforms.
 */
export function toUiNode(raw: RawTree): UiNode {
  const nodeAt = (index: number): UiNode => {
    const element = raw.elements[index];
    const isMissing = element === undefined;
    if (isMissing) {
      throw new DomWalkError(`element ${index} is not in the reported tree`);
    }

    return {
      // An editable element whose tag does not already say so is renamed, since
      // the serializer reads editability from the class name. Any tag can carry
      // contenteditable -- a p, a span, a td -- so this cannot be limited to
      // div without silently dropping the rest.
      className: isRenamedForEditing(element) ? "contenteditable" : element.tag,
      resourceId: element.id,
      text: element.text,
      // Dropped when it merely repeats the text: the serializer omits a
      // duplicate desc anyway, and carrying it costs a comparison twice.
      contentDesc: element.label === element.text ? "" : element.label,
      bounds: {
        x1: Math.round(element.rect.x),
        y1: Math.round(element.rect.y),
        x2: Math.round(element.rect.x + element.rect.width),
        y2: Math.round(element.rect.y + element.rect.height),
      },
      clickable: element.clickable,
      enabled: !element.disabled,
      focused: element.focused,
      ...(element.checked === undefined ? {} : { checked: element.checked }),
      children: element.children.map(nodeAt),
    };
  };

  // A document has one root, but a fragment reported by a collector need not,
  // so the roots are gathered under a container the serializer will collapse
  // when it carries nothing itself.
  const isSingleRoot = raw.roots.length === 1;
  if (isSingleRoot) {
    return nodeAt(raw.roots[0] as number);
  }

  return {
    className: "body",
    resourceId: "",
    text: "",
    contentDesc: "",
    bounds: boundsOver(raw),
    clickable: false,
    enabled: true,
    focused: false,
    children: raw.roots.map(nodeAt),
  };
}

export class DomWalkError extends Error {
  override readonly name = "DomWalkError";
}

/** Tags the serializer already treats as editable, so they keep their own name. */
const SELF_DESCRIBING_EDITABLE = new Set(["input", "textarea"]);

/**
 * True when an editable element's tag would not tell the serializer so.
 * `<div contenteditable>` and `<p contenteditable>` both land here; `<input>`
 * does not, because "input" already matches the editable pattern.
 */
function isRenamedForEditing(element: RawElement): boolean {
  return element.editable && !SELF_DESCRIBING_EDITABLE.has(element.tag);
}

/**
 * A box enclosing every root, so a synthesised container is never zero-area --
 * the serializer drops those, and dropping the container would drop the page.
 */
function boundsOver(raw: RawTree): UiNode["bounds"] {
  const rects = raw.roots.map((index) => raw.elements[index]?.rect).filter((r) => r !== undefined);

  const isEmpty = rects.length === 0;
  if (isEmpty) {
    return { x1: 0, y1: 0, x2: 0, y2: 0 };
  }

  return {
    x1: Math.round(Math.min(...rects.map((r) => r.x))),
    y1: Math.round(Math.min(...rects.map((r) => r.y))),
    x2: Math.round(Math.max(...rects.map((r) => r.x + r.width))),
    y2: Math.round(Math.max(...rects.map((r) => r.y + r.height))),
  };
}
