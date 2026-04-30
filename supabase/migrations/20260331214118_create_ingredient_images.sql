-- Ingredient image library: pre-generated thumbnails for common ingredients
CREATE TABLE ingredient_images (
  name TEXT PRIMARY KEY,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Public read access, no RLS needed (static library)
ALTER TABLE ingredient_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read ingredient images" ON ingredient_images FOR SELECT USING (true);

-- Storage bucket for ingredient images
INSERT INTO storage.buckets (id, name, public) VALUES ('ingredient-images', 'ingredient-images', true)
ON CONFLICT DO NOTHING;

-- Public read policy for the bucket
CREATE POLICY "Public read ingredient images" ON storage.objects FOR SELECT USING (bucket_id = 'ingredient-images');
CREATE POLICY "Service role insert ingredient images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'ingredient-images');
