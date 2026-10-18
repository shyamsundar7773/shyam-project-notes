create table public.categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  constraint categories_id_owner_unique unique (id, owner_id)
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  constraint topics_category_owner_fkey
    foreign key (category_id, owner_id)
    references public.categories (id, owner_id)
    on delete cascade,
  constraint topics_id_category_owner_unique unique (id, category_id, owner_id)
);

create table public.subtopics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null,
  topic_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  constraint subtopics_topic_category_owner_fkey
    foreign key (topic_id, category_id, owner_id)
    references public.topics (id, category_id, owner_id)
    on delete cascade,
  constraint subtopics_id_path_owner_unique
    unique (id, topic_id, category_id, owner_id)
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null,
  topic_id uuid not null,
  subtopic_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint files_id_owner_unique unique (id, owner_id),
  constraint files_subtopic_path_owner_fkey
    foreign key (subtopic_id, topic_id, category_id, owner_id)
    references public.subtopics (id, topic_id, category_id, owner_id)
    on delete restrict
);

create index topics_category_owner_idx
  on public.topics (category_id, owner_id);
create index subtopics_topic_path_owner_idx
  on public.subtopics (topic_id, category_id, owner_id);
create index files_owner_created_idx
  on public.files (owner_id, created_at desc);
create index files_subtopic_path_owner_idx
  on public.files (subtopic_id, topic_id, category_id, owner_id);

revoke all on public.categories, public.topics, public.subtopics, public.files
  from public, anon;
grant select, insert, update, delete
  on public.categories, public.topics, public.subtopics, public.files
  to authenticated;

alter table public.categories enable row level security;
alter table public.topics enable row level security;
alter table public.subtopics enable row level security;
alter table public.files enable row level security;

create policy "Owners can read categories"
  on public.categories for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners can create categories"
  on public.categories for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Owners can update categories"
  on public.categories for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Owners can delete categories"
  on public.categories for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners can read topics"
  on public.topics for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners can create topics"
  on public.topics for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Owners can update topics"
  on public.topics for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Owners can delete topics"
  on public.topics for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners can read subtopics"
  on public.subtopics for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners can create subtopics"
  on public.subtopics for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Owners can update subtopics"
  on public.subtopics for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Owners can delete subtopics"
  on public.subtopics for delete to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owners can read files"
  on public.files for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners can create files"
  on public.files for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Owners can update files"
  on public.files for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Owners can delete files"
  on public.files for delete to authenticated
  using (owner_id = (select auth.uid()));
