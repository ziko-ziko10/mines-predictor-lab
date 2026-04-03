import { AuthPanel } from "@/components/auth-panel";
import { PredictionStudio } from "@/components/prediction-studio";
import { SetupCard } from "@/components/setup-card";
import { getAuthState } from "@/lib/auth";
import { getMineCountSummaries } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const auth = await getAuthState();

  if (!auth.configured) {
    return <SetupCard />;
  }

  if (!auth.user) {
    return (
      <AuthPanel
        title="Sign in with your email and password to open the predictor."
        description="Your rounds, losses, heatmaps, and safe-cell rankings stay private to your own account from the first login onward."
      />
    );
  }

  const summaries = await getMineCountSummaries(auth.user.id);

  return <PredictionStudio summaries={summaries} />;
}
