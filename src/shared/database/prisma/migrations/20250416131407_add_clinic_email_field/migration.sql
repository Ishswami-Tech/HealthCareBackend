/*
  Warnings:

  - A unique constraint covering the columns `[email]` on the table `Clinic` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[app_name]` on the table `Clinic` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[db_connection_string]` on the table `Clinic` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `app_name` to the `Clinic` table without a default value. This is not possible if the table is not empty.
  - Added the required column `db_connection_string` to the `Clinic` table without a default value. This is not possible if the table is not empty.
  - Added the required column `email` to the `Clinic` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Clinic` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Clinic" ADD COLUMN     "app_name" TEXT NOT NULL,
ADD COLUMN     "db_connection_string" TEXT NOT NULL,
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "logs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "metadata" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_email_key" ON "Clinic"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_app_name_key" ON "Clinic"("app_name");

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_db_connection_string_key" ON "Clinic"("db_connection_string");
