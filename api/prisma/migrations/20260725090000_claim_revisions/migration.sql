-- Rejected claims come back around: a corrected claim keeps its reference and
-- gains a revision. Existing rows are revision 1, which is what they have always
-- effectively been.
--
-- The decision uniqueness moves from (claimId, actorId) to
-- (claimId, revision, actorId). The new key is strictly weaker than the old one,
-- so no existing row can violate it and the backfill is the column default.

-- DropIndex
DROP INDEX "ClaimDecision_claimId_actorId_key";

-- AlterTable
ALTER TABLE "Claim" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ClaimDecision" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "ClaimDecision_claimId_revision_actorId_key" ON "ClaimDecision"("claimId", "revision", "actorId");
