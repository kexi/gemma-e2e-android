import { type FormEvent, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { collectTags, describeTarget, filterByTags } from "@gemma-e2e/core/schema";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
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
  createRunBatch,
  fetchModels,
  fetchRuns,
  fetchScenarios,
  type CreateRunRequest,
  type ModelInfo,
  PartialBatchError,
  type Run,
  type Scenario,
} from "./api.ts";
import {
  remainingAfterPartialBatch,
  retainAfterReload,
  toggleInList,
  toggleInSet,
} from "./scenarioSelection.ts";
import { ScenarioBuilder } from "./ScenarioBuilder.tsx";
import { ScenarioDelete } from "./ScenarioDelete.tsx";
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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<Set<string>>(new Set());
  const scenarioRequestRef = useRef(0);

  // Also called after the builder writes a file, so a scenario created or
  // edited here is runnable without a page reload.
  function reloadScenarios() {
    scenarioRequestRef.current += 1;
    const request = scenarioRequestRef.current;
    fetchScenarios()
      .then((body) => {
        // Two saves can refetch out of order; the earlier response must not
        // restore a version that the later save has already replaced.
        const isStale = request !== scenarioRequestRef.current;
        if (isStale) {
          return;
        }
        setScenarios(body.scenarios);
        // Narrowed against what the rail is SHOWING, not against everything on
        // disk: the active tag filter is part of the answer, or a scenario the
        // chips are hiding keeps its tick and "Run N selected" starts a run the
        // user cannot see they asked for.
        //
        // It also covers the reason this refetches at all: a scenario edited so
        // its tags no longer match, or deleted outright, leaves behind a tick
        // that a batch could only get a 404 for.
        setSelectedScenarioIds((current) =>
          retainAfterReload(current, body.scenarios, selectedTags),
        );
      })
      .catch((cause: unknown) => {
        const isLatest = request === scenarioRequestRef.current;
        if (isLatest) {
          setError(message(cause));
        }
      });
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

  // Without this the status chips freeze at whatever the last fetch saw, so a
  // run started here (or from another tab) stays "running" forever.
  useEffect(() => {
    const source = new EventSource("/api/events");

    // The payload is ignored on purpose: the event only says the history moved,
    // and refetching the list keeps one shape of truth instead of patching a
    // row from an event and hoping it matches what /api/runs would have said.
    const reload = () => {
      fetchRuns()
        .then((body) => setRuns(body.runs))
        // Why not surface this: EventSource reconnects on its own, and a blip
        // must not replace the history that is already on screen with an alert.
        .catch(() => {});
    };

    // Every frame the server sends carries an `event:` name, so the default
    // "message" listener never fires; each name is registered explicitly.
    //
    // `run_queued` is registered alongside the other two because a run becomes
    // history the moment it is accepted, not when a device frees up: a batch
    // posted in another tab would otherwise trickle into this one run by run as
    // each reached the front of the queue, and the wait it is queued behind --
    // the thing this rail exists to show -- would never appear at all.
    source.addEventListener("run_queued", reload);
    source.addEventListener("run_started", reload);
    source.addEventListener("run_finished", reload);

    return () => source.close();
  }, []);

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

  // Derived rather than held in state: two sources of the same list drift the
  // moment a scenario is created, edited or deleted, and this rail refetches
  // after all three.
  const allScenarios = scenarios ?? [];
  const availableTags = collectTags(allScenarios);
  const visibleScenarios = filterByTags(allScenarios, selectedTags);
  const selectedCount = visibleScenarios.filter((one) => selectedScenarioIds.has(one.id)).length;
  const hasScenarios = scenarios !== null && scenarios.length > 0;
  const isFilteredEmpty = hasScenarios && visibleScenarios.length === 0;

  /**
   * Toggles a tag and narrows the tick boxes to what the new filter shows.
   *
   * The intersection happens here rather than in an effect on `selectedTags`
   * because an effect would let one render pass through with the stale
   * selection, and that render is exactly the one whose "Run N selected"
   * button could be pressed.
   */
  function toggleTag(tag: string) {
    const nextTags = toggleInList(selectedTags, tag);
    setSelectedTags(nextTags);
    setSelectedScenarioIds((current) => retainAfterReload(current, scenarios ?? [], nextTags));
  }

  function clearTags() {
    setSelectedTags([]);
  }

  async function startSelected() {
    // Ordered by the list rather than by the Set, so the runs queue in the
    // order the rail shows them; a Set preserves insertion order, which is the
    // order the user happened to tick in.
    const ids = visibleScenarios
      .filter((one) => selectedScenarioIds.has(one.id))
      .map((one) => one.id);
    const isEmpty = ids.length === 0;
    if (isEmpty) {
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const { runIds } = await createRunBatch(ids);
      setSelectedScenarioIds(new Set());
      // The first run is the one already on a device; the rest are queued
      // behind it, and their pages say so. Landing on the first is the only
      // choice that shows work rather than a wait.
      const first = runIds[0];
      if (first !== undefined) {
        navigate(`/runs/${first}`, "forward");
        onNavigate?.();
      }
    } catch (cause) {
      // A partly accepted batch is not a batch that did nothing: the leading
      // runs are queued and will produce verdicts. Untick exactly those, so the
      // obvious retry -- press the button again -- covers the remainder instead
      // of running the accepted scenarios a second time.
      const isPartial = cause instanceof PartialBatchError;
      if (isPartial) {
        setSelectedScenarioIds(remainingAfterPartialBatch(ids, cause.acceptedRunIds.length));
      }
      setError(message(cause));
    } finally {
      setStarting(false);
    }
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

        {availableTags.length > 0 && (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ mt: 1, flexWrap: "wrap", rowGap: 0.5 }}
            role="group"
            aria-label="Filter scenarios by tag"
          >
            {availableTags.map((tag) => {
              const isSelected = selectedTags.includes(tag);
              return (
                <Chip
                  key={tag}
                  size="small"
                  label={tag}
                  onClick={() => toggleTag(tag)}
                  // Filled versus outlined carries the state as a shape as well
                  // as a colour, and `aria-pressed` carries it to a reader that
                  // sees neither. A chip that only changed colour would be
                  // invisible to both.
                  variant={isSelected ? "filled" : "outlined"}
                  color={isSelected ? "primary" : "default"}
                  aria-pressed={isSelected}
                />
              );
            })}
          </Stack>
        )}

        {isFilteredEmpty && (
          <Box sx={{ mt: 1 }}>
            {/* Distinct from "No scenarios in scenarios/." above: that one says
                there is nothing to run, this one says the filter is hiding it,
                and only this one is undoable. */}
            <Typography variant="body2" color="text.secondary">
              No scenarios match these tags.
            </Typography>
            <Button size="small" onClick={clearTags} sx={{ mt: 0.5, ml: -1 }}>
              Clear tag filter
            </Button>
          </Box>
        )}

        <Stack spacing={1} sx={{ mt: 1 }}>
          {visibleScenarios.map((scenario) => (
            <Paper key={scenario.id} variant="outlined" sx={{ p: 1.25 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
                {/* The visible label is the card's title, which belongs to no
                    control, so the checkbox carries the scenario's name itself
                    -- otherwise every row announces as an unnamed "checkbox".

                    Why not the `inputProps` shorthand this used to take: MUI
                    dropped it, and the label has to reach the native <input>
                    rather than the styled span around it, so it goes through
                    the root slot's own `input` slot. Nesting is the API, not an
                    accident. */}
                <Checkbox
                  size="small"
                  sx={{ p: 0.5 }}
                  checked={selectedScenarioIds.has(scenario.id)}
                  onChange={() =>
                    setSelectedScenarioIds((current) => toggleInSet(current, scenario.id))
                  }
                  slotProps={{
                    root: {
                      slotProps: {
                        input: { "aria-label": `Select ${scenario.title} for a batch run` },
                      },
                    },
                  }}
                />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" noWrap title={scenario.title}>
                    {scenario.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {scenario.cases.length} case{scenario.cases.length === 1 ? "" : "s"}
                    {scenario.target !== undefined && ` · ${describeTarget(scenario.target)}`}
                    {scenario.model !== undefined && ` · ${scenario.model}`}
                  </Typography>
                  {scenario.tags.length > 0 && (
                    <Stack
                      direction="row"
                      spacing={0.5}
                      sx={{ mt: 0.5, flexWrap: "wrap", rowGap: 0.5 }}
                    >
                      {scenario.tags.map((tag) => (
                        <Chip key={tag} size="small" variant="outlined" label={tag} />
                      ))}
                    </Stack>
                  )}
                </Box>
                <ScenarioBuilder models={models} scenario={scenario} onSaved={reloadScenarios} />
                <ScenarioDelete scenario={scenario} onDeleted={reloadScenarios} />
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

        {selectedCount > 0 && (
          <Button
            fullWidth
            variant="contained"
            size="small"
            startIcon={<PlayArrowIcon />}
            disabled={starting}
            onClick={() => void startSelected()}
            sx={{ mt: 1.5 }}
          >
            Run {selectedCount} selected
          </Button>
        )}

        <Box sx={{ mt: 1.5 }}>
          <ScenarioBuilder models={models} onSaved={reloadScenarios} />
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
