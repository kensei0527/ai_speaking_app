alter table public.users
  add column if not exists cefr_level varchar default 'A1',
  add column if not exists placement_status varchar default 'pending',
  add column if not exists placement_score double precision,
  add column if not exists placement_completed_at timestamp,
  add column if not exists recommended_chapter_id integer references public.chapters(id);

alter table public.scenarios
  add column if not exists lesson_intro_title varchar,
  add column if not exists lesson_intro_body text,
  add column if not exists lesson_intro_phrases text;

create table if not exists public.placement_questions (
  id serial primary key,
  cefr_level varchar not null,
  japanese_text varchar not null,
  expected_english_text varchar not null,
  grammar_point varchar not null,
  difficulty integer default 1,
  order_index integer default 0,
  created_at timestamp default now()
);

create index if not exists ix_placement_questions_id
  on public.placement_questions(id);

create index if not exists ix_placement_questions_cefr_level
  on public.placement_questions(cefr_level);

create table if not exists public.placement_sessions (
  id serial primary key,
  user_id varchar not null references public.users(id),
  status varchar default 'active',
  total_questions integer default 0,
  result_level varchar,
  score double precision,
  started_at timestamp default now(),
  completed_at timestamp
);

create index if not exists ix_placement_sessions_id
  on public.placement_sessions(id);

create table if not exists public.placement_answers (
  id serial primary key,
  session_id integer not null references public.placement_sessions(id),
  question_id integer not null references public.placement_questions(id),
  user_id varchar not null references public.users(id),
  user_answer text not null,
  is_correct boolean default false,
  score double precision default 0,
  evaluation_level varchar,
  ai_feedback text,
  created_at timestamp default now()
);

create index if not exists ix_placement_answers_id
  on public.placement_answers(id);

alter table public.placement_questions enable row level security;
alter table public.placement_sessions enable row level security;
alter table public.placement_answers enable row level security;

revoke all privileges on public.placement_questions from anon, authenticated;
revoke all privileges on public.placement_sessions from anon, authenticated;
revoke all privileges on public.placement_answers from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
