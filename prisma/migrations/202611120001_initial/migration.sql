-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "niche" TEXT,
    "advertiserEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publisherEnabled" BOOLEAN NOT NULL DEFAULT false,
    "catalogConsent" BOOLEAN NOT NULL DEFAULT false,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditAccount" (
    "shopId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("shopId")
);

-- CreateTable
CREATE TABLE "CreditOperation" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditEntry" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "CreditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "CreditOperation_idempotencyKey_key" ON "CreditOperation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditEntry_shopId_idx" ON "CreditEntry"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditEntry_operationId_shopId_key" ON "CreditEntry"("operationId", "shopId");

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditEntry" ADD CONSTRAINT "CreditEntry_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "CreditOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditEntry" ADD CONSTRAINT "CreditEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "CreditAccount"("shopId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business invariants are enforced even for direct database writes.
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_nonnegative" CHECK ("balance" >= 0);
ALTER TABLE "CreditEntry" ADD CONSTRAINT "CreditEntry_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "Shop" ADD CONSTRAINT "Shop_valid_niche" CHECK (
  "niche" IS NULL OR "niche" IN ('Fashion', 'Beauty', 'Home', 'Pets', 'Sports', 'Electronics', 'Kids', 'Food', 'Art & Gifts', 'Other')
);

