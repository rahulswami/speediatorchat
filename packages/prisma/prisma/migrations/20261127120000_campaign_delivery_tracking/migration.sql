-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CampaignContactStatus" ADD VALUE 'DELIVERED';
ALTER TYPE "CampaignContactStatus" ADD VALUE 'READ';

-- AlterTable
ALTER TABLE "campaign_contacts" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "metaMessageId" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "campaign_contacts_metaMessageId_key" ON "campaign_contacts"("metaMessageId");

