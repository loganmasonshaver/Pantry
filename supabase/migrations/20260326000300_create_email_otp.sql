CREATE TABLE email_otp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE email_otp ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own OTP" ON email_otp FOR ALL USING (auth.uid() = user_id);

-- Clean up expired OTPs automatically
CREATE INDEX idx_email_otp_expires ON email_otp (expires_at);
