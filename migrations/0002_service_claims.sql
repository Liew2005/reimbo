CREATE TABLE odometer_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL REFERENCES cars(id),
  date TEXT NOT NULL,
  km INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_odo_car ON odometer_readings(car_id, date);

CREATE TABLE service_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL REFERENCES cars(id),
  name TEXT NOT NULL,
  interval_km INTEGER,
  interval_months INTEGER,
  last_done_date TEXT,
  last_done_km INTEGER,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reminders_car ON service_reminders(car_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE claims ADD COLUMN car_id INTEGER REFERENCES cars(id);
