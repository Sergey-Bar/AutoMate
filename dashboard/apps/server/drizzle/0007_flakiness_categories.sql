-- Phase 1A: flakiness classification columns
ALTER TABLE quarantine ADD COLUMN flakiness_category TEXT;
ALTER TABLE quarantine ADD COLUMN category_confidence REAL;
ALTER TABLE quarantine ADD COLUMN category_evidence TEXT;

-- Phase 1B: resolution tracking columns (logic implemented in 1B)
ALTER TABLE quarantine ADD COLUMN resolved_at TEXT;
ALTER TABLE quarantine ADD COLUMN resolution_type TEXT;
ALTER TABLE quarantine ADD COLUMN ttf_ms INTEGER;
