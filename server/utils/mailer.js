const logger = require('./logger');

/**
 * Lightweight email service. Uses nodemailer when SMTP env vars are present and
 * the package is installed; otherwise it degrades gracefully (logs and returns
 * false) so the rest of the app keeps working without email configured.
 *
 * Required env vars to enable:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 * Optional:
 *   SMTP_SECURE ("true"/"false"), SMTP_FROM, APP_URL (for links in emails)
 */
let transporter = null;
let initialised = false;

function getTransporter() {
  if (initialised) return transporter;
  initialised = true;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    logger.info('[mailer] SMTP not configured — emails will be skipped.');
    return null;
  }
  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: String(process.env.SMTP_SECURE) === 'true',
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    logger.info('[mailer] SMTP transport ready.');
  } catch (err) {
    logger.error(`[mailer] nodemailer unavailable: ${err.message}`);
    transporter = null;
  }
  return transporter;
}

const FROM = () => process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@finara.local';
const APP_URL = () => (process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

/** Send a generic email. Returns true on success, false if not sent. */
async function sendMail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) return false;
  try {
    await t.sendMail({ from: FROM(), to, subject, html, text });
    logger.info(`[mailer] sent "${subject}" -> ${to}`);
    return true;
  } catch (err) {
    logger.error(`[mailer] send failed -> ${to}: ${err.message}`);
    return false;
  }
}

function wrap(title, body) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
    <div style="background:#1e3a8a;color:#fff;padding:16px 20px;font-size:18px;font-weight:600">Finara ERP</div>
    <div style="padding:20px;color:#111827;line-height:1.55">
      <h2 style="margin:0 0 12px;font-size:18px">${title}</h2>
      ${body}
    </div>
    <div style="padding:12px 20px;background:#f9fafb;color:#6b7280;font-size:12px">This is an automated message from Finara ERP.</div>
  </div>`;
}

async function sendPasswordReset(user, rawToken) {
  const link = `${APP_URL()}/reset-password?token=${rawToken}`;
  const html = wrap('Password Reset Request',
    `<p>Hi ${user.firstName},</p>
     <p>We received a request to reset your password. This link expires in 1 hour.</p>
     <p><a href="${link}" style="display:inline-block;background:#1e3a8a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Reset Password</a></p>
     <p style="font-size:12px;color:#6b7280">If the button doesn't work, copy this link:<br>${link}</p>
     <p style="font-size:12px;color:#6b7280">If you didn't request this, you can safely ignore this email.</p>`);
  return sendMail({ to: user.email, subject: 'Reset your Finara ERP password', html });
}

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateStr = (d) => new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fillTemplate(str, data) {
  return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => escapeHtml(data[k] ?? ''));
}

function textBlock(label, text) {
  if (!text || !text.trim()) return '';
  const html = text.trim().split('\n').map((line) => `<p style="margin:0 0 4px">${line}</p>`).join('');
  return `<div style="margin:14px 0;padding:10px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px">
    ${label ? `<p style="margin:0 0 6px;font-weight:700;font-size:12px;color:#374151">${label}</p>` : ''}
    ${html}
  </div>`;
}

const DEFAULT_INVOICE_SUBJECT  = 'Invoice {{invoiceNo}} from {{companyName}}';
const DEFAULT_INVOICE_GREETING = 'Dear {{customerName}},\n\nPlease find your invoice details below. Amount due: {{amountDue}}.';

async function sendInvoiceEmail(invoice, customer, settings = {}) {
  if (!customer?.email) return false;
  const lines = (invoice.lines || []).map((l) =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${l.description || ''}</td>
     <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${peso(l.amount)}</td></tr>`).join('');

  const data = {
    customerName: customer.name || '',
    invoiceNo:    invoice.invoiceNo,
    invoiceDate:  dateStr(invoice.invoiceDate),
    dueDate:      dateStr(invoice.dueDate),
    subtotal:     peso(invoice.subtotal),
    vat:          peso(invoice.vatAmount),
    total:        peso(invoice.totalAmount),
    amountDue:    peso(Number(invoice.totalAmount) - Number(invoice.paidAmount || 0)),
    companyName:  settings.companyName || 'Finara ERP',
    notes:        invoice.notes || '',
  };

  const subject = fillTemplate(settings.invoiceEmailSubject || DEFAULT_INVOICE_SUBJECT, data)
    || `Invoice ${invoice.invoiceNo} from ${data.companyName}`;
  const greeting = fillTemplate(settings.invoiceEmailGreeting || DEFAULT_INVOICE_GREETING, data)
    .trim().split('\n').filter(Boolean).map((line) => `<p>${line}</p>`).join('');

  const html = wrap(`Invoice ${invoice.invoiceNo}`,
    `${greeting}
     <table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0">
       <thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ddd">Description</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ddd">Amount</th></tr></thead>
       <tbody>${lines}</tbody>
       <tfoot>
         <tr><td style="padding:6px 8px;text-align:right">Subtotal</td><td style="padding:6px 8px;text-align:right">${peso(invoice.subtotal)}</td></tr>
         <tr><td style="padding:6px 8px;text-align:right">VAT</td><td style="padding:6px 8px;text-align:right">${peso(invoice.vatAmount)}</td></tr>
         <tr><td style="padding:6px 8px;text-align:right;font-weight:700">Total</td><td style="padding:6px 8px;text-align:right;font-weight:700">${peso(invoice.totalAmount)}</td></tr>
       </tfoot>
     </table>
     <p style="font-size:12px;color:#6b7280">Invoice date: ${data.invoiceDate} · Due date: ${data.dueDate}</p>
     ${textBlock('Notes', fillTemplate('{{notes}}', data))}
     ${textBlock('Payment Instructions', fillTemplate(settings.invoiceEmailPaymentInstructions, data))}
     ${textBlock('Terms & Conditions', fillTemplate(settings.invoiceEmailTerms, data))}
     ${textBlock('', fillTemplate(settings.invoiceEmailSignature, data))}`);

  return sendMail({ to: customer.email, subject, html });
}

/**
 * Email a student's assessment (fee breakdown + payment schedule) to a
 * recipient — the primary-payer guardian's email, or the student's own if no
 * guardian has one on file. See assessmentController.emailAssessment.
 */
async function sendAssessmentEmail(assessment, recipient, settings = {}) {
  if (!recipient?.email) return false;

  const feeRows = (assessment.lines || []).map((l) =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(l.description || '')}</td>
     <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${peso(l.amount)}</td></tr>`).join('');

  const statusColor = { PAID: '#15803d', PARTIAL: '#b45309', BILLED: '#1d4ed8', SCHEDULED: '#6b7280', CANCELLED: '#9ca3af' };
  const schedRows = (assessment.installments || []).map((i) =>
    `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(i.label || '')}</td>
     <td style="padding:4px 8px;border-bottom:1px solid #eee">${dateStr(i.dueDate)}</td>
     <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${peso(i.amount)}</td>
     <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${peso(i.paidAmount)}</td>
     <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:center;color:${statusColor[i.status] || '#6b7280'};font-weight:600">${escapeHtml(i.status || '')}</td></tr>`).join('');

  const totalPayable = Number(assessment.netAmount) - Number(assessment.subsidyAmount);
  const companyName = settings.companyName || 'Finara ERP';

  const html = wrap(`Assessment ${assessment.assessmentNo}`,
    `<p>Dear ${escapeHtml(recipient.name || 'Parent/Guardian')},</p>
     <p>Please find the assessment of fees for <strong>${escapeHtml(assessment.studentLabel || '')}</strong> below.</p>
     <table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0">
       <thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ddd">Fee</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ddd">Amount</th></tr></thead>
       <tbody>${feeRows}</tbody>
       <tfoot>
         <tr><td style="padding:6px 8px;text-align:right">Gross assessment</td><td style="padding:6px 8px;text-align:right">${peso(assessment.grossAmount)}</td></tr>
         ${Number(assessment.discountAmount) > 0 ? `<tr><td style="padding:6px 8px;text-align:right">Less: discounts</td><td style="padding:6px 8px;text-align:right">(${peso(assessment.discountAmount)})</td></tr>` : ''}
         ${Number(assessment.subsidyAmount) > 0 ? `<tr><td style="padding:6px 8px;text-align:right">Less: DepEd subsidy</td><td style="padding:6px 8px;text-align:right">(${peso(assessment.subsidyAmount)})</td></tr>` : ''}
         <tr><td style="padding:6px 8px;text-align:right;font-weight:700">Total payable</td><td style="padding:6px 8px;text-align:right;font-weight:700">${peso(totalPayable)}</td></tr>
       </tfoot>
     </table>
     <h3 style="font-size:14px;margin:16px 0 8px">Payment Schedule</h3>
     <table style="width:100%;border-collapse:collapse;font-size:13px">
       <thead><tr>
         <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ddd">Installment</th>
         <th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ddd">Due</th>
         <th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ddd">Amount</th>
         <th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ddd">Paid</th>
         <th style="text-align:center;padding:4px 8px;border-bottom:2px solid #ddd">Status</th>
       </tr></thead>
       <tbody>${schedRows}</tbody>
     </table>
     <p style="font-size:12px;color:#6b7280">Tuition and school fees are VAT-exempt under Sec. 109(H) of the National Internal Revenue Code.
     Books, modules and uniforms are sales of goods and are subject to VAT.</p>`);

  return sendMail({
    to: recipient.email,
    subject: `Assessment ${assessment.assessmentNo} — ${companyName}`,
    html,
  });
}

async function sendOverdueReminder(invoice, customer) {
  if (!customer?.email) return false;
  const balance = Number(invoice.totalAmount) - Number(invoice.paidAmount || 0);
  const html = wrap(`Payment Reminder — Invoice ${invoice.invoiceNo}`,
    `<p>Dear ${customer.name},</p>
     <p>Our records show that invoice <strong>${invoice.invoiceNo}</strong> dated ${dateStr(invoice.invoiceDate)} with an
        outstanding balance of <strong>${peso(balance)}</strong> became due on <strong>${dateStr(invoice.dueDate)}</strong>.</p>
     <p>We kindly request that you settle this at your earliest convenience. If you have already paid, please disregard this notice.</p>`);
  return sendMail({ to: customer.email, subject: `Payment reminder — Invoice ${invoice.invoiceNo}`, html });
}

async function sendPayslipEmail(employee, period, item) {
  if (!employee?.email) return false;
  const html = wrap(`Payslip — ${period?.name || ''}`,
    `<p>Dear ${employee.firstName || employee.name || 'Employee'},</p>
     <p>Your payslip for <strong>${period?.name || 'the period'}</strong> is ready.</p>
     <table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0">
       <tr><td style="padding:4px 8px">Gross Pay</td><td style="padding:4px 8px;text-align:right">${peso(item?.grossPay)}</td></tr>
       <tr><td style="padding:4px 8px">Total Deductions</td><td style="padding:4px 8px;text-align:right">${peso(item?.totalDeductions)}</td></tr>
       <tr><td style="padding:6px 8px;font-weight:700;border-top:2px solid #ddd">Net Pay</td><td style="padding:6px 8px;text-align:right;font-weight:700;border-top:2px solid #ddd">${peso(item?.netPay)}</td></tr>
     </table>
     <p style="font-size:12px;color:#6b7280">This is a system-generated payslip summary.</p>`);
  return sendMail({ to: employee.email, subject: `Your payslip — ${period?.name || 'Finara ERP'}`, html });
}

module.exports = {
  sendMail, sendPasswordReset, sendInvoiceEmail, sendAssessmentEmail, sendOverdueReminder, sendPayslipEmail,
  wrap, getTransporter, APP_URL, fillTemplate,
};
