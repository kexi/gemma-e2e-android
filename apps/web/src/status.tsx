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

type ChipColor = "default" | "success" | "error" | "info";

const STATUS_COLOR: Record<RunStatus, ChipColor> = {
  running: "info",
  passed: "success",
  failed: "error",
  error: "error",
};

export function StatusChip({ status }: { status: RunStatus }) {
  return <Chip size="small" label={status} color={STATUS_COLOR[status]} />;
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

export function describeAction(action: Action): string {
  switch (action.type) {
    case "tap":
      return `tap [${action.ref}]`;
    case "input_text":
      return `type ${JSON.stringify(action.text)} into [${action.ref}]`;
    case "swipe":
      return `swipe ${action.direction}`;
    case "key_event":
      return `press ${action.key}`;
    case "wait":
      return `wait ${action.ms}ms`;
    case "remember":
      return `remember ${JSON.stringify(action.text)}`;
    case "finish":
      return `finish ${action.verdict}: ${action.reason}`;
  }
}
