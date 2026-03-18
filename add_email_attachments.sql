edit-- Migration: Add attachments support to email_queue
-- Date: 2025-01-09
-- Description: Adds attachments column to store PDF and other file attachments for emails

ALTER TABLE email_queue 
ADD COLUMN attachments TEXT NULL 
COMMENT 'JSON array of base64-encoded attachments with filename and content';

-- Example attachments format:
-- [{"filename": "ticket-ABC123.pdf", "content": "base64encodedcontent..."}]
