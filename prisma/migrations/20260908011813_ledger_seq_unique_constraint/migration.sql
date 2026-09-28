-- CreateIndex
-- Created before dropping the old index: `studentId_seq_idx` backs the FK to
-- `students`, so MySQL refuses to drop it until a replacement index covering
-- `studentId` exists.
CREATE UNIQUE INDEX `student_ledgers_studentId_seq_key` ON `student_ledgers`(`studentId`, `seq`);

-- DropIndex
DROP INDEX `student_ledgers_studentId_seq_idx` ON `student_ledgers`;
