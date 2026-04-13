const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 's13836.lon1.stableserver.net',
  port: process.env.SMTP_PORT || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmailNotification(to, subject, htmlContent) {
  try {
    await transporter.sendMail({
      from: `"Summit Registration" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html: htmlContent
    });
    console.log(`Email sent to ${to}: ${subject}`);
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error.message);
  }
}

async function sendPaymentConfirmation(regParams) {
  const { email, firstName, lastName, registrationType, amountPaid, mpesaReceiptNumber, paymentStatus, transactionId } = regParams;
  
  console.log('[Email] sendPaymentConfirmation called with:', {
    email,
    firstName,
    lastName,
    registrationId: regParams.registrationId,
    paymentStatus,
    amountPaid,
    mpesaReceiptNumber
  });
  
  let subject, html;
  
  const categoryNames = {
    kenya: 'Kenyan Delegate',
    ea: 'East African Delegate',
    exhibition: 'International Exhibition',
    sponsor: 'Sponsorship & Partnership'
  };
  const categoryLabel = categoryNames[registrationType] || (registrationType || 'Delegate');
  const currency = ['ea', 'exhibition'].includes(registrationType) ? 'USD' : 'KES';
  
  if (paymentStatus === 'pending_manual_verification') {
    // User notification when transaction code is submitted (waiting for admin verification)
    subject = 'Payment Verification Pending - Registration Portal';
    html = `
      <h2>🔍 Transaction Received - Verification in Progress</h2>
      <p>Dear ${firstName} ${lastName},</p>
      <p>Thank you for submitting your payment details. Your transaction is currently being verified by our team.</p>
      
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">📋 Transaction Details</h3>
        <ul>
          <li><strong>Registration ID:</strong> ${regParams.registrationId || 'N/A'}</li>
          <li><strong>Category:</strong> ${registrationType === 'ea' ? `${regParams.qty_physical || 0} Physical, ${regParams.qty_virtual || 0} Virtual` : categoryLabel}</li>
          <li><strong>Amount:</strong> ${currency} ${amountPaid || 'N/A'}</li>
          <li><strong>Reference:</strong> ${mpesaReceiptNumber || 'N/A'}</li>
          <li><strong>Status:</strong> <span style="color: #ffc107;">Pending Verification</span></li>
        </ul>
      </div>
      
      <p><strong>Note:</strong> Verification typically takes up to 24-48 hours. You will receive a confirmation email once approved.</p>
    `;
  } else if (paymentStatus === 'pending_verification') {
    // Bank transfer confirmation
    subject = 'Summit Registration - Bank Transfer Submitted';
    html = `
      <h2>Bank Transfer Details Received</h2>
      <p>Dear ${firstName} ${lastName},</p>
      <p>Thank you for submitting your bank transfer details for the East Africa Media Summit registration.</p>
      <ul>
        <li><strong>Category:</strong> ${registrationType === 'ea' ? `${regParams.qty_physical || 0} Physical, ${regParams.qty_virtual || 0} Virtual` : categoryLabel}</li>
        <li><strong>Amount:</strong> ${currency} ${amountPaid || 'N/A'}</li>
        <li><strong>Transaction Reference:</strong> ${transactionId || 'N/A'}</li>
        <li><strong>Status:</strong> Awaiting Verification</li>
      </ul>
      <p><strong>Important:</strong> Your registration will be confirmed once we verify your bank transfer (typically 1-3 business days).</p>
      <p>Bank Details:</p>
      <ul>
        <li><strong>Bank Name:</strong> Credit Bank PLC</li>
        <li><strong>Bank Code:</strong> 025</li>
        <li><strong>Branch Name:</strong> LAVINGTON BRANCH</li>
        <li><strong>Branch Code:</strong> 013</li>
        <li><strong>Account Name:</strong> ASSOCIATION OF PROFESSIONAL BROACASTERS</li>
        <li><strong>SWIFT Code:</strong> CRBTKENA</li>
        <li><strong>Account Number:</strong> ${currency === 'USD' ? '0131016000017' : (currency === 'EUR' ? '0131016000018' : (currency === 'GBP' ? '0131016000019' : '0131016000003'))}</li>
        <li><strong>Currency:</strong> ${currency}</li>
      </ul>
      ${currency !== 'KES' ? `
      <p><strong>Intermediary Bank Details for International Transfers:</strong></p>
      <ul>
        ${currency === 'USD' ? `
        <li><strong>Correspondent Bank:</strong> STANDARD CHARTERED BANK</li>
        <li><strong>SWIFT:</strong> SCBLUS33</li>
        <li><strong>A/C NO:</strong> 3582054451001</li>
        ` : ''}
        ${currency === 'EUR' ? `
        <li><strong>Correspondent Bank:</strong> STANDARD CHARTERED BANK</li>
        <li><strong>SWIFT:</strong> SCBLDEFX</li>
        <li><strong>IBAN:</strong> DE39512305000050008709</li>
        ` : ''}
        ${currency === 'GBP' ? `
        <li><strong>Correspondent Bank:</strong> STANDARD CHARTERED BANK</li>
        <li><strong>SWIFT:</strong> SCBLGB2L</li>
        <li><strong>A/C NO:</strong> 01250590801</li>
        ` : ''}
      </ul>
      ` : ''}
    `;
  } else if (paymentStatus === 'pending_review') {
    // M-Pesa payment requiring manual review
    subject = 'Summit Registration - Payment Under Review';
    html = `
      <h2>Payment Received - Under Review</h2>
      <p>Dear ${firstName} ${lastName},</p>
      <p>Your payment has been received and verified! However, your registration is currently under manual review due to unusual transaction patterns.</p>
      <ul>
        <li><strong>Category:</strong> ${registrationType || 'Delegate'}</li>
        <li><strong>Amount Paid:</strong> ${currency} ${amountPaid || 'N/A'}</li>
        <li><strong>Reference:</strong> ${mpesaReceiptNumber || 'N/A'}</li>
        <li><strong>Status:</strong> Under Manual Review</li>
        <li><strong>Reason:</strong> ${regParams.verificationDetails?.reviewReason || 'Security review required'}</li>
      </ul>
      <p><strong>What happens next:</strong></p>
      <ul>
        <li>Our team will manually review your transaction within 24 hours</li>
        <li>You will receive a confirmation email once approved</li>
        <li>This is a standard security procedure for unusual transactions</li>
      </ul>
      <p>Thank you for your patience and understanding.</p>
    `;
  } else {
    // M-Pesa payment confirmed (after admin approval)
    subject = '🎉 Registration Confirmed - East Africa Media Summit 2026';
    html = `
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #28a745; margin: 0;">🎉 Registration Confirmed!</h1>
        <p style="font-size: 18px; color: #6c757d; margin: 5px 0 0 0;">Your payment has been verified and approved</p>
      </div>
      
      <p>Dear <strong>${firstName} ${lastName}</strong>,</p>
      
      <p>Great news! Your M-Pesa payment has been successfully verified and your registration for the East Africa Media Summit 2026 is now <strong style="color: #28a745;">CONFIRMED</strong>.</p>
      
      <div style="background: #d4edda; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745;">
        <h3 style="margin-top: 0; color: #155724;">✅ Registration Details</h3>
        <ul>
          <li><strong>Registration ID:</strong> ${regParams.registrationId || 'N/A'}</li>
          <li><strong>Category:</strong> ${registrationType === 'ea' ? `${regParams.qty_physical || 0} Physical, ${regParams.qty_virtual || 0} Virtual` : categoryLabel}</li>
          <li><strong>Amount Paid:</strong> ${currency} ${amountPaid || 'N/A'}</li>
          <li><strong>Reference Code:</strong> ${mpesaReceiptNumber || 'N/A'}</li>
          <li><strong>Payment Status:</strong> <span style="color: #28a745; font-weight: bold;">Paid & Verified</span></li>
          <li><strong>Verification Date:</strong> ${new Date().toLocaleDateString()}</li>
        </ul>
      </div>
      
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">🎫 Event Information</h3>
        <ul>
          <li><strong>Event:</strong> East Africa Media Summit 2026</li>
          <li><strong>Date:</strong> 26 - 28 May 2026</li>
          <li><strong>Venue:</strong> Emara Ole-Sereni, Nairobi</li>
          <li><strong>Registration Status:</strong> <span style="color: #28a745; font-weight: bold;">CONFIRMED</span></li>
        </ul>
      </div>
      
      <div style="background: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #007bff;">
        <h3 style="margin-top: 0; color: #007bff;">📋 What's Next?</h3>
        <ol>
          <li><strong>Save this email</strong> - This serves as your registration confirmation</li>
          <li><strong>Bring ID</strong> - Please bring a valid ID for event check-in</li>
          <li><strong>Arrive early</strong> - Check-in opens at 8:00 AM on 26 May 2026</li>
          <li><strong>Network</strong> - Connect with media professionals from across East Africa</li>
        </ol>
      </div>
      
      <div style="text-align: center; margin: 30px 0; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px;">
        <h3 style="margin: 0 0 10px 0;">🌟 We Look Forward to Seeing You!</h3>
        <p style="margin: 0; font-size: 16px;">Join us for an inspiring summit of media leaders and innovators</p>
      </div>
      
      <p style="font-size: 12px; color: #6c757d; margin-top: 30px;">
        <strong>Questions?</strong> Contact us at info@apbke.org | +254 7XX XXX XXX
      </p>
    `;
  }
  
  await sendEmailNotification(email, subject, html);
}

async function sendAdminAlert(regParams) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
  const { paymentStatus, transactionId } = regParams;
  
  let subject, html;
  
  if (paymentStatus === 'pending_verification') {
    subject = 'New Registration - Bank Transfer Pending';
    html = `
      <h2>New Registration - Bank Transfer Submitted</h2>
      <p>A new attendee has submitted bank transfer details for registration.</p>
      <ul>
        <li><strong>Name:</strong> ${regParams.firstName} ${regParams.lastName}</li>
        <li><strong>Email:</strong> ${regParams.email}</li>
        <li><strong>Category:</strong> ${regParams.registrationType || 'Delegate'}</li>
        <li><strong>Transaction Reference:</strong> ${transactionId || 'N/A'}</li>
        <li><strong>Amount:</strong> ${currency} ${regParams.bankTransferAmount || 'N/A'}</li>
        <li><strong>Status:</strong> Awaiting Manual Verification</li>
      </ul>
      
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">🔍 Verification Required</h3>
        <p>Please check your bank records and verify if this Bank Transfer is legitimate:</p>
        <ul>
          <li>Transaction Reference: <strong>${transactionId || 'N/A'}</strong></li>
          <li>Expected Amount: <strong>${currency} ${regParams.bankTransferAmount || 'N/A'}</strong></li>
        </ul>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <p style="margin-bottom: 20px; font-weight: bold;">Choose your action:</p>
        
        <a href="${process.env.BASE_URL || 'http://localhost:3000'}/api/register/verify/${regParams.approveToken}/approve" 
           style="display: inline-block; background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 0 10px;">
          ✅ Approve Payment
        </a>
        
        <a href="${process.env.BASE_URL || 'http://localhost:3000'}/api/register/verify/${regParams.rejectToken}/reject" 
           style="display: inline-block; background: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 0 10px;">
          ❌ Reject Payment
        </a>
      </div>
      <p><strong>Action Required:</strong> Please verify the bank transfer and click above to update the registration status accordingly.</p>
    `;
  } else if (paymentStatus === 'pending_manual_verification') {
    subject = '🔍 ACTION REQUIRED: M-Pesa Transaction Verification Needed';
    html = `
      <h2>🔍 M-Pesa Payment Requires Manual Verification</h2>
      <p>A new attendee has submitted an M-Pesa transaction code that requires manual verification.</p>
      <ul>
        <li><strong>Name:</strong> ${regParams.firstName} ${regParams.lastName}</li>
        <li><strong>Email:</strong> ${regParams.email}</li>
        <li><strong>Phone:</strong> ${regParams.phone}</li>
        <li><strong>Category:</strong> ${regParams.registrationType || 'Delegate'}</li>
        <li><strong>Reference Code:</strong> ${regParams.mpesaReceiptNumber || 'N/A'}</li>
        <li><strong>Amount:</strong> ${currency} ${regParams.amountPaid || 'N/A'}</li>
        <li><strong>Registration ID:</strong> ${regParams.registrationId}</li>
      </ul>
      
      <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin-top: 0;">🔍 Verification Required</h3>
        <p>Please check your bank records and verify if this M-Pesa transaction is legitimate:</p>
        <ul>
          <li>Reference Code: <strong>${regParams.mpesaReceiptNumber || 'N/A'}</strong></li>
          <li>Expected Amount: <strong>${currency} ${regParams.amountPaid || 'N/A'}</strong></li>
          <li>Registered Phone: <strong>${regParams.phone}</strong></li>
        </ul>
      </div>
      
      <div style="text-align: center; margin: 30px 0;">
        <p style="margin-bottom: 20px; font-weight: bold;">Choose your action:</p>
        
        <a href="${process.env.BASE_URL || 'http://localhost:3000'}/api/mpesa/verify/${regParams.approveToken}/approve" 
           style="display: inline-block; background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 0 10px;">
          ✅ Approve Payment
        </a>
        
        <a href="${process.env.BASE_URL || 'http://localhost:3000'}/api/mpesa/verify/${regParams.rejectToken}/reject" 
           style="display: inline-block; background: #dc3545; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; margin: 0 10px;">
          ❌ Reject Payment
        </a>
      </div>
      
      <p style="font-size: 12px; color: #6c757d; margin-top: 30px;">
        <strong>Security Notes:</strong>
        <br>• Transaction code format has been validated
        <br>• Duplicate transaction check passed
        <br>• Suspicious pattern check passed
        <br>• Links expire in 48 hours for security
      </p>
      
      <p style="font-size: 12px; color: #6c757d;">
        If the buttons don't work, you can also manually verify by checking your bank records and updating the registration status.
      </p>
    `;
  } else if (paymentStatus === 'pending_review') {
    subject = '🚨 ATTENTION: Registration Requires Manual Review';
    html = `
      <h2>🚨 Suspicious Transaction - Manual Review Required</h2>
      <p>A registration has been flagged for manual review due to unusual transaction patterns.</p>
      <ul>
        <li><strong>Name:</strong> ${regParams.firstName} ${regParams.lastName}</li>
        <li><strong>Email:</strong> ${regParams.email}</li>
        <li><strong>Phone:</strong> ${regParams.phone}</li>
        <li><strong>Category:</strong> ${regParams.registrationType || 'Delegate'}</li>
        <li><strong>Reference Code:</strong> ${regParams.mpesaReceiptNumber || 'N/A'}</li>
        <li><strong>Amount:</strong> ${currency} ${regParams.amountPaid || 'N/A'}</li>
        <li><strong>Payment Phone:</strong> ${regParams.verificationDetails?.transactionPhone || 'N/A'}</li>
        <li><strong>Registration Phone:</strong> ${regParams.phone}</li>
        <li><strong>Review Reason:</strong> ${regParams.verificationDetails?.reviewReason || 'Unknown'}</li>
        <li><strong>Time to Confirm:</strong> ${Math.round((new Date() - new Date(regParams.registrationDate)) / (1000 * 60))} minutes</li>
      </ul>
      <p><strong>🚨 ACTION REQUIRED:</strong></p>
      <ul>
        <li>Review the transaction details above</li>
        <li>Verify if this payment is legitimate</li>
        <li>Update registration status to "paid" if approved</li>
        <li>Contact the registrant if clarification is needed</li>
      </ul>
      <p><strong>Verification Details:</strong></p>
      <pre>${JSON.stringify(regParams.verificationDetails, null, 2)}</pre>
    `;
  } else {
    subject = 'New Registration Completed - M-Pesa Payment Confirmed';
    html = `
      <h2>New Registration Completed</h2>
      <p>A new attendee has successfully completed registration with M-Pesa payment.</p>
      <ul>
        <li><strong>Name:</strong> ${regParams.firstName} ${regParams.lastName}</li>
        <li><strong>Email:</strong> ${regParams.email}</li>
        <li><strong>Category:</strong> ${regParams.registrationType || 'Delegate'}</li>
        <li><strong>Reference Code:</strong> ${regParams.mpesaReceiptNumber || 'N/A'}</li>
        <li><strong>Amount:</strong> ${currency} ${regParams.amountPaid || 'N/A'}</li>
        <li><strong>Payment Method:</strong> M-Pesa (Auto-Verified)</li>
        <li><strong>Status:</strong> Paid & Confirmed</li>
      </ul>
      <p><strong>Security Checks Passed:</strong></p>
      <ul>
        <li>✅ Phone number verification</li>
        <li>✅ Amount verification</li>
        <li>✅ Duplicate transaction check</li>
        <li>✅ Timeout validation</li>
      </ul>
    `;
  }
  
  await sendEmailNotification(adminEmail, subject, html);
}

module.exports = {
  sendEmailNotification,
  sendPaymentConfirmation,
  sendAdminAlert
};
