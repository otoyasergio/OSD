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

2. Database migrations will live under `supabase/migrations` (added in a later task). When that folder exists, apply migrations with the Supabase CLI against your project.

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
