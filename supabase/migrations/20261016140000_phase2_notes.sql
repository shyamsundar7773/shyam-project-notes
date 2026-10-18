create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  file_id uuid not null,
  note_type text not null check (note_type in ('text', 'sql', 'markdown')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  source_content text not null default '',
  sql_output text,
  sql_evaluation text,
  sql_evaluated_source text,
  markdown_output text,
  markdown_converted_source text,
  personal_notes text not null default '',
  note_color text not null default 'lavender'
    check (note_color in ('lavender', 'mint', 'peach', 'blue', 'yellow')),
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_file_owner_fkey
    foreign key (file_id, owner_id)
    references public.files (id, owner_id)
    on delete restrict
);

create index notes_file_updated_idx
  on public.notes (file_id, updated_at desc);
create index notes_owner_file_idx
  on public.notes (owner_id, file_id);

create function public.set_note_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_note_updated_at();

revoke all on public.notes from public, anon;
grant select, insert, update, delete on public.notes to authenticated;

alter table public.notes enable row level security;

create policy "Owners can read notes"
  on public.notes for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners can create notes"
  on public.notes for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "Owners can update notes"
  on public.notes for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
create policy "Owners can delete notes"
  on public.notes for delete to authenticated
  using (owner_id = (select auth.uid()));
