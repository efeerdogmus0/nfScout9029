-- Run with: psql "$DATABASE_URL" -f backend/scripts/jsonb_merge_test.sql

DROP TABLE IF EXISTS scout_uploads;
CREATE TABLE scout_uploads (
  id SERIAL PRIMARY KEY,
  match_key TEXT NOT NULL,
  team_key TEXT NOT NULL,
  device_id TEXT NOT NULL,
  payload JSONB NOT NULL
);

INSERT INTO scout_uploads (match_key, team_key, device_id, payload)
VALUES
  ('2026miket_qm1', 'frc1234', 'device-1', '{"teleop":{"shots":[5000,10000]},"terrain":{"bump":true}}'),
  ('2026miket_qm1', 'frc1234', 'device-2', '{"teleop":{"shots":[7000,13000]},"terrain":{"trench":true}}'),
  ('2026miket_qm1', 'frc1234', 'device-3', '{"tower":{"level":"level_2"}}'),
  ('2026miket_qm1', 'frc1234', 'device-4', '{"notes":"fast cycle"}'),
  ('2026miket_qm1', 'frc1234', 'device-5', '{"teleop":{"shots":[16000]}}'),
  ('2026miket_qm1', 'frc1234', 'device-6', '{"auto":{"fuel":3}}');

SELECT
  match_key,
  team_key,
  jsonb_agg(payload) AS all_payloads,
  jsonb_object_agg(device_id, payload) AS by_device
FROM scout_uploads
GROUP BY match_key, team_key;
