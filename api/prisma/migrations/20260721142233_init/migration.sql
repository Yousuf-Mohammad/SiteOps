-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimLine" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "isFuel" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ClaimLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurchargeRate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ratePercent" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SurchargeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "NumberSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "hireRatePerDay" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Docket" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "docketNumber" TEXT NOT NULL,
    "workDate" TIMESTAMP(3) NOT NULL,
    "hours" DECIMAL(5,2) NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "submittedById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Docket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Project_orgId_status_idx" ON "Project"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_orgId_code_key" ON "Project"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_reference_key" ON "Claim"("reference");

-- CreateIndex
CREATE INDEX "Claim_status_orgId_idx" ON "Claim"("status", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "NumberSequence_orgId_key_key" ON "NumberSequence"("orgId", "key");

-- CreateIndex
CREATE INDEX "Equipment_orgId_category_idx" ON "Equipment"("orgId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_orgId_assetCode_key" ON "Equipment"("orgId", "assetCode");

-- CreateIndex
CREATE INDEX "Docket_orgId_projectId_workDate_idx" ON "Docket"("orgId", "projectId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "Docket_orgId_docketNumber_key" ON "Docket"("orgId", "docketNumber");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "OutboxEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Note_orgId_entityType_entityId_idx" ON "Note"("orgId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_entityType_entityId_idx" ON "AuditLog"("orgId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimLine" ADD CONSTRAINT "ClaimLine_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurchargeRate" ADD CONSTRAINT "SurchargeRate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
