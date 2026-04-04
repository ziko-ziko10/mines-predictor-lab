# Mines Predictor Lab

Mines Predictor Lab is a 5x5 prediction tracker for an external mines-style game. The app does not claim to recover a hidden algorithm. Instead, it learns from the round history you log for each mine count and uses that history to rank cells by relative risk.

The app now requires an account. Users sign in with an email and password, and all rounds, logs, analytics, and evaluation results are scoped to the authenticated user.

## Features

- User-selectable mine count and prediction count
- Account-required sign-in with email and password
- Prediction workflow for a 5x5 board
- Win logging that records which predicted cells were actually played
- Loss logging that records the hit cell and all mine locations
- Optional full-board truth logging on wins when the external game reveals the full board
- Separate datasets, logs, and analytics for each mine count and user
- Supabase Postgres + Prisma persistence for audience-ready deployment
- Confidence gating with `CONFIDENT`, `EXPLORATORY`, and `ABSTAIN` modes
- Holdout evaluation against a frequency baseline and random baseline
- Optional verifier-ready fields for `serverSeed`, `clientSeed`, and `nonce`

## Tech stack

- Next.js App Router
- TypeScript
- Prisma
- PostgreSQL
- Supabase Auth for email/password login

## Recommended free services

- Hosting: Vercel Hobby
- Account auth: Supabase Auth Free
- Production database: Supabase Postgres Free or Neon Free

If you want first-time email confirmation before password login, keep Supabase email confirmation enabled for sign-up.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Generate Prisma client:

```bash
npm run db:generate
```

3. Create or update the database schema:

```bash
npm run db:push
```

4. Start the app:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Environment

The app expects a managed PostgreSQL database plus Supabase Auth keys:

```env
DATABASE_URL="postgresql://postgres.your-project-ref:YOUR_PASSWORD@aws-1-your-region.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.your-project-ref:YOUR_PASSWORD@aws-1-your-region.pooler.supabase.com:5432/postgres"
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="your-supabase-publishable-key"
ADMIN_EMAILS="admin1@example.com,admin2@example.com"
```

## Logging rules

- `Won`: select the predicted cells that were actually played.
- `Won` with full truth available: optionally log the full mine layout too.
- `Lost`: select exactly the configured number of mine cells and also mark the hit cell.
- Each mine count is tracked separately.
- Each user sees only their own rounds and analytics.

## Model realism upgrades

- The live predictor can now return `CONFIDENT`, `EXPLORATORY`, or `ABSTAIN` instead of always pretending certainty.
- Full-board truth coverage is tracked per mine count so you can see how much of the dataset is actually testable.
- The evaluation page runs a chronological holdout backtest on truth-known rounds.
- The current model is compared against:
  - a frequency-only baseline
  - a random baseline
- Confidence intervals are shown for mine-rate estimates and holdout safe-rate metrics.

## Deployment notes

For deployment, use Vercel for the app and keep both `DATABASE_URL` and `DIRECT_URL` pointed at your hosted Supabase Postgres instance.

## Admin logs

- Add your admin email address to `ADMIN_EMAILS`
- Sign in with that same email
- Open `/admin/logs` to view the global log archive across all users
