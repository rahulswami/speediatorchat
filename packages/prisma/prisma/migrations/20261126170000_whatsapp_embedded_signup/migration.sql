-- CreateEnum
CREATE TYPE "WhatsappConnectionMethod" AS ENUM ('MANUAL', 'EMBEDDED_SIGNUP');

-- CreateEnum
CREATE TYPE "WhatsappAccountStatus" AS ENUM ('CONNECTED', 'SETUP_INCOMPLETE', 'DISCONNECTED');

-- AlterTable
ALTER TABLE "whatsapp_accounts" ADD COLUMN     "businessId" TEXT,
ADD COLUMN     "connectionMethod" "WhatsappConnectionMethod" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "contactsSyncRequestedAt" TIMESTAMP(3),
ADD COLUMN     "disconnectedAt" TIMESTAMP(3),
ADD COLUMN     "displayPhoneNumber" TEXT,
ADD COLUMN     "encryptedPin" TEXT,
ADD COLUMN     "historySyncRequestedAt" TIMESTAMP(3),
ADD COLUMN     "isOnBizApp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSetupError" TEXT,
ADD COLUMN     "pinAuthTag" TEXT,
ADD COLUMN     "pinIv" TEXT,
ADD COLUMN     "registeredAt" TIMESTAMP(3),
ADD COLUMN     "status" "WhatsappAccountStatus" NOT NULL DEFAULT 'CONNECTED',
ADD COLUMN     "webhooksSubscribedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "whatsapp_accounts_phoneNumberId_idx" ON "whatsapp_accounts"("phoneNumberId");

-- CreateIndex
CREATE INDEX "whatsapp_accounts_wabaId_idx" ON "whatsapp_accounts"("wabaId");

