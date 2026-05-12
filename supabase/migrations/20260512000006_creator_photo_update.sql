-- upsert: true in Supabase storage requires UPDATE in addition to INSERT
CREATE POLICY "Authenticated users can update creator recipe photos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'meal-images'
    AND auth.uid() IS NOT NULL
    AND name LIKE 'creator-recipes/%'
  );
