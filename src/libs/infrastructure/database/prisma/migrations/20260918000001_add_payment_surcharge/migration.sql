-- AddCashfreeDynamicSurchargeFields
-- Cashfree Ticket #8386446: Dynamic Surcharge (Pass-Through TDR + GST)
-- These fields capture the surcharge Cashfree charges credit card customers

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "surchargeServiceCharge" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "surchargeServiceTax" DOUBLE PRECISION NOT NULL DEFAULT 0;
