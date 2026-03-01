Backend `.env` requires:
- `PORT`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Frontend `.env` requires:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL`

Supabase Auth redirect configuration:
- In Supabase Dashboard -> Authentication -> URL Configuration, add `http://localhost:5173` to Redirect URLs.
- Also add `http://localhost:5173/dashboard` to Redirect URLs.
