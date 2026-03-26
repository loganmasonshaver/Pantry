-- Add target weight goal to profiles table
alter table profiles
  add column if not exists target_weight_kg float4 default null;
