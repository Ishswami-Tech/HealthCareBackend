-- Fixed doctor fee per visit type; NULL keeps the percentage platform fee.
ALTER TABLE "DoctorClinic" ADD COLUMN "videoDoctorFee" DOUBLE PRECISION;
ALTER TABLE "DoctorClinic" ADD COLUMN "inPersonDoctorFee" DOUBLE PRECISION;
