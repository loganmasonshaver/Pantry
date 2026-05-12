-- Allow authenticated users to upload to the creator-recipes/ prefix in meal-images
-- Edge functions use service role (bypasses RLS), but client-side creator uploads use the user JWT
CREATE POLICY "Authenticated users can upload creator recipe photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'meal-images'
    AND auth.uid() IS NOT NULL
    AND name LIKE 'creator-recipes/%'
  );
