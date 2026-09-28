-- AlterTable
-- Every student used to default to ENROLLED on creation, even though the
-- registry form is personal-info-only (no enrollment, no assessment, no
-- payment). That left newly registered students showing an empty, misleading
-- ledger. APPLICANT is the actual first stage of the documented lifecycle:
-- APPLICANT -> ADMITTED -> ENROLLED -> ACTIVE -> COMPLETED.
ALTER TABLE `students` MODIFY `status` ENUM('APPLICANT', 'ADMITTED', 'ENROLLED', 'ACTIVE', 'COMPLETED', 'GRADUATED', 'TRANSFERRED', 'WITHDRAWN', 'INACTIVE') NOT NULL DEFAULT 'APPLICANT';
