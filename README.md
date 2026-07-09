# OTOMOTO Workshop Management App

Workshop management application for OTOMOTO service operations—scheduling, jobs, and shop workflows in one place.

## Target platforms

Primary target is **Safari on Mac and iPad**. Layout and interactions should be tested on those browsers.

## Setup

1. Copy environment variables:

   ```bash
   cp .env.local.example .env.local
   ```

   Fill in your Supabase project URL and keys in `.env.local`.

2. Apply database migrations in order from `supabase/migrations/`:

   ```bash
   # Option A: Supabase CLI (after linking your project)
   npx supabase db push

   # Option B: paste each migration file into the Supabase SQL editor and run in order (001 → 006)
   ```

   After migrations, create the `intake-photos` storage bucket if not created by migration 006 (private bucket for work-order photos).

   **Authorization:** Role checks in `lib/permissions` (server actions) are the source of truth. RLS policies are defense in depth.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in Safari (or your browser) to view the app.

## Tests

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

## Build

```bash
npm run build
```

## Documentation

Project specs and plans are in [`docs/`](./docs/).
