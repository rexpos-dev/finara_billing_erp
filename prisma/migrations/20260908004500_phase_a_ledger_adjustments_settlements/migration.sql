-- Phase A: student ledger, billing adjustments, refunds, gateway settlement,
-- and the status flows from the school-system blueprint (section 32).
--
-- Hand-written from 'prisma migrate diff'. The generated diff also wanted to
-- DROP TABLE `lead` and recreate it as `Lead`; that pair was removed. MySQL
-- here runs lower_case_table_names=1, so the two names are the same table and
-- the round trip would only have destroyed the existing rows.

-- AlterTable
ALTER TABLE `assessments` MODIFY `status` ENUM('DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'VOIDED') NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE `enrollments` MODIFY `status` ENUM('PRE_ENROLLED', 'FOR_ASSESSMENT', 'ASSESSED', 'PARTIALLY_PAID', 'ENROLLED', 'CANCELLED', 'TRANSFERRED', 'COMPLETED') NOT NULL DEFAULT 'PRE_ENROLLED';

-- AlterTable
ALTER TABLE `payments_ar` ADD COLUMN `status` ENUM('PENDING', 'VERIFIED', 'POSTED', 'REVERSED') NOT NULL DEFAULT 'POSTED';

-- AlterTable
ALTER TABLE `students` MODIFY `status` ENUM('APPLICANT', 'ADMITTED', 'ENROLLED', 'ACTIVE', 'COMPLETED', 'GRADUATED', 'TRANSFERRED', 'WITHDRAWN', 'INACTIVE') NOT NULL DEFAULT 'ENROLLED';

-- CreateTable
CREATE TABLE `student_ledgers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `studentId` INTEGER NOT NULL,
    `entryDate` DATE NOT NULL,
    `seq` INTEGER NOT NULL DEFAULT 0,
    `type` ENUM('ASSESSMENT', 'CHARGE', 'DISCOUNT', 'SCHOLARSHIP', 'SUBSIDY', 'PAYMENT', 'ADVANCE', 'ADVANCE_APPLIED', 'ADJUSTMENT', 'CREDIT_MEMO', 'REFUND', 'REVERSAL') NOT NULL,
    `reference` VARCHAR(60) NULL,
    `description` VARCHAR(255) NOT NULL,
    `debit` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `credit` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `balance` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `assessmentId` INTEGER NULL,
    `invoiceId` INTEGER NULL,
    `entryNo` VARCHAR(30) NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `student_ledgers_businessId_idx`(`businessId`),
    INDEX `student_ledgers_studentId_seq_idx`(`studentId`, `seq`),
    INDEX `student_ledgers_entryDate_idx`(`entryDate`),
    INDEX `student_ledgers_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `billing_adjustments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `adjustmentNo` VARCHAR(30) NOT NULL,
    `studentId` INTEGER NOT NULL,
    `assessmentId` INTEGER NULL,
    `adjustmentDate` DATE NOT NULL,
    `direction` ENUM('DEBIT', 'CREDIT') NOT NULL,
    `category` ENUM('CORRECTION', 'PENALTY', 'CREDIT_MEMO', 'WRITE_OFF', 'OTHER') NOT NULL DEFAULT 'CORRECTION',
    `accountId` INTEGER NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `vatCode` ENUM('VAT', 'EXEMPT', 'ZERO') NOT NULL DEFAULT 'EXEMPT',
    `reason` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'POSTED', 'VOIDED') NOT NULL DEFAULT 'DRAFT',
    `approvedBy` INTEGER NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `billing_adjustments_adjustmentNo_key`(`adjustmentNo`),
    INDEX `billing_adjustments_businessId_idx`(`businessId`),
    INDEX `billing_adjustments_studentId_idx`(`studentId`),
    INDEX `billing_adjustments_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refunds` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `refundNo` VARCHAR(30) NOT NULL,
    `studentId` INTEGER NOT NULL,
    `refundDate` DATE NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `method` VARCHAR(50) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'APPROVED', 'PAID', 'VOIDED') NOT NULL DEFAULT 'DRAFT',
    `approvedBy` INTEGER NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `refunds_refundNo_key`(`refundNo`),
    INDEX `refunds_businessId_idx`(`businessId`),
    INDEX `refunds_studentId_idx`(`studentId`),
    INDEX `refunds_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_settlements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `settlementNo` VARCHAR(30) NOT NULL,
    `settlementDate` DATE NOT NULL,
    `method` VARCHAR(50) NOT NULL,
    `grossAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `feeAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `bankAccountId` INTEGER NOT NULL,
    `reference` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_settlements_settlementNo_key`(`settlementNo`),
    INDEX `payment_settlements_businessId_idx`(`businessId`),
    INDEX `payment_settlements_settlementDate_idx`(`settlementDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `payments_ar_status_idx` ON `payments_ar`(`status`);

-- AddForeignKey
ALTER TABLE `student_ledgers` ADD CONSTRAINT `student_ledgers_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `billing_adjustments` ADD CONSTRAINT `billing_adjustments_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `billing_adjustments` ADD CONSTRAINT `billing_adjustments_assessmentId_fkey` FOREIGN KEY (`assessmentId`) REFERENCES `assessments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `billing_adjustments` ADD CONSTRAINT `billing_adjustments_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refunds` ADD CONSTRAINT `refunds_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_settlements` ADD CONSTRAINT `payment_settlements_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

