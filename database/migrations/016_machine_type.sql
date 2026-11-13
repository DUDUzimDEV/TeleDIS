-- Migration 016: Persist machine type (tipo) directly on machines table
ALTER TABLE machines ADD COLUMN IF NOT EXISTS tipo VARCHAR(60);
