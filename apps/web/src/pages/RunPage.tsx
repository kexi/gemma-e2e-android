import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { CaseRun, Run, RunStatus, Step } from "@gemma-e2e/core/schema";
import { fetchRun, screenshotUrl, videoUrl } from "../api.ts";
import { actionIcon, describeAction, StatusChip } from "../status.tsx";
import { DeviceLiveView } from "../DeviceLiveView.tsx";
import { UiTreeDetails } from "../UiTreeDetails.tsx";
import { useDirectionalNavigate } from "../viewTransition.ts";

interface CaseStarted {
  type: "case_started";
  caseId: string;
  caseRun: CaseRun;
}

interface StepRecorded {
  type: "step_recorded";
  caseId: string;
  step: Step;
}

interface CaseFinished {
  type: "case_finished";
  caseId: string;
  status: RunStatus;
  reason: string | null;
  /** Absent on a replayed event from a case recorded before videos existed. */
  videoPath?: string | null;
}

interface RunFinished {
  type: "run_finished";
  status: RunStatus;
  reason: string | null;
}

type LiveEvent = CaseStarted | StepRecorded | CaseFinished | RunFinished | { type: string };

/** Cases keyed by id so replayed and live copies of one event are idempotent. */
type CaseMap = Map<string, CaseRun>;

function upsertCase(cases: CaseMap, caseRun: CaseRun): CaseMap {
  const next = new Map(cases);
  const existing = next.get(caseRun.caseId);
  // Steps already received are kept: case_started replays with an empty list,
  // and a live case_started can arrive after its own first steps.
  next.set(caseRun.caseId, { ...caseRun, steps: existing?.steps ?? caseRun.steps });
  return next;
}

function appendStep(cases: CaseMap, caseId: string, step: Step): CaseMap {
  const next = new Map(cases);
  const existing = next.get(caseId);
  const steps = (existing?.steps ?? []).filter((s) => s.index !== step.index);
  const merged = [...steps, step].sort((a, b) => a.index - b.index);

  next.set(
    caseId,
    existing === undefined ? placeholderCase(caseId, merged) : { ...existing, steps: merged },
  );
  return next;
}

/** A step can outrun its case_started; this keeps the timeline visible anyway. */
function placeholderCase(caseId: string, steps: Step[]): CaseRun {
  return {
    runId: "",
    caseId,
    order: Number.MAX_SAFE_INTEGER,
    title: caseId,
    prompt: "",
    model: "",
    status: "running",
    verdictReason: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    videoPath: null,
    steps,
  };
}

function finishCase(cases: CaseMap, event: CaseFinished): CaseMap {
  const next = new Map(cases);
  const existing = next.get(event.caseId) ?? placeholderCase(event.caseId, []);
  next.set(event.caseId, {
    ...existing,
    status: event.status,
    verdictReason: event.reason,
    // Kept when the event omits it, so a replay cannot erase a path the
    // initial fetch already supplied.
    videoPath: event.videoPath ?? existing.videoPath,
  });
  return next;
}

/**
 * Keeps the tail of a growing list in view while `active`, and stops the moment
 * the user scrolls up to read back.
 *
 * The returned ref goes on a zero-height sentinel at the end of the list. Its
 * visibility is what "the user is at the bottom" means -- not a scrollTop
 * arithmetic, which would have to know which ancestor actually scrolls and would
 * be wrong the moment the layout changes. `root: null` still works inside the
 * workbench's own scroller, because the observer intersects against every
 * clipping ancestor, not just the viewport.
 *
 * `revision` is any value that changes when content is appended; the effect
 * re-runs on it rather than on the list itself so a re-render that changed
 * nothing cannot yank the scroll.
 */
function useFollowTail(active: boolean, revision: number) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  // A ref, not state: nothing renders differently when the user leaves the
  // tail, so a setState here would only cost a render per scroll.
  const isFollowingRef = useRef(true);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (sentinel === null) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        // The last entry is the current state; a burst of appended steps can
        // coalesce several crossings into one callback.
        const latest = entries.at(-1);
        if (latest === undefined) {
          return;
        }
        isFollowingRef.current = latest.isIntersecting;
      },
      // Bottom margin, so the tail is still "in view" just after it scrolls off
      // and a step that lands mid-animation does not drop the follow.
      { rootMargin: "0px 0px 160px 0px" },
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const shouldFollow = active && isFollowingRef.current && sentinel !== null;
    if (!shouldFollow) {
      return;
    }

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sentinel.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "end" });
  }, [active, revision]);

  return sentinelRef;
}

export function RunPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [cases, setCases] = useState<CaseMap>(new Map());
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const navigate = useDirectionalNavigate();

  useEffect(() => {
    if (id === undefined) {
      return;
    }

    // A different run means a different timeline; without this the previous
    // run's cases would linger until the new stream replayed over them.
    setRun(null);
    setCases(new Map());
    setStatus(null);
    setReason(null);
    setError(null);

    let cancelled = false;

    fetchRun(id)
      .then((body) => {
        if (cancelled) {
          return;
        }
        setRun(body.run);
        setStatus(body.run.status);
        setReason(body.run.verdictReason);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });

    // The stream replays every case and step already recorded before switching
    // to live delivery, so it is the single source of the timeline.
    const source = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);

    const handle = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as LiveEvent;

      if (event.type === "case_started") {
        const { caseRun } = event as CaseStarted;
        setCases((current) => upsertCase(current, caseRun));
      }

      if (event.type === "step_recorded") {
        const { caseId, step } = event as StepRecorded;
        setCases((current) => appendStep(current, caseId, step));
      }

      if (event.type === "case_finished") {
        const finished = event as CaseFinished;
        setCases((current) => finishCase(current, finished));
      }

      if (event.type === "run_finished") {
        const finished = event as RunFinished;
        setStatus(finished.status);
        setReason(finished.reason);
        source.close();
      }
    };

    // Every frame the server sends carries an `event:` name, so the default
    // "message" listener never fires; each name is registered explicitly.
    source.addEventListener("case_started", handle);
    source.addEventListener("step_recorded", handle);
    source.addEventListener("case_finished", handle);
    source.addEventListener("run_finished", handle);
    source.onerror = () => source.close();

    return () => {
      cancelled = true;
      source.close();
    };
  }, [id]);

  // The view transition swaps the pane's contents but does not move focus, so
  // the rail button the user clicked would keep it and a screen reader would
  // never announce the run.
  useEffect(() => {
    headingRef.current?.focus();
  }, [run?.id]);

  const isRunning = status === "running";
  const ordered = [...cases.values()].sort((a, b) => a.order - b.order);
  // Counts rather than the map itself: this is exactly the "something was
  // appended" signal, so a case merely changing status cannot trigger a scroll.
  const appendCount = ordered.reduce(
    (total, caseRun) => total + caseRun.steps.length,
    ordered.length,
  );
  // Above the early returns below, so the hook order holds across the loading,
  // error, and loaded renders.
  const tailRef = useFollowTail(isRunning, appendCount);

  if (error !== null) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (run === null) {
    return <CircularProgress size={24} />;
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Button
          size="small"
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate("/", "backward")}
          sx={{ mb: 1, ml: -1 }}
        >
          Device
        </Button>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="h5" component="h1" ref={headingRef} tabIndex={-1}>
            {run.title}
          </Typography>
          {status !== null && <StatusChip status={status} />}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {run.scenarioId} · {ordered.length} case{ordered.length === 1 ? "" : "s"} · started{" "}
          {new Date(run.startedAt).toLocaleString()}
        </Typography>
        {reason !== null && (
          <Alert severity={status === "passed" ? "success" : "warning"} sx={{ mt: 2 }}>
            {reason}
          </Alert>
        )}
      </Box>

      {isRunning && <LinearProgress />}

      <Stack direction={{ xs: "column", lg: "row" }} spacing={3} sx={{ alignItems: "flex-start" }}>
        <Stack spacing={1} sx={{ flexGrow: 1, minWidth: 0, width: "100%" }}>
          {ordered.map((caseRun, position) => (
            // The first case is above the fold, where deferring rendering costs
            // more than it saves: the browser would evaluate its visibility
            // boundary before it could paint anything at all.
            <CaseAccordion key={caseRun.caseId} caseRun={caseRun} deferred={position > 0} />
          ))}
          {ordered.length === 0 && !isRunning && (
            <Typography color="text.secondary">No cases were recorded.</Typography>
          )}
          {/* The follow-tail sentinel. A plain div outside any `.deferred-case`,
              so its position is real geometry the observer can trust rather than
              a `contain-intrinsic-size` estimate. */}
          <div ref={tailRef} aria-hidden="true" />
        </Stack>

        {/* Unmounted the moment the run ends, which is what closes the socket
            and releases the emulator-side encoder. The finished timeline keeps
            each step's stored screenshot, so nothing is lost by dropping it. */}
        {isRunning && (
          <Box
            sx={{
              width: { xs: "100%", lg: 320 },
              flexShrink: 0,
              position: { lg: "sticky" },
              top: { lg: 0 },
            }}
          >
            <Typography variant="subtitle2" gutterBottom>
              Live screen
            </Typography>
            <DeviceLiveView maxHeight="60vh" showHint={false} />
          </Box>
        )}
      </Stack>
    </Stack>
  );
}

function CaseAccordion({ caseRun, deferred }: { caseRun: CaseRun; deferred: boolean }) {
  // Open while it is the case being worked on, and after a failure, which are
  // the two moments the steps are worth reading.
  const startsOpen = caseRun.status !== "passed";

  return (
    <Accordion
      className={deferred ? "deferred-case" : undefined}
      defaultExpanded={startsOpen}
      variant="outlined"
      disableGutters
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap", width: "100%" }}
        >
          <StatusChip status={caseRun.status} />
          <Typography variant="subtitle1">{caseRun.title}</Typography>
          {caseRun.model !== "" && <Chip size="small" variant="outlined" label={caseRun.model} />}
          <Typography variant="caption" color="text.secondary">
            {caseRun.steps.length} step{caseRun.steps.length === 1 ? "" : "s"}
          </Typography>
        </Stack>
      </AccordionSummary>

      <AccordionDetails>
        <Stack spacing={2}>
          {caseRun.prompt !== "" && <Typography variant="body2">{caseRun.prompt}</Typography>}
          {caseRun.verdictReason !== null && (
            <Alert severity={caseRun.status === "passed" ? "success" : "warning"}>
              {caseRun.verdictReason}
            </Alert>
          )}

          {/* Only once the case is over: scrcpy finalises the mp4 on stop, so a
              player pointed at the file mid-case would find no index to seek by. */}
          {caseRun.videoPath !== null && caseRun.status !== "running" && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Recording
              </Typography>
              <Box
                component="video"
                controls
                preload="metadata"
                src={videoUrl(caseRun.videoPath)}
                sx={{ width: "100%", maxWidth: 360, borderRadius: 1, display: "block" }}
              />
            </Box>
          )}

          {caseRun.steps.map((step, position) => (
            // Same reasoning as the case list: only the steps that cannot be in
            // the opening viewport are worth deferring.
            <Card
              key={step.index}
              className={position > 0 ? "deferred-step" : undefined}
              variant="outlined"
            >
              <CardContent>
                <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
                  <Avatar sx={{ bgcolor: step.note === null ? "primary.main" : "error.main" }}>
                    {actionIcon(step.action)}
                  </Avatar>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="subtitle1">
                      {step.index + 1}. {describeAction(step.action)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(step.createdAt).toLocaleTimeString()}
                    </Typography>
                    {step.note !== null && (
                      <Alert severity="warning" sx={{ mt: 1 }}>
                        {step.note}
                      </Alert>
                    )}
                    {step.uiText !== "" && (
                      <Box sx={{ mt: 1 }}>
                        <UiTreeDetails uiText={step.uiText} />
                      </Box>
                    )}
                  </Box>
                  {step.screenshotPath !== null && (
                    <Link
                      href={screenshotUrl(step.screenshotPath)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Box
                        component="img"
                        src={screenshotUrl(step.screenshotPath)}
                        alt={`step ${step.index + 1}`}
                        sx={{ width: 96, borderRadius: 1, display: "block" }}
                      />
                    </Link>
                  )}
                </Stack>
              </CardContent>
            </Card>
          ))}

          {caseRun.steps.length === 0 && (
            <Typography color="text.secondary">No steps yet.</Typography>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
