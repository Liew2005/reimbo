CREATE TABLE cars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  plate TEXT,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- claimable = 1: counts toward "reimburse me". claimable = 0: still goes in the report, marked paid by company.
CREATE TABLE payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  claimable INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_no TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | submitted | reimbursed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  reimbursed_at TEXT
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  car_id INTEGER NOT NULL REFERENCES cars(id),
  payment_method_id INTEGER NOT NULL REFERENCES payment_methods(id),
  date TEXT NOT NULL,                    -- YYYY-MM-DD
  amount_cents INTEGER NOT NULL,         -- MYR sen
  category TEXT NOT NULL,
  vendor TEXT,
  odometer_km INTEGER,
  note TEXT,
  claim_id INTEGER REFERENCES claims(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expenses_car_date ON expenses(car_id, date);
CREATE INDEX idx_expenses_claim ON expenses(claim_id);

CREATE TABLE receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_receipts_expense ON receipts(expense_id);

INSERT INTO payment_methods (name, claimable) VALUES ('Own pocket', 1), ('Company card', 0);
