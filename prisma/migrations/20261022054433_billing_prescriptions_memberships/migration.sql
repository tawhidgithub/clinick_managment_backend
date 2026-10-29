-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "renewedFromId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "note" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Membership_renewedFromId_key" ON "Membership"("renewedFromId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_renewedFromId_fkey" FOREIGN KEY ("renewedFromId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

