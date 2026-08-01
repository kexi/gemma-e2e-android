import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { Run, RunStatus, Step } from "@gemma-e2e/core/schema";
import { fetchRun, screenshotUrl } from "../api.ts";
import { actionIcon, describeAction, StatusChip } from "../status.tsx";

interface StepRecorded {
  type: "step_recorded";
  step: Step;
}

interface RunFinished {
  type: "run_finished";
  status: RunStatus;
  reason: string | null;
}

type LiveEvent = StepRecorded | RunFinished | { type: string };

export function RunPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === undefined) {
      return;
    }

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

    // The stream replays every step already recorded before switching to live
    // delivery, so it is the single source of the timeline: merging by index
    // makes the replayed and live copies of a step idempotent.
    const source = new EventSource(`/api/runs/${encodeURIComponent(id)}/events`);

    const handle = (message: MessageEvent<string>) => {
      const event = JSON.parse(message.data) as LiveEvent;

      if (event.type === "step_recorded") {
        const { step } = event as StepRecorded;
        setSteps((current) => {
          const rest = current.filter((s) => s.index !== step.index);
          return [...rest, step].sort((a, b) => a.index - b.index);
        });
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
    source.addEventListener("step_recorded", handle);
    source.addEventListener("run_finished", handle);
    source.onerror = () => source.close();

    return () => {
      cancelled = true;
      source.close();
    };
  }, [id]);

  if (error !== null) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (run === null) {
    return <CircularProgress size={24} />;
  }

  const isRunning = status === "running";

  return (
    <Stack spacing={3}>
      <Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="h5">{run.title}</Typography>
          {status !== null && <StatusChip status={status} />}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {run.scenarioId} · started {new Date(run.startedAt).toLocaleString()}
        </Typography>
        <Typography sx={{ mt: 1 }}>{run.prompt}</Typography>
        {reason !== null && (
          <Alert severity={status === "passed" ? "success" : "warning"} sx={{ mt: 2 }}>
            {reason}
          </Alert>
        )}
      </Box>

      {isRunning && <LinearProgress />}

      <Stack spacing={2}>
        {steps.map((step) => (
          <Card key={step.index} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
                <Avatar sx={{ bgcolor: step.note === null ? "primary.main" : "error.main" }}>
                  {actionIcon(step.action)}
                </Avatar>
                <Box sx={{ flexGrow: 1 }}>
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
                </Box>
                {step.screenshotPath !== null && (
                  <Link href={screenshotUrl(step.screenshotPath)} target="_blank" rel="noreferrer">
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
        {steps.length === 0 && !isRunning && (
          <Typography color="text.secondary">No steps were recorded.</Typography>
        )}
      </Stack>
    </Stack>
  );
}
