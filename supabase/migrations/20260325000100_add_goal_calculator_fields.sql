-- Add fields for the smart goal calculator
alter table profiles add column if not exists age int4;
alter table profiles add column if not exists gender text;
alter table profiles add column if not exists activity_level text;
alter table profiles add column if not exists fitness_goal text;
