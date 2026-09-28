-- AlterTable
ALTER TABLE `plan_prices` ADD COLUMN `discountPercent` DECIMAL(5, 2) NULL;

-- Backfill: every existing Yearly amount already equals Monthly x 12 less
-- exactly 5% (School 1105x12=13260->12597, Services 1350x12=16200->15390,
-- Retail 980x12=11760->11172, Other 1020x12=12240->11628) so this changes no
-- price a customer currently sees.
UPDATE `plan_prices` SET `discountPercent` = 5.00 WHERE `period` = 'MONTHLY';
