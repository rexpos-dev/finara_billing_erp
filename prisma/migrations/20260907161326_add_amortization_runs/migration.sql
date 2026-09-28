-- CreateTable
CREATE TABLE `amortization_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `schoolYearId` INTEGER NOT NULL,
    `period` VARCHAR(7) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `entryCount` INTEGER NOT NULL DEFAULT 0,
    `reference` VARCHAR(60) NULL,
    `runBy` INTEGER NULL,
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `amortization_runs_businessId_idx`(`businessId`),
    UNIQUE INDEX `amortization_runs_businessId_schoolYearId_period_key`(`businessId`, `schoolYearId`, `period`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
