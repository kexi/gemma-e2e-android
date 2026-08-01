import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardActions from "@mui/material/CardActions";
import CardContent from "@mui/material/CardContent";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { createRun, fetchScenarios, type Scenario } from "../api.ts";

export function ScenariosPage() {
  const navigate = useNavigate();
  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    fetchScenarios()
      .then((body) => setScenarios(body.scenarios))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  async function start(body: { scenarioId?: string; prompt?: string; title?: string }) {
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
    void start({ prompt: trimmed, ...(title.trim() === "" ? {} : { title: title.trim() }) });
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
                  {scenario.id} · max {scenario.maxSteps} steps
                  {scenario.app !== undefined && ` · ${scenario.app.package}`}
                </Typography>
                <Typography sx={{ mt: 1 }}>{scenario.prompt}</Typography>
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
