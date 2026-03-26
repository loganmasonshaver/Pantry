-- User-specific macro corrections for scanned/searched foods
create table if not exists macro_overrides (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  food_key    text not null,       -- barcode or fatsecret food_id, e.g. "barcode:012345678901"
  food_name   text not null,
  calories    int4 not null,
  protein     float4 not null,
  carbs       float4 not null,
  fat         float4 not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, food_key)
);

-- RLS
alter table macro_overrides enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'Users can read their own overrides' and tablename = 'macro_overrides') then
    create policy "Users can read their own overrides" on macro_overrides for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can insert their own overrides' and tablename = 'macro_overrides') then
    create policy "Users can insert their own overrides" on macro_overrides for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can update their own overrides' and tablename = 'macro_overrides') then
    create policy "Users can update their own overrides" on macro_overrides for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'Users can delete their own overrides' and tablename = 'macro_overrides') then
    create policy "Users can delete their own overrides" on macro_overrides for delete using (auth.uid() = user_id);
  end if;
end $$;

-- Auto-update updated_at
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists macro_overrides_updated_at on macro_overrides;
create trigger macro_overrides_updated_at
  before update on macro_overrides
  for each row execute function update_updated_at_column();
