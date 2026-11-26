-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "settingsVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ShopCategoryPreference" (
    "shopId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "niche" TEXT NOT NULL,

    CONSTRAINT "ShopCategoryPreference_pkey" PRIMARY KEY ("shopId","role","niche")
);

-- CreateTable
CREATE TABLE "Partnership" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "advertiserBlocked" BOOLEAN NOT NULL DEFAULT false,
    "publisherBlocked" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Partnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerInvitation" (
    "tokenHash" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerInvitation_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "ProductAd" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "productUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "rightsConfirmedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductAd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockLoad" (
    "id" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockLoad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClickToken" (
    "nonce" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "productAdId" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "pairVersion" INTEGER NOT NULL,
    "productRevision" INTEGER NOT NULL,
    "advertiserVersion" INTEGER NOT NULL,
    "publisherVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClickToken_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "CountedClick" (
    "nonce" TEXT NOT NULL,
    "advertiserId" TEXT,
    "publisherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CountedClick_pkey" PRIMARY KEY ("nonce")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusReceipt" (
    "shopHash" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BonusReceipt_pkey" PRIMARY KEY ("shopHash")
);

-- CreateTable
CREATE TABLE "OperatorAudit" (
    "id" TEXT NOT NULL,
    "shopId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Partnership_advertiserId_publisherId_key" ON "Partnership"("advertiserId", "publisherId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAd_shopId_productId_key" ON "ProductAd"("shopId", "productId");

-- CreateIndex
CREATE INDEX "BlockLoad_publisherId_createdAt_idx" ON "BlockLoad"("publisherId", "createdAt");

-- CreateIndex
CREATE INDEX "ClickToken_expiresAt_idx" ON "ClickToken"("expiresAt");

-- CreateIndex
CREATE INDEX "ClickToken_advertiserId_idx" ON "ClickToken"("advertiserId");

-- CreateIndex
CREATE INDEX "ClickToken_publisherId_idx" ON "ClickToken"("publisherId");

-- CreateIndex
CREATE INDEX "CountedClick_advertiserId_createdAt_idx" ON "CountedClick"("advertiserId", "createdAt");

-- CreateIndex
CREATE INDEX "CountedClick_publisherId_createdAt_idx" ON "CountedClick"("publisherId", "createdAt");

-- CreateIndex
CREATE INDEX "RateLimit_expiresAt_idx" ON "RateLimit"("expiresAt");

-- AddForeignKey
ALTER TABLE "ShopCategoryPreference" ADD CONSTRAINT "ShopCategoryPreference_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerInvitation" ADD CONSTRAINT "PartnerInvitation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAd" ADD CONSTRAINT "ProductAd_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockLoad" ADD CONSTRAINT "BlockLoad_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Partnership" ADD CONSTRAINT "Partnership_different_shops" CHECK ("advertiserId" <> "publisherId");
ALTER TABLE "ShopCategoryPreference" ADD CONSTRAINT "Preference_role" CHECK ("role" IN ('advertiser','publisher'));
ALTER TABLE "ShopCategoryPreference" ADD CONSTRAINT "Preference_niche" CHECK ("niche" IN ('Fashion','Beauty','Home','Pets','Sports','Electronics','Kids','Food','Art & Gifts','Other'));
