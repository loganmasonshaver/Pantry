CREATE TABLE image_cache (
  meal_key text PRIMARY KEY,
  image_url text NOT NULL,
  created_at timestamptz DEFAULT now()
);
-- No RLS needed — Edge Functions use the service role key
