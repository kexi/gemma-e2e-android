import type { UiNode } from "@gemma-e2e/core";
import { centerOf } from "./parse.ts";

/** A numbered, actionable element the model may target by `ref`. */
export interface UiRef {
  ref: number;
  node: UiNode;
  center: { x: number; y: number };
}

export interface SerializedUi {
  text: string;
  refs: Map<number, UiRef>;
}

const EDITABLE_CLASS_PATTERN = /EditText|AutoCompleteTextView|SearchView/i;
const INDENT = "  ";

/** `com.example:id/login_button` -> `login_button`; ids are noise beyond the leaf. */
function shortResourceId(resourceId: string): string {
  const slash = resourceId.lastIndexOf("/");
  const hasPackagePrefix = slash >= 0;
  return hasPackagePrefix ? resourceId.slice(slash + 1) : resourceId;
}

/** `android.widget.Button` -> `Button`. */
function shortClassName(className: string): string {
  const dot = className.lastIndexOf(".");
  const isQualified = dot >= 0;
  return isQualified ? className.slice(dot + 1) : className;
}

function isEditable(node: UiNode): boolean {
  return EDITABLE_CLASS_PATTERN.test(node.className);
}

/** Editable fields are targets even when uiautomator marks them unclickable. */
function isActionable(node: UiNode): boolean {
  const isInteractive = node.clickable || isEditable(node);
  return isInteractive && node.enabled;
}

function hasZeroArea(node: UiNode): boolean {
  const { x1, y1, x2, y2 } = node.bounds;
  return x2 <= x1 || y2 <= y1;
}

/** Anything the model could read or act on; everything else is scaffolding. */
function carriesInformation(node: UiNode): boolean {
  return node.text !== "" || node.contentDesc !== "" || isActionable(node);
}

/**
 * True when a node exists only to hold one child -- a layout wrapper. Collapsing
 * these is what keeps a 200-node dump readable: nesting depth in the output
 * then reflects meaningful grouping rather than layout implementation.
 */
function isRedundantContainer(node: UiNode, renderableChildren: UiNode[]): boolean {
  return !carriesInformation(node) && renderableChildren.length <= 1;
}

function describe(node: UiNode, ref: number | undefined): string {
  const parts: string[] = [];

  const hasRef = ref !== undefined;
  if (hasRef) {
    parts.push(`[${ref}]`);
  }

  parts.push(shortClassName(node.className) || "View");

  const hasText = node.text !== "";
  if (hasText) {
    parts.push(`text=${JSON.stringify(node.text)}`);
  }

  const hasContentDesc = node.contentDesc !== "" && node.contentDesc !== node.text;
  if (hasContentDesc) {
    parts.push(`desc=${JSON.stringify(node.contentDesc)}`);
  }

  const shortId = shortResourceId(node.resourceId);
  const hasId = shortId !== "";
  if (hasId) {
    parts.push(`id=${shortId}`);
  }

  const isCheckable = node.checked !== undefined;
  if (isCheckable) {
    parts.push(`checked=${node.checked === true}`);
  }

  // Only the exceptional states are worth tokens; enabled+unfocused is the norm.
  const isDisabled = !node.enabled;
  if (isDisabled) {
    parts.push("disabled");
  }

  if (node.focused) {
    parts.push("focused");
  }

  if (isEditable(node)) {
    parts.push("editable");
  }

  return parts.join(" ");
}

/**
 * Renders the tree as indented text and numbers every actionable element.
 *
 * Refs are assigned in document order, which is top-to-bottom on screen, so the
 * numbering matches how a human would scan the screen.
 */
export function serializeForLlm(tree: UiNode): SerializedUi {
  const refs = new Map<number, UiRef>();
  const lines: string[] = [];
  let nextRef = 0;

  function walk(node: UiNode, depth: number): void {
    const isInvisible = hasZeroArea(node);
    if (isInvisible) {
      return;
    }

    const renderableChildren = node.children.filter((child) => !hasZeroArea(child));

    const shouldCollapse = isRedundantContainer(node, renderableChildren);
    if (shouldCollapse) {
      for (const child of renderableChildren) {
        walk(child, depth);
      }
      return;
    }

    let ref: number | undefined;
    const needsRef = isActionable(node);
    if (needsRef) {
      ref = nextRef++;
      refs.set(ref, { ref, node, center: centerOf(node.bounds) });
    }

    lines.push(`${INDENT.repeat(depth)}${describe(node, ref)}`);

    for (const child of renderableChildren) {
      walk(child, depth + 1);
    }
  }

  walk(tree, 0);

  return { text: lines.join("\n"), refs };
}
