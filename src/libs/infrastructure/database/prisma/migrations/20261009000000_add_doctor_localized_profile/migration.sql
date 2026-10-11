-- Per-language public profile text (name, headline, highlights) keyed by locale: en, hi, mr.
ALTER TABLE "Doctor" ADD COLUMN "localizedProfile" JSONB;
