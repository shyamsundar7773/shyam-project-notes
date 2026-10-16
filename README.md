# Shyam Project Notes

A React and TypeScript application built with Vite. The current release is the
initial workspace shell; notes, authentication, and database features are not
implemented.

## Local development

```sh
npm install
npm run dev
```

The app renders without Supabase configuration. Create the ignored root
`.env.local` yourself using `.env.example` as a template. Set the frontend
`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, plus the backend
`GEMINI_API_KEY`, `GEMINI_PRIMARY_MODEL`, `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, and `FRONTEND_ORIGIN=http://localhost:5173`.
The frontend build exposes only its two `VITE_SUPABASE_...` settings; never put
server credentials, service-role keys, or Supabase secret keys in browser
settings. The app's configuration indicator does not test or claim a live
connection.

Run the isolated backend from its directory:

```sh
cd backend
npm install
npm run build
npm test
npm start
```

The backend loads only the project-root `.env.local` for local development.
Its health endpoint is `GET /health`; note conversion is `POST
/api/notes/convert`. Conversion requires a verified Supabase bearer access
token and returns a reviewable result without saving it.

## Build and deployment

- `npm run build` runs the TypeScript project build and creates the production
  site in `dist/`.
- `npm run preview` serves the production build locally.
- `netlify.toml` configures the build command, output directory, and SPA
  fallback for Netlify.
- For a separate Render backend service, set the root directory to `backend`,
  build command to `npm ci && npm run build`, start command to
  `npm start`, and health-check path to `/health`. Configure the five backend
  environment variables in Render; do not use a Supabase service-role key.
