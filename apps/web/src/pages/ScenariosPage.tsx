import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import {
  createRun,
  fetchModels,
  fetchScenarios,
  type CreateRunRequest,
  type ModelInfo,
  type Scenario,
} from "../api.ts";

/** Sentinel for "let the server decide", which is not a model id. */
const SERVER_DEFAULT = "";

export function ScenariosPage() {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [model, setModel] = useState(SERVER_DEFAULT);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetchScenarios()
      .then((body) => setScenarios(body.scenarios))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));

    // A model server that is down must not block running a committed scenario,
    // so this failure is reported beside the dropdown rather than as a page
    // error.
    fetchModels()
      .then((body) => setModels(body.models))
      .catch((cause: unknown) =>
        setModelsError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, []);

  async function start(body: CreateRunRequest) {
    setStarting(true);
    setError(null);
    try {
      const { runId } = await createRun(body);
      await navigate(`/runs/${runId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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

  return (
    <Stack spacing={4}>
      {error !== null && <Alert severity="error">{error}</Alert>}

      <Box>
        <Typography variant="h5" gutterBottom>
          Scenarios
        </Typography>
        {scenarios === null && <CircularProgress size={24} />}
        {scenarios !== null && scenarios.length === 0 && (
          <Typography color="text.secondary">No scenarios in scenarios/.</Typography>
        )}
        <Stack spacing={2}>
          {scenarios?.map((scenario) => (
            <Card key={scenario.id} variant="outlined">
              <CardContent>
                <Typography variant="h6">{scenario.title}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {scenario.id} · {scenario.cases.length} case
                  {scenario.cases.length === 1 ? "" : "s"}
                  {scenario.app !== undefined && ` · ${scenario.app.package}`}
                  {scenario.model !== undefined && ` · ${scenario.model}`}
                </Typography>

                <Divider sx={{ my: 1.5 }} />

                <Stack spacing={1}>
                  {scenario.cases.map((testCase) => (
                    <Stack
                      key={testCase.id}
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: "baseline", flexWrap: "wrap" }}
                    >
                      <Typography variant="body2">{testCase.title ?? testCase.id}</Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={testCase.model ?? scenario.model ?? "default model"}
                      />
                      <Typography variant="caption" color="text.secondary">
                        max {testCase.maxSteps} steps
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </CardContent>
              <CardActions>
                <Button
                  startIcon={<PlayArrowIcon />}
                  disabled={starting}
                  onClick={() => void start({ scenarioId: scenario.id })}
                >
                  Run
                </Button>
              </CardActions>
            </Card>
          ))}
        </Stack>
      </Box>

      <Box component="form" onSubmit={submitAdHoc}>
        <Typography variant="h5" gutterBottom>
          Ad-hoc run
        </Typography>
        <Stack spacing={2}>
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
            multiline
            minRows={3}
            placeholder="Check that the user can log in with demo@example.com …"
          />
          <Box>
            <Button
              type="submit"
              variant="contained"
              startIcon={<PlayArrowIcon />}
              disabled={starting || prompt.trim() === ""}
            >
              Run prompt
            </Button>
          </Box>
        </Stack>
      </Box>
    </Stack>
  );
}
