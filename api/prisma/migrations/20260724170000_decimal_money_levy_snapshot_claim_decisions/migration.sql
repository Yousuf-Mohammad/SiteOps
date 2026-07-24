-- Claims money becomes exact, the levy rate gets snapshotted, and approvals
-- gain a table that can hold two keys.
--
-- The float -> numeric(12,2) casts are safe: every existing value is already a
-- 2dp money amount. The new (orgId, reference) unique replaces a global one --
-- references are issued per-org, so two orgs may legitimately hold EXP 26-0001.

-- DropIndex
DROP INDEX "Claim_reference_key";

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "fuelSubtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "levyAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "levyRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ALTER COLUMN "total" SET DATA TYPE DECIMAL(12,2);

-- AlterTable
ALTER TABLE "ClaimLine" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(12,2);

-- CreateTable
CREATE TABLE "ClaimDecision" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClaimDecision_claimId_idx" ON "ClaimDecision"("claimId");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimDecision_claimId_actorId_key" ON "ClaimDecision"("claimId", "actorId");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_orgId_reference_key" ON "Claim"("orgId", "reference");

-- CreateIndex
CREATE INDEX "SurchargeRate_orgId_effectiveFrom_idx" ON "SurchargeRate"("orgId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "ClaimDecision" ADD CONSTRAINT "ClaimDecision_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
