-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('PLATFORM', 'BUSINESS_APP', 'HISTORY');

-- AlterTable
ALTER TABLE "whatsapp_accounts" ADD COLUMN     "historySyncDeclinedAt" TIMESTAMP(3),
ADD COLUMN     "historySyncProgress" INTEGER;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "source" "MessageSource" NOT NULL DEFAULT 'PLATFORM';

