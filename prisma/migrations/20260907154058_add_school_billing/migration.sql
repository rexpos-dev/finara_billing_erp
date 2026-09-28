-- CreateTable
CREATE TABLE `school_years` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `isCurrent` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `school_years_businessId_idx`(`businessId`),
    UNIQUE INDEX `school_years_businessId_code_key`(`businessId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grade_levels` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `code` VARCHAR(20) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `stage` ENUM('PRESCHOOL', 'ELEMENTARY', 'JHS', 'SHS') NOT NULL DEFAULT 'ELEMENTARY',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `grade_levels_businessId_idx`(`businessId`),
    UNIQUE INDEX `grade_levels_businessId_code_key`(`businessId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `schoolYearId` INTEGER NOT NULL,
    `gradeLevelId` INTEGER NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `adviser` VARCHAR(120) NULL,
    `capacity` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sections_businessId_idx`(`businessId`),
    UNIQUE INDEX `sections_schoolYearId_gradeLevelId_name_key`(`schoolYearId`, `gradeLevelId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `students` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `studentNo` VARCHAR(30) NOT NULL,
    `lrn` VARCHAR(12) NULL,
    `lastName` VARCHAR(80) NOT NULL,
    `firstName` VARCHAR(80) NOT NULL,
    `middleName` VARCHAR(80) NULL,
    `suffix` VARCHAR(20) NULL,
    `birthDate` DATE NULL,
    `gender` VARCHAR(10) NULL,
    `address` TEXT NULL,
    `contactPhone` VARCHAR(30) NULL,
    `email` VARCHAR(150) NULL,
    `customerId` INTEGER NOT NULL,
    `status` ENUM('ENROLLED', 'DROPPED', 'TRANSFERRED', 'GRADUATED', 'INACTIVE') NOT NULL DEFAULT 'ENROLLED',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `students_customerId_key`(`customerId`),
    INDEX `students_businessId_idx`(`businessId`),
    INDEX `students_lastName_firstName_idx`(`lastName`, `firstName`),
    INDEX `students_lrn_idx`(`lrn`),
    UNIQUE INDEX `students_businessId_studentNo_key`(`businessId`, `studentNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `guardians` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `studentId` INTEGER NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `relationship` VARCHAR(50) NULL,
    `phone` VARCHAR(30) NULL,
    `email` VARCHAR(150) NULL,
    `occupation` VARCHAR(120) NULL,
    `isPrimaryPayer` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `guardians_studentId_idx`(`studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_types` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `category` ENUM('TUITION', 'MISCELLANEOUS', 'BOOKS', 'UNIFORM', 'OTHER') NOT NULL DEFAULT 'MISCELLANEOUS',
    `accountId` INTEGER NOT NULL,
    `vatCode` ENUM('VAT', 'EXEMPT', 'ZERO') NOT NULL DEFAULT 'EXEMPT',
    `isRefundable` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `fee_types_businessId_idx`(`businessId`),
    UNIQUE INDEX `fee_types_businessId_code_key`(`businessId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_structures` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `schoolYearId` INTEGER NOT NULL,
    `gradeLevelId` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `fee_structures_businessId_idx`(`businessId`),
    UNIQUE INDEX `fee_structures_schoolYearId_gradeLevelId_key`(`schoolYearId`, `gradeLevelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fee_structure_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `feeStructureId` INTEGER NOT NULL,
    `feeTypeId` INTEGER NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `billingBasis` ENUM('ANNUAL', 'ONE_TIME') NOT NULL DEFAULT 'ANNUAL',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `fee_structure_lines_feeStructureId_idx`(`feeStructureId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_schemes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `installmentCount` INTEGER NOT NULL DEFAULT 10,
    `downPaymentAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `discountPct` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `surchargePct` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payment_schemes_businessId_idx`(`businessId`),
    UNIQUE INDEX `payment_schemes_businessId_code_key`(`businessId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `enrollments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `studentId` INTEGER NOT NULL,
    `schoolYearId` INTEGER NOT NULL,
    `gradeLevelId` INTEGER NOT NULL,
    `sectionId` INTEGER NULL,
    `feeStructureId` INTEGER NOT NULL,
    `paymentSchemeId` INTEGER NOT NULL,
    `enrollmentDate` DATE NOT NULL,
    `status` ENUM('PENDING', 'ENROLLED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `remarks` TEXT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `enrollments_businessId_idx`(`businessId`),
    INDEX `enrollments_schoolYearId_idx`(`schoolYearId`),
    UNIQUE INDEX `enrollments_studentId_schoolYearId_key`(`studentId`, `schoolYearId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assessments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `assessmentNo` VARCHAR(30) NOT NULL,
    `enrollmentId` INTEGER NOT NULL,
    `studentId` INTEGER NOT NULL,
    `assessmentDate` DATE NOT NULL,
    `grossAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `discountAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `subsidyAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `billedAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `paidAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `status` ENUM('DRAFT', 'ISSUED', 'SETTLED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `notes` TEXT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `assessments_assessmentNo_key`(`assessmentNo`),
    UNIQUE INDEX `assessments_enrollmentId_key`(`enrollmentId`),
    INDEX `assessments_businessId_idx`(`businessId`),
    INDEX `assessments_studentId_idx`(`studentId`),
    INDEX `assessments_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assessment_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assessmentId` INTEGER NOT NULL,
    `feeTypeId` INTEGER NOT NULL,
    `accountId` INTEGER NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `vatCode` ENUM('VAT', 'EXEMPT', 'ZERO') NOT NULL DEFAULT 'EXEMPT',
    `billingBasis` ENUM('ANNUAL', 'ONE_TIME') NOT NULL DEFAULT 'ANNUAL',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `assessment_lines_assessmentId_idx`(`assessmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `installments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assessmentId` INTEGER NOT NULL,
    `seq` INTEGER NOT NULL,
    `label` VARCHAR(60) NOT NULL,
    `dueDate` DATE NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `paidAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `status` ENUM('SCHEDULED', 'BILLED', 'PARTIAL', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `invoiceId` INTEGER NULL,
    `billedAt` DATETIME(3) NULL,

    UNIQUE INDEX `installments_invoiceId_key`(`invoiceId`),
    INDEX `installments_dueDate_idx`(`dueDate`),
    INDEX `installments_status_idx`(`status`),
    UNIQUE INDEX `installments_assessmentId_seq_key`(`assessmentId`, `seq`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_discounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enrollmentId` INTEGER NOT NULL,
    `type` ENUM('SIBLING', 'ACADEMIC', 'EMPLOYEE', 'EARLY_BIRD', 'FULL_PAYMENT', 'OTHER') NOT NULL DEFAULT 'SIBLING',
    `label` VARCHAR(120) NOT NULL,
    `basis` ENUM('PCT', 'FIXED') NOT NULL DEFAULT 'PCT',
    `value` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `approvedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `student_discounts_enrollmentId_idx`(`enrollmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_subsidies` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `enrollmentId` INTEGER NOT NULL,
    `type` ENUM('ESC', 'SHS_VOUCHER', 'LGU', 'PRIVATE_SPONSOR') NOT NULL DEFAULT 'ESC',
    `referenceNo` VARCHAR(60) NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `receivedAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `status` ENUM('PENDING', 'BILLED', 'RECEIVED') NOT NULL DEFAULT 'PENDING',
    `remarks` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `student_subsidies_enrollmentId_idx`(`enrollmentId`),
    INDEX `student_subsidies_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_advances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `studentId` INTEGER NOT NULL,
    `receiptNo` VARCHAR(30) NOT NULL,
    `paymentDate` DATE NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `appliedAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `paymentMethod` VARCHAR(50) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `student_advances_receiptNo_key`(`receiptNo`),
    INDEX `student_advances_businessId_idx`(`businessId`),
    INDEX `student_advances_studentId_idx`(`studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `sections` ADD CONSTRAINT `sections_schoolYearId_fkey` FOREIGN KEY (`schoolYearId`) REFERENCES `school_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sections` ADD CONSTRAINT `sections_gradeLevelId_fkey` FOREIGN KEY (`gradeLevelId`) REFERENCES `grade_levels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `students` ADD CONSTRAINT `students_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `guardians` ADD CONSTRAINT `guardians_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_types` ADD CONSTRAINT `fee_types_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structures` ADD CONSTRAINT `fee_structures_schoolYearId_fkey` FOREIGN KEY (`schoolYearId`) REFERENCES `school_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structures` ADD CONSTRAINT `fee_structures_gradeLevelId_fkey` FOREIGN KEY (`gradeLevelId`) REFERENCES `grade_levels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structure_lines` ADD CONSTRAINT `fee_structure_lines_feeStructureId_fkey` FOREIGN KEY (`feeStructureId`) REFERENCES `fee_structures`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fee_structure_lines` ADD CONSTRAINT `fee_structure_lines_feeTypeId_fkey` FOREIGN KEY (`feeTypeId`) REFERENCES `fee_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_schoolYearId_fkey` FOREIGN KEY (`schoolYearId`) REFERENCES `school_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_gradeLevelId_fkey` FOREIGN KEY (`gradeLevelId`) REFERENCES `grade_levels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_sectionId_fkey` FOREIGN KEY (`sectionId`) REFERENCES `sections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_feeStructureId_fkey` FOREIGN KEY (`feeStructureId`) REFERENCES `fee_structures`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_paymentSchemeId_fkey` FOREIGN KEY (`paymentSchemeId`) REFERENCES `payment_schemes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessments` ADD CONSTRAINT `assessments_enrollmentId_fkey` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessments` ADD CONSTRAINT `assessments_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_lines` ADD CONSTRAINT `assessment_lines_assessmentId_fkey` FOREIGN KEY (`assessmentId`) REFERENCES `assessments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assessment_lines` ADD CONSTRAINT `assessment_lines_feeTypeId_fkey` FOREIGN KEY (`feeTypeId`) REFERENCES `fee_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `installments` ADD CONSTRAINT `installments_assessmentId_fkey` FOREIGN KEY (`assessmentId`) REFERENCES `assessments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `installments` ADD CONSTRAINT `installments_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_discounts` ADD CONSTRAINT `student_discounts_enrollmentId_fkey` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_subsidies` ADD CONSTRAINT `student_subsidies_enrollmentId_fkey` FOREIGN KEY (`enrollmentId`) REFERENCES `enrollments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_advances` ADD CONSTRAINT `student_advances_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
