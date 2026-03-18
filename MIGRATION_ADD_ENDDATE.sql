-- Migration: Add endDate column to events table (REQUIRED field)
-- Run this migration after updating the codebase

-- Step 1: Add column as nullable first
ALTER TABLE `events` ADD COLUMN `endDate` DATETIME NULL AFTER `date`;

-- Step 2: Update existing events to set endDate = date (for backward compatibility)
UPDATE `events` SET `endDate` = `date` WHERE `endDate` IS NULL;

-- Step 3: Make the column NOT NULL
ALTER TABLE `events` MODIFY COLUMN `endDate` DATETIME NOT NULL;

-- All events now have both start date and end date
-- For single-day events, date and endDate will be the same
-- For multi-day events, endDate will be after date
