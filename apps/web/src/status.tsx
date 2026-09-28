import type { ReactElement } from "react";
import Chip from "@mui/material/Chip";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import HourglassEmptyIcon from "@mui/icons-material/HourglassEmpty";
import KeyboardIcon from "@mui/icons-material/Keyboard";
import SwipeIcon from "@mui/icons-material/Swipe";
import TouchAppIcon from "@mui/icons-material/TouchApp";
import type { Action, RunStatus } from "@gemma-e2e/core/schema";
import type { Messages } from "./i18n.ts";
import { useI18n } from "./I18nProvider.tsx";

type ChipColor = "default" | "success" | "error" | "info";

const STATUS_COLOR: Record<RunStatus, ChipColor> = {
  // Grey, not "info": a queued run has not touched the device yet, and the same
  // blue as "running" would say it is underway when the only thing that has
  // happened is that it got a place in line.
  queued: "default",
  running: "info",
  passed: "success",
  failed: "error",
  error: "error",
};

export function StatusChip({ status }: { status: RunStatus }) {
  const { t } = useI18n();
  return <Chip size="small" label={t.status[status]} color={STATUS_COLOR[status]} />;
}

export function actionIcon(action: Action): ReactElement {
  switch (action.type) {
    case "tap":
      return <TouchAppIcon />;
    case "input_text":
      return <KeyboardIcon />;
    case "swipe":
      return <SwipeIcon />;
    case "key_event":
      return <ArrowBackIcon />;
    case "wait":
      return <HourglassEmptyIcon />;
    case "remember":
      return <BookmarkIcon />;
    case "finish":
      return action.verdict === "passed" ? <CheckCircleIcon /> : <ErrorIcon />;
  }
}

/**
 * One line naming what a step did. The wording is the active language's; the
 * refs, typed text and the model's reason stay as recorded, since they are what
 * the reader compares against the UI tree and the logs.
 */
export function describeAction(action: Action, t: Messages): string {
  switch (action.type) {
    case "tap":
      return t.action.tap(action.ref);
    case "input_text":
      return t.action.inputText(JSON.stringify(action.text), action.ref);
    case "swipe":
      return t.action.swipe(action.direction);
    case "key_event":
      return t.action.keyEvent(action.key);
    case "wait":
      return t.action.wait(action.ms);
    case "remember":
      return t.action.remember(JSON.stringify(action.text));
    case "finish":
      return t.action.finish(t.status[action.verdict], action.reason);
  }
}
