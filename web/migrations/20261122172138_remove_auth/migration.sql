/*
  Warnings:

  - You are about to drop the `Auth` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AuthIdentity` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Session` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `userId` on the `VoiceCommand` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Auth_userId_key";

-- DropIndex
DROP INDEX "Session_userId_idx";

-- DropIndex
DROP INDEX "Session_id_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Auth";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "AuthIdentity";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Session";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "User";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_VoiceCommand" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "runId" TEXT
);
INSERT INTO "new_VoiceCommand" ("createdAt", "id", "kind", "runId", "transcript") SELECT "createdAt", "id", "kind", "runId", "transcript" FROM "VoiceCommand";
DROP TABLE "VoiceCommand";
ALTER TABLE "new_VoiceCommand" RENAME TO "VoiceCommand";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
