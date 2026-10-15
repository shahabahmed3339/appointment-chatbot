-- 0002_seed.sql
-- Sample data. The demo login is demo@acme.test / Password123!
-- Password hash below is a real bcrypt(Password123!) digest, cost 10.
-- (Generated with bcryptjs; verify with bcrypt.compare('Password123!', hash) === true.)

INSERT INTO businesses (id, name, timezone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Acme Consulting', 'UTC')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, business_id, email, password_hash, full_name, role)
VALUES
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   'demo@acme.test',
   '$2a$10$9qguPBgL91.BpWQ2BpmBs.QzwRC4zTF9ILpJzBo6vcIYXUpl.HEaK',
   'Demo User',
   'owner')
ON CONFLICT DO NOTHING;

-- Appointments spanning the status enum so the list UI has something to filter.
INSERT INTO appointments (business_id, user_id, title, notes, starts_at, ends_at, status, source)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   'Quarterly tax review',
   'Bring last quarter invoices.',
   now() + interval '2 days',
   now() + interval '2 days 1 hour',
   'confirmed',
   'chat'),
  ('11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   'Onboarding call',
   NULL,
   now() + interval '5 days',
   now() + interval '5 days 45 minutes',
   'pending',
   'form')
ON CONFLICT DO NOTHING;
