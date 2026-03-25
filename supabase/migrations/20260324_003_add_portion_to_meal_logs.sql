-- Store FatSecret food reference and quantity for portion editing
alter table meal_logs
  add column if not exists food_id text default null,
  add column if not exists serving_id text default null,
  add column if not exists quantity float4 default 1;
