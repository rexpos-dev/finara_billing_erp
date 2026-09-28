-- AlterTable
ALTER TABLE `businesses` ADD COLUMN `paidUntil` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `plan_prices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyType` VARCHAR(20) NOT NULL,
    `period` ENUM('MONTHLY', 'YEARLY') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `plan_prices_companyType_period_key`(`companyType`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_instructions` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `text` TEXT NOT NULL,
    `qrFileName` VARCHAR(255) NULL,
    `qrMimeType` VARCHAR(100) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderNo` VARCHAR(20) NOT NULL,
    `userId` INTEGER NOT NULL,
    `companyName` VARCHAR(150) NOT NULL,
    `tin` VARCHAR(30) NULL,
    `address` TEXT NULL,
    `phone` VARCHAR(30) NULL,
    `companyType` VARCHAR(20) NOT NULL,
    `taxType` VARCHAR(20) NOT NULL,
    `booksStartDate` DATE NULL,
    `period` ENUM('MONTHLY', 'YEARLY') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `status` ENUM('PENDING_PAYMENT', 'PROOF_SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_PAYMENT',
    `referenceNo` VARCHAR(100) NULL,
    `proofFileName` VARCHAR(255) NULL,
    `proofOriginalName` VARCHAR(255) NULL,
    `proofMimeType` VARCHAR(100) NULL,
    `reviewNote` VARCHAR(500) NULL,
    `reviewedById` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `businessId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `business_orders_orderNo_key`(`orderNo`),
    INDEX `business_orders_userId_idx`(`userId`),
    INDEX `business_orders_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `business_orders` ADD CONSTRAINT `business_orders_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

