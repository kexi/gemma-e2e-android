import { type FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import {
  createRun,
  fetchModels,
  fetchRuns,
  fetchScenarios,
  type CreateRunRequest,
  type ModelInfo,
  type Run,
  type Scenario,
} from "./api.ts";
import { ScenarioBuilder } from "./ScenarioBuilder.tsx";
import { StatusChip } from "./status.tsx";
import { useDirectionalNavigate } from "./viewTransition.ts";

/** Sentinel for "let the server decide", which is not a model id. */
const SERVER_DEFAULT = "";

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export interface SidebarProps {
  /** Closes the mobile Drawer once a run has been picked or started. */
  onNavigate?: () => void;
}

/**
 * The standing left rail: everything that starts a run, plus the history that
 * selects which run the main pane shows. Starting a run navigates the main pane
 * to it, which is why this component owns neither the run detail nor the
 * device view.
 */
export function Sidebar({ onNavigate }: SidebarProps) {
  const { id: selectedRunId } = useParams<{ id: string }>();
  const navigate = useDirectionalNavigate();

  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [model, setModel] = useState(SERVER_DEFAULT);
  const [starting, setStarting] = useState(false);

  // Also called after the builder writes a file, so a scenario created here is
  // runnable without a page reload.
  function reloadScenarios() {
    fetchScenarios()
      .then((body) => setScenarios(body.scenarios))
      .catch((cause: unknown) => setError(message(cause)));
  }

  useEffect(() => {
    reloadScenarios();

    // A model server that is down must not block running a committed scenario,
    // so this failure is reported beside the dropdown rather than as a rail
    // error.
    fetchModels()
      .then((body) => setModels(body.models))
      .catch((cause: unknown) => setModelsError(message(cause)));
  }, []);

  // Re-read the history whenever the selected run changes: that covers both a
  // run just started here and a deep link opened cold.
  useEffect(() => {
    fetchRuns()
      .then((body) => setRuns(body.runs))
      .catch((cause: unknown) => setError(message(cause)));
  }, [selectedRunId]);

  async function start(body: CreateRunRequest) {
    setStarting(true);
    setError(null);
    try {
      const { runId } = await createRun(body);
      navigate(`/runs/${runId}`, "forward");
      onNavigate?.();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setStarting(false);
    }
  }

  function submitAdHoc(event: FormEvent) {
    event.preventDefault();
    const trimmed = prompt.trim();
    const isEmpty = trimmed === "";
    if (isEmpty) {
      return;
    }

    void start({
      prompt: trimmed,
      ...(title.trim() === "" ? {} : { title: title.trim() }),
      ...(model === SERVER_DEFAULT ? {} : { model }),
    });
  }

  function openRun(runId: string) {
    // Reopening the same run would animate for nothing.
    if (runId === selectedRunId) {
      onNavigate?.();
      return;
    }
    navigate(`/runs/${runId}`, "forward");
    onNavigate?.();
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      {error !== null && <Alert severity="error">{error}</Alert>}

      <Box>
        <Typography variant="overline" color="text.secondary">
          Scenarios
        </Typography>
        {scenarios === null && <CircularProgress size={20} sx={{ display: "block", mt: 1 }} />}
        {scenarios !== null && scenarios.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No scenarios in scenarios/.
          </Typography>
        )}
        <Stack spacing={1} sx={{ mt: 1 }}>
          {scenarios?.map((scenario) => (
            <Paper key={scenario.id} variant="outlined" sx={{ p: 1.25 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" noWrap title={scenario.title}>
                    {scenario.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {scenario.cases.length} case{scenario.cases.length === 1 ? "" : "s"}
                    {scenario.app !== undefined && ` · ${scenario.app.package}`}
                    {scenario.model !== undefined && ` · ${scenario.model}`}
                  </Typography>
                </Box>
                <Tooltip title={`Run ${scenario.id}`}>
                  <span>
                    <IconButton
                      size="small"
                      color="primary"
                      disabled={starting}
                      aria-label={`Run ${scenario.title}`}
                      onClick={() => void start({ scenarioId: scenario.id })}
                    >
                      <PlayArrowIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>

              <Stack spacing={0.25} sx={{ mt: 1 }}>
                {scenario.cases.map((testCase) => (
                  <Stack
                    key={testCase.id}
                    direction="row"
                    spacing={0.75}
                    sx={{ alignItems: "baseline", flexWrap: "wrap" }}
                  >
                    <Typography variant="caption" sx={{ flexGrow: 1, minWidth: 0 }}>
                      {testCase.title ?? testCase.id}
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={testCase.model ?? scenario.model ?? "default model"}
                    />
                    <Typography variant="caption" color="text.secondary">
                      max {testCase.maxSteps}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          ))}
        </Stack>

        <Box sx={{ mt: 1.5 }}>
          <ScenarioBuilder models={models} onCreated={reloadScenarios} />
        </Box>
      </Box>

      <Divider />

      <Box component="form" onSubmit={submitAdHoc}>
        <Typography variant="overline" color="text.secondary">
          Ad-hoc run
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <TextField
            label="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            size="small"
          />
          <TextField
            select
            label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            size="small"
            disabled={models.length === 0}
            helperText={modelsError ?? "Leave on the server default to use LLM_MODEL."}
            error={modelsError !== null}
          >
            <MenuItem value={SERVER_DEFAULT}>Server default</MenuItem>
            {models.map((info) => (
              <MenuItem key={info.id} value={info.id}>
                {info.id}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            size="small"
            multiline
            minRows={3}
            placeholder="Check that the user can log in with demo@example.com …"
          />
          <Button
            type="submit"
            variant="contained"
            startIcon={<PlayArrowIcon />}
            disabled={starting || prompt.trim() === ""}
          >
            Run prompt
          </Button>
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="overline" color="text.secondary">
          Recent runs
        </Typography>
        {runs === null && <CircularProgress size={20} sx={{ display: "block", mt: 1 }} />}
        {runs !== null && runs.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No runs yet.
          </Typography>
        )}
        <List dense disablePadding sx={{ mt: 0.5 }}>
          {runs?.map((run) => (
            <ListItemButton
              key={run.id}
              className="deferred-history-item"
              selected={run.id === selectedRunId}
              onClick={() => openRun(run.id)}
              sx={{ borderRadius: 1, alignItems: "flex-start", gap: 1 }}
            >
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap title={run.title}>
                  {run.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div" noWrap>
                  {new Date(run.startedAt).toLocaleString()}
                </Typography>
              </Box>
              <StatusChip status={run.status} />
            </ListItemButton>
          ))}
        </List>
      </Box>
    </Stack>
  );
}
