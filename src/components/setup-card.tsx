export function SetupCard() {
  return (
    <div className="page-stack">
      <section className="card auth-card">
        <div className="section-heading auth-heading">
          <div>
            <p className="eyebrow">Setup Required</p>
            <h1>Account login is now required before using the predictor.</h1>
          </div>
          <p>Add your free auth and hosting stack so the app can require email plus password and keep each user&apos;s rounds private.</p>
        </div>

        <section className="summary-grid">
          <article className="card stat-card">
            <strong>Hosting</strong>
            <p>Vercel Hobby</p>
            <small>Free Next.js hosting and the simplest deployment target for this repo.</small>
          </article>
          <article className="card stat-card">
            <strong>Auth</strong>
            <p>Supabase Auth</p>
            <small>Enable email + password accounts. Optional email confirmation can stay on for first-time verification.</small>
          </article>
          <article className="card stat-card">
            <strong>Production database</strong>
            <p>Supabase Postgres or Neon</p>
            <small>Use a hosted database for deployment so user data persists and syncs across real users.</small>
          </article>
        </section>

        <div className="card tone-panel">
          <strong>Required env vars</strong>
          <small>`NEXT_PUBLIC_SUPABASE_URL`</small>
          <small>`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`</small>
        </div>
      </section>
    </div>
  );
}
