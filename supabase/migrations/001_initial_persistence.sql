create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists sahayakai_on_auth_user_created on auth.users;
create trigger sahayakai_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  background text,
  support_goals text[] not null default '{}',
  preferences jsonb not null default '{}'::jsonb,
  memory_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Support conversation',
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 12000),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, user_id)
    references public.conversations(id, user_id) on delete cascade
);

create table if not exists public.daily_assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  assessed_at timestamptz not null default now(),
  concern_category text,
  stress_score integer check (stress_score between 0 and 50),
  screening_band text,
  mood_score integer check (mood_score between 0 and 100),
  assessment_type text not null,
  scale_definition text not null,
  user_reported_observations text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.user_concerns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  concern_category text not null,
  initial_description text not null default '',
  current_status text not null default 'Active'
    check (current_status in ('Active', 'Improving', 'Worsening', 'Stable', 'Resolved', 'Insufficient data')),
  first_reported_at timestamptz not null default now(),
  last_updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, concern_category)
);

create table if not exists public.progress_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  concern_id uuid,
  previous_assessment_id uuid,
  current_assessment_id uuid,
  score_difference integer,
  trend text not null check (trend in ('Improving', 'Worsening', 'Stable', 'Fluctuating', 'Insufficient data')),
  supporting_evidence text[] not null default '{}',
  user_feedback text check (user_feedback in ('Accurate', 'Not accurate')),
  user_feedback_at timestamptz,
  compared_at timestamptz not null default now(),
  foreign key (concern_id, user_id)
    references public.user_concerns(id, user_id) on delete cascade,
  foreign key (previous_assessment_id, user_id)
    references public.daily_assessments(id, user_id) on delete cascade,
  foreign key (current_assessment_id, user_id)
    references public.daily_assessments(id, user_id) on delete cascade
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  concern_id uuid,
  recommendation_text text not null,
  recommendation_category text not null default 'General support',
  recommended_at timestamptz not null default now(),
  user_feedback text check (user_feedback in ('Helpful', 'Not helpful', 'Not tried')),
  completion_status text not null default 'Not tried'
    check (completion_status in ('Not tried', 'In progress', 'Completed')),
  foreign key (concern_id, user_id)
    references public.user_concerns(id, user_id) on delete cascade
);

create table if not exists public.memory_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary_text text not null default '',
  confirmed_facts text[] not null default '{}',
  historical_observations text[] not null default '{}',
  ai_hypotheses text[] not null default '{}',
  relevant_concerns text[] not null default '{}',
  source_message_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists conversations_user_updated_idx
  on public.conversations(user_id, updated_at desc);
create index if not exists messages_user_created_idx
  on public.messages(user_id, created_at desc);
create index if not exists messages_conversation_created_idx
  on public.messages(conversation_id, created_at asc);
create index if not exists assessments_user_date_idx
  on public.daily_assessments(user_id, assessed_at desc);
create index if not exists concerns_user_status_idx
  on public.user_concerns(user_id, current_status);
create index if not exists progress_user_date_idx
  on public.progress_history(user_id, compared_at desc);
create index if not exists recommendations_user_date_idx
  on public.recommendations(user_id, recommended_at desc);

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at before update on public.user_profiles
for each row execute function public.set_updated_at();

drop trigger if exists conversations_updated_at on public.conversations;
create trigger conversations_updated_at before update on public.conversations
for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.daily_assessments enable row level security;
alter table public.user_concerns enable row level security;
alter table public.progress_history enable row level security;
alter table public.recommendations enable row level security;
alter table public.memory_summaries enable row level security;

create policy "Users manage their own profile"
  on public.user_profiles for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users manage their own conversations"
  on public.conversations for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid()) and p.memory_consent
  ));
create policy "Users manage their own messages"
  on public.messages for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid()) and p.memory_consent
  ));
create policy "Users manage their own assessments"
  on public.daily_assessments for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid()) and p.memory_consent
  ));
create policy "Users manage their own concerns"
  on public.user_concerns for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid()) and p.memory_consent
  ));
create policy "Users manage their own progress"
  on public.progress_history for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid()) and p.memory_consent
  ));
create policy "Users manage their own recommendations"
  on public.recommendations for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid()) and p.memory_consent
  ));
create policy "Users manage their own memory summaries"
  on public.memory_summaries for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.user_profiles p
    where p.user_id = (select auth.uid()) and p.memory_consent
  ));

grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.user_profiles, public.conversations, public.messages,
     public.daily_assessments, public.user_concerns, public.progress_history,
     public.recommendations, public.memory_summaries
  to authenticated;
