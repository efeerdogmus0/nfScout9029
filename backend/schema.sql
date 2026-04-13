CREATE TYPE hub_state AS ENUM ('active', 'inactive');
CREATE TYPE tower_level AS ENUM ('none', 'level_1', 'level_2', 'level_3');

CREATE TABLE IF NOT EXISTS match_scout_reports (
  id BIGSERIAL PRIMARY KEY,
  event_key VARCHAR(32) NOT NULL,
  match_key VARCHAR(32) NOT NULL,
  team_key VARCHAR(16) NOT NULL,
  scout_device_id VARCHAR(64) NOT NULL,
  auto_path_points JSONB NOT NULL DEFAULT '[]'::jsonb,
  auto_fuel_scored INTEGER NOT NULL DEFAULT 0,
  teleop_fuel_scored_active INTEGER NOT NULL DEFAULT 0,
  teleop_fuel_scored_inactive INTEGER NOT NULL DEFAULT 0,
  bump_slow_or_stuck BOOLEAN NOT NULL DEFAULT FALSE,
  trench_slow_or_stuck BOOLEAN NOT NULL DEFAULT FALSE,
  tower_level tower_level NOT NULL DEFAULT 'none',
  teleop_shoot_timestamps_ms JSONB NOT NULL DEFAULT '[]'::jsonb,
  location_pings JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_reports_event ON match_scout_reports(event_key);
CREATE INDEX IF NOT EXISTS idx_reports_match ON match_scout_reports(match_key);
CREATE INDEX IF NOT EXISTS idx_reports_team ON match_scout_reports(team_key);
