-- Add indexes to users table for reminder queries
CREATE INDEX idx_users_dateOfBirth ON users(dateOfBirth);
CREATE INDEX idx_users_weddingDate ON users(weddingDate);
CREATE INDEX idx_users_anniversary ON users(anniversary);

-- Create reminder_cache table
CREATE TABLE reminder_cache (
  id VARCHAR(191) NOT NULL PRIMARY KEY,
  userId VARCHAR(191) NOT NULL,
  type VARCHAR(191) NOT NULL,
  originalDate DATETIME(3) NOT NULL,
  upcomingDate DATETIME(3) NOT NULL,
  daysUntil INT NOT NULL,
  age INT NULL,
  years INT NULL,
  churchId VARCHAR(191) NOT NULL,
  nationalAdminId VARCHAR(191) NULL,
  lastNotified DATETIME(3) NULL,
  notifyAt DATETIME(3) NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt DATETIME(3) NOT NULL,
  
  CONSTRAINT fk_reminder_cache_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_reminder_cache_church FOREIGN KEY (churchId) REFERENCES churches(id) ON DELETE CASCADE,
  
  UNIQUE KEY unique_user_type_upcoming (userId, type, upcomingDate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create indexes for reminder_cache
CREATE INDEX idx_reminder_cache_upcomingDate ON reminder_cache(upcomingDate);
CREATE INDEX idx_reminder_cache_churchId ON reminder_cache(churchId);
CREATE INDEX idx_reminder_cache_nationalAdminId ON reminder_cache(nationalAdminId);
CREATE INDEX idx_reminder_cache_type ON reminder_cache(type);
CREATE INDEX idx_reminder_cache_notifyAt ON reminder_cache(notifyAt);
CREATE INDEX idx_reminder_cache_daysUntil ON reminder_cache(daysUntil);
