-- CreateEnum
CREATE TYPE "Game" AS ENUM ('star', 'crate');

-- CreateEnum
CREATE TYPE "AwardStatus" AS ENUM ('awarded', 'voided');

-- CreateTable
CREATE TABLE "ConfigVersion" (
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigVersion_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "Kiosk" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "Kiosk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" UUID NOT NULL,
    "kioskId" TEXT NOT NULL,
    "game" "Game" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "isReplay" BOOLEAN NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "stats" JSONB NOT NULL,
    "initials" TEXT,
    "flags" TEXT[],
    "hiddenFromBoard" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizeAward" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "kioskId" TEXT NOT NULL,
    "game" "Game" NOT NULL,
    "score" INTEGER NOT NULL,
    "prizeId" TEXT NOT NULL,
    "prizeName" TEXT NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL,
    "status" "AwardStatus" NOT NULL DEFAULT 'awarded',
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrizeAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientError" (
    "id" UUID NOT NULL,
    "kioskId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,

    CONSTRAINT "ClientError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "GameSession_game_score_idx" ON "GameSession"("game", "score" DESC);

-- CreateIndex
CREATE INDEX "GameSession_endedAt_idx" ON "GameSession"("endedAt");

-- CreateIndex
CREATE INDEX "GameSession_kioskId_endedAt_idx" ON "GameSession"("kioskId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrizeAward_sessionId_key" ON "PrizeAward"("sessionId");

-- CreateIndex
CREATE INDEX "PrizeAward_awardedAt_idx" ON "PrizeAward"("awardedAt");

-- CreateIndex
CREATE INDEX "PrizeAward_prizeId_awardedAt_idx" ON "PrizeAward"("prizeId", "awardedAt");

-- CreateIndex
CREATE INDEX "PrizeAward_game_awardedAt_idx" ON "PrizeAward"("game", "awardedAt");

-- CreateIndex
CREATE INDEX "ClientError_at_idx" ON "ClientError"("at");

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeAward" ADD CONSTRAINT "PrizeAward_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeAward" ADD CONSTRAINT "PrizeAward_kioskId_fkey" FOREIGN KEY ("kioskId") REFERENCES "Kiosk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
