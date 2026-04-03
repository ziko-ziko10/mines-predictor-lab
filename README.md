# Mines Predictor Lab

Mines Predictor Lab is a 5x5 prediction tracker for an external mines-style game. The app does not claim to recover a hidden algorithm. Instead, it learns from the round history you log for each mine count and uses that history to rank cells by relative risk.

The app now requires an account. Users sign in with an email and password, and all rounds, logs, and analytics are scoped to the authenticated user.

## Features

- User-selectable mine count and prediction count
- Account-required sign-in with email and password
- Prediction workflow for a 5x5 board
- Win logging that records which predicted cells were actually played
- Loss logging that records the hit cell and all mine locations
- Separate datasets, logs, and analytics for each mine count and user
- Supabase Postgres + Prisma persistence for audience-ready deployment

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
```

## Logging rules

- `Won`: select the predicted cells that were actually played.
- `Lost`: select exactly the configured number of mine cells and also mark the hit cell.
- Each mine count is tracked separately.
- Each user sees only their own rounds and analytics.

## Deployment notes

For deployment, use Vercel for the app and keep both `DATABASE_URL` and `DIRECT_URL` pointed at your hosted Supabase Postgres instance.
