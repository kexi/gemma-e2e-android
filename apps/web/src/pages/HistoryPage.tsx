import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { fetchRuns, type Run } from "../api.ts";
import { StatusChip } from "../status.tsx";

export function HistoryPage() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRuns()
      .then((body) => setRuns(body.runs))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  if (error !== null) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (runs === null) {
    return <CircularProgress size={24} />;
  }

  return (
    <>
      <Typography variant="h5" gutterBottom>
        History
      </Typography>
      {runs.length === 0 && <Typography color="text.secondary">No runs yet.</Typography>}
      {runs.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Started</TableCell>
                <TableCell>Title</TableCell>
                <TableCell>Scenario</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Reason</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id} hover>
                  <TableCell>{new Date(run.startedAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Link component={RouterLink} to={`/runs/${run.id}`}>
                      {run.title}
                    </Link>
                  </TableCell>
                  <TableCell>{run.scenarioId}</TableCell>
                  <TableCell>
                    <StatusChip status={run.status} />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 360 }}>{run.verdictReason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}
