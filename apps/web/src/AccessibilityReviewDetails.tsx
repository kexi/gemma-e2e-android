import type { AccessibilityReview } from "@gemma-e2e/core/schema";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { screenshotUrl } from "./api.ts";

const categoryLabels = {
  color_only: "Color alone",
  contrast: "Contrast",
  text_size: "Text legibility",
  visual_clutter: "Visual clutter",
  other: "Other",
};

export function AccessibilityReviewDetails({
  review,
}: {
  review: AccessibilityReview | null | undefined;
}) {
  const isUnreviewed = review === undefined || review === null;
  if (isUnreviewed) {
    return (
      <Typography component="p" variant="caption" color="text.secondary" sx={{ mt: 1 }}>
        Visual accessibility: not reviewed.
      </Typography>
    );
  }

  const summary =
    review.status === "error"
      ? "review error"
      : `review completed · ${review.reviews.reduce((total, result) => total + result.findings.length, 0)} potential issues · ${review.reviews.length} personas`;

  return (
    <Box component="details" sx={{ mt: 1 }}>
      <Box component="summary" sx={{ cursor: "pointer" }}>
        Visual accessibility · {summary}
      </Box>
      <Stack spacing={1} sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Model: {review.model}. Suggestions from a screenshot; no conformance guarantee. Screen
          reader behavior is not evaluated.
        </Typography>
        {review.screenshotPath !== null && (
          <Link href={screenshotUrl(review.screenshotPath)} target="_blank" rel="noreferrer">
            Open reviewed screenshot (before action)
          </Link>
        )}
        {review.status === "error" ? (
          <Alert severity="warning">Review could not be completed: {review.error}</Alert>
        ) : (
          review.reviews.map((result) => {
            const persona = review.personas.find((item) => item.id === result.personaId);
            return (
              <Box key={result.personaId}>
                <Typography variant="subtitle2">{persona?.label ?? result.personaId}</Typography>
                {persona !== undefined && (
                  <Typography variant="body2" color="text.secondary">
                    {persona.description}
                  </Typography>
                )}
                {result.findings.length === 0 ? (
                  <Typography variant="body2">
                    No potential issues identified. This does not establish accessibility.
                  </Typography>
                ) : (
                  <Box component="ul" sx={{ pl: 3, my: 1 }}>
                    {result.findings.map((finding, index) => (
                      <Box component="li" key={index} sx={{ mb: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {categoryLabels[finding.category]} · {finding.location}
                        </Typography>
                        <Typography variant="body2">{finding.reason}</Typography>
                        <Typography variant="body2">Suggestion: {finding.suggestion}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            );
          })
        )}
      </Stack>
    </Box>
  );
}
