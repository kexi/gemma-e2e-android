import type { PersonaReview } from "@gemma-e2e/core/schema";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { screenshotUrl } from "./api.ts";
import { useI18n } from "./I18nProvider.tsx";

export function PersonaReviewDetails({ review }: { review: PersonaReview | null | undefined }) {
  const { t } = useI18n();
  const isUnreviewed = review === undefined || review === null;
  if (isUnreviewed) {
    return (
      <Typography component="p" variant="caption" color="text.secondary" sx={{ mt: 1 }}>
        {t.review.notReviewed}
      </Typography>
    );
  }

  const summary =
    review.status === "error"
      ? t.review.failed
      : t.review.completed(
          review.reviews.reduce((total, result) => total + result.findings.length, 0),
          review.reviews.length,
        );

  return (
    <Box component="details" sx={{ mt: 1 }}>
      <Box component="summary" sx={{ cursor: "pointer" }}>
        {t.review.heading} · {summary}
      </Box>
      <Stack spacing={1} sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t.review.disclaimer(review.model)}
        </Typography>
        {review.screenshotPath !== null && (
          <Link href={screenshotUrl(review.screenshotPath)} target="_blank" rel="noreferrer">
            {t.review.openScreenshot}
          </Link>
        )}
        {review.status === "error" ? (
          <Alert severity="warning">{t.review.couldNotComplete(review.error)}</Alert>
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
                  <Typography variant="body2">{t.review.noIssues}</Typography>
                ) : (
                  <Box component="ul" sx={{ pl: 3, my: 1 }}>
                    {result.findings.map((finding, index) => (
                      <Box component="li" key={index} sx={{ mb: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {t.review.category[finding.category]} · {finding.location}
                        </Typography>
                        <Typography variant="body2">{finding.reason}</Typography>
                        <Typography variant="body2">
                          {t.review.suggestion(finding.suggestion)}
                        </Typography>
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
