-- Add EXPIRED and CANCELLED to the PaymentStatus enum so payments left PENDING
-- when their appointment expires or is cancelled can be moved to a terminal
-- state instead of staying PENDING indefinitely.
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
