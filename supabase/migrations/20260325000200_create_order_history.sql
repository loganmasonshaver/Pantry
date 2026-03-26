CREATE TABLE order_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  items jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE order_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own orders" ON order_history FOR ALL USING (auth.uid() = user_id);
