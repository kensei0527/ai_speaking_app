-- Lock down browser/API access to application tables.
--
-- The app currently reads and writes application data through the FastAPI
-- backend using DATABASE_URL. The Next.js frontend only uses Supabase for Auth,
-- so anon/authenticated roles should not have direct table access through
-- Supabase's generated API.
--
-- This keeps the backend working because the current backend connection uses
-- the postgres owner role. It deliberately creates no RLS policies; direct
-- Supabase API access should be closed until the app intentionally adopts it.

begin;

alter table public.users enable row level security;
alter table public.chapters enable row level security;
alter table public.user_chapter_progress enable row level security;
alter table public.scenarios enable row level security;
alter table public.user_scenario_progress enable row level security;
alter table public.questions enable row level security;
alter table public.lessons enable row level security;
alter table public.attempts enable row level security;
alter table public.lesson_questions enable row level security;

revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on schema public from anon, authenticated;

alter default privileges in schema public
  revoke all privileges on tables from anon, authenticated;

alter default privileges in schema public
  revoke all privileges on sequences from anon, authenticated;

commit;
