-- Fixed doctor fee per visit type; NULL keeps the percentage platform fee. Idempotent so it can be applied before the deploy.
ALTER TABLE "DoctorClinic" ADD COLUMN IF NOT EXISTS "videoDoctorFee" DOUBLE PRECISION;
ALTER TABLE "DoctorClinic" ADD COLUMN IF NOT EXISTS "inPersonDoctorFee" DOUBLE PRECISION;
