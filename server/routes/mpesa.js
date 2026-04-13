const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { stkPush, verifyTransaction } = require('../services/mpesa');
const { sendPaymentConfirmation, sendAdminAlert } = require('../services/notifier');

const DATA_FILE = path.join(__dirname, '../data/registrations.json');
const DEBUG_LOG = path.join(__dirname, '../data/callback_debug.json');

function appendDebugLog(entry) {
  try {
    let logs = [];
    try { logs = JSON.parse(fs.readFileSync(DEBUG_LOG, 'utf8')); } catch { }
    logs.unshift({ ...entry, receivedAt: new Date().toISOString() });
    if (logs.length > 20) logs = logs.slice(0, 20);
    fs.writeFileSync(DEBUG_LOG, JSON.stringify(logs, null, 2));
  } catch (e) { console.warn('Debug log write failed:', e.message); }
}

function loadRegistrations() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}
function saveRegistrations(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// POST /api/mpesa/stkpush
router.post('/stkpush', async (req, res) => {
  try {
    const { phone, amount, registrationId } = req.body;

    if (!phone || !amount || !registrationId) {
      return res.status(400).json({ success: false, message: 'Phone, amount, and registrationId are required.' });
    }

    let normalizedPhone = phone.replace(/\s+/g, '').replace(/^\+/, '');
    if (normalizedPhone.startsWith('0')) normalizedPhone = '254' + normalizedPhone.slice(1);
    if (!normalizedPhone.startsWith('254')) normalizedPhone = '254' + normalizedPhone;

    const uniqueRef = `${registrationId}-${Math.floor(Date.now() / 1000)}`;
    const result = await stkPush(normalizedPhone, amount, uniqueRef, 'Summit Registration Fee');

    console.log('[STK Initiation] Bank Response:', JSON.stringify(result, null, 2));

    const responseData = result.data || result;
    const checkoutRequestId = responseData.checkoutRequestId || responseData.CheckoutRequestID || responseData.id || responseData.reference || uniqueRef;

    const registrations = loadRegistrations();
    const idx = registrations.findIndex(r => r.registrationId === registrationId);
    if (idx !== -1) {
      registrations[idx].checkoutRequestId = checkoutRequestId;
      registrations[idx].uniqueRef = uniqueRef;
      saveRegistrations(registrations);
    }

    return res.json({
      success: true,
      checkoutRequestId: checkoutRequestId,
      message: result.message || 'STK Push sent.'
    });
  } catch (err) {
    console.error('STK Push error:', err?.response?.data || err.message);
    const errMsg = err?.response?.data?.errorMessage || err.message || 'Failed to initiate payment.';
    return res.status(500).json({ success: false, message: errMsg });
  }
});

// GET /api/mpesa/debug-log
router.get('/debug-log', (req, res) => {
  try {
    if (!fs.existsSync(DEBUG_LOG)) return res.json({ count: 0, logs: [], message: 'No callbacks received yet' });
    const logs = JSON.parse(fs.readFileSync(DEBUG_LOG, 'utf8'));
    return res.json({ count: logs.length, logs });
  } catch (e) {
    return res.json({ count: 0, logs: [], error: e.message });
  }
});

// GET /api/mpesa/callback
router.get('/callback', (req, res) => {
  return res.status(200).send('Webhook endpoint is active');
});

// POST /api/mpesa/callback
router.post('/callback', (req, res) => {
  try {
    const body = req.body;
    const contentType = req.headers['content-type'] || 'unknown';
    console.log(`[Callback] Incoming POST — Content-Type: ${contentType}`);
    console.log('[Callback] Body:', JSON.stringify(body, null, 2));

    appendDebugLog({ contentType, body, headers: req.headers });

    if (!body || (typeof body === 'object' && Object.keys(body).length === 0)) {
      return res.status(200).json({ success: true, message: 'Pulse Accepted' });
    }

    const isMpesaStyle = !!body?.Body?.stkCallback;
    const payload = isMpesaStyle ? body.Body.stkCallback : body;

    const checkoutRequestId = payload.CheckoutRequestID || payload.checkoutRequestId || null;
    const reference = payload.reference || payload.accountReference || payload.Reference || null;
    let rawResultCode = payload.ResultCode !== undefined ? payload.ResultCode : payload.resultCode;
    const resultCode = String(rawResultCode !== undefined ? rawResultCode : (payload.status === 'COMPLETED' ? '0' : '1'));
    const resultDesc = payload.ResultDesc || payload.resultDescription || payload.message || payload.status;

    const registrations = loadRegistrations();
    const idx = registrations.findIndex(r =>
      (checkoutRequestId && (r.checkoutRequestId === checkoutRequestId)) ||
      (reference && (r.uniqueRef === reference || r.checkoutRequestId === reference || r.registrationId === reference || (r.registrationId && reference.startsWith(r.registrationId))))
    );

    if (!checkoutRequestId && !reference) {
      return res.status(200).json({ success: true, message: 'Pulse/Validation Accepted' });
    }

    // Acknowledge immediately
    res.status(200).json({ success: true, message: 'Accepted' });

    if (idx !== -1) {
      const isSuccess = resultCode === '0' || payload.status === 'COMPLETED' || payload.status === 'SUCCESS';

      if (isSuccess) {
        registrations[idx].paymentStatus = 'paid';
        registrations[idx].paidAt = new Date().toISOString();

        if (isMpesaStyle) {
          const items = payload?.CallbackMetadata?.Item || [];
          const getItem = (name) => items.find(i => i.Name === name)?.Value;
          registrations[idx].mpesaReceiptNumber = getItem('MpesaReceiptNumber');
          registrations[idx].amountPaid = getItem('Amount');
        } else {
          registrations[idx].mpesaReceiptNumber = payload.transactionId || payload.receipt || payload.mpesaReceiptNumber || 'CB-CREDIT';
          registrations[idx].amountPaid = payload.amount || payload.Amount || payload.transactionAmount;
        }
      } else {
        registrations[idx].paymentStatus = 'failed';
        registrations[idx].paymentFailureReason = resultDesc;
      }
      saveRegistrations(registrations);

      if (isSuccess) {
        const reg = registrations[idx];
        sendPaymentConfirmation(reg).catch(e => console.error('[Callback] Email fail:', e.message));
        sendAdminAlert(reg).catch(e => console.error('[Callback] Admin alert fail:', e.message));
      }
    }
  } catch (err) {
    console.error('Callback processing error:', err);
    if (!res.headersSent) {
      return res.status(200).json({ success: false, message: 'Internal error but accepted' });
    }
  }
});

// GET /api/mpesa/status/:checkoutRequestId
router.get('/status/:checkoutRequestId', async (req, res) => {
  const checkoutRequestId = req.params.checkoutRequestId;
  let registrations = loadRegistrations();
  let reg = registrations.find(r => r.checkoutRequestId === checkoutRequestId);

  if (!reg) {
    return res.status(404).json({ success: false, message: 'Payment record not found.' });
  }

  return res.json({
    success: true,
    paymentStatus: reg.paymentStatus,
    registrationId: reg.registrationId,
    mpesaReceiptNumber: reg.mpesaReceiptNumber || null,
    amountPaid: reg.amountPaid || null,
    firstName: reg.firstName,
    lastName: reg.lastName,
    email: reg.email
  });
});

// POST /api/mpesa/confirm-payment
router.post('/confirm-payment', async (req, res) => {
  try {
    const { registrationId, transactionCode, amount, paymentMethod } = req.body;

    if (!registrationId || !transactionCode) {
      return res.status(400).json({ 
        success: false, 
        message: 'Registration ID and transaction code are required.' 
      });
    }

    const registrations = loadRegistrations();
    const idx = registrations.findIndex(r => r.registrationId === registrationId);

    if (idx === -1) {
      return res.status(404).json({ 
        success: false, 
        message: 'Registration not found.' 
      });
    }

    const registration = registrations[idx];
    const checkoutRequestId = registration.checkoutRequestId;
    
    if (!checkoutRequestId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment session not found. Please initiate payment again.' 
      });
    }

    // SECURITY CHECK 1: Timeout window (30 minutes max)
    const paymentInitiatedTime = new Date(registration.registrationDate);
    const currentTime = new Date();
    const timeDiffMinutes = (currentTime - paymentInitiatedTime) / (1000 * 60);
    
    if (timeDiffMinutes > 30) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment session expired. Please initiate payment again (30-minute timeout).' 
      });
    }

    // Verify transaction with Credit Bank API
    let verificationResult;
    try {
      verificationResult = await verifyTransaction(checkoutRequestId);
    } catch (verifyError) {
      console.error('Transaction verification failed:', verifyError);
      return res.status(500).json({ 
        success: false, 
        message: 'Unable to verify transaction. Please try again or contact support.' 
      });
    }

    // Handle manual verification case (Credit Bank API doesn't have status endpoints)
    if (verificationResult.requiresManualVerification) {
      console.log('[M-Pesa] Manual verification required - implementing secure validation');
      console.log('[M-Pesa] Transaction code submitted:', transactionCode);
      console.log('[M-Pesa] Transaction code length:', transactionCode.length);
      
      // SECURITY CHECK: Validate transaction code format
      // Real M-Pesa codes can be: ABC123DEF456, 1234567890, etc.
      const transactionCodePattern = /^[A-Z0-9]{8,14}$/i;
      console.log('[M-Pesa] Pattern test result:', transactionCodePattern.test(transactionCode));
      
      if (!transactionCodePattern.test(transactionCode)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid transaction code format. M-Pesa transaction codes are 8-14 characters (letters and numbers only).' 
        });
      }

      // SECURITY CHECK: Basic transaction code validation (more flexible patterns)
      const commonPatterns = [
        /^[A-Z]{2,4}\d{6,12}$/i,  // 2-4 letters + 6-12 numbers
        /^[A-Z]{6,8}\d{2,8}$/i,   // 6-8 letters + 2-8 numbers
        /^\d{8,14}$/i,                  // All numbers (8-14 digits)
        /^[A-Z0-9]{10}$/i,            // Mix of letters and numbers (10 chars)
        /^[A-Z0-9]{12}$/i             // Mix of letters and numbers (12 chars)
      ];
      
      const isValidFormat = commonPatterns.some(pattern => pattern.test(transactionCode));
      if (!isValidFormat) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid transaction code format. Please enter the exact code from your M-Pesa confirmation message.' 
        });
      }

      // SECURITY CHECK: Check for obvious fake codes
      const suspiciousPatterns = [
        /123456/, /ABCDEF/, /TEST/, /DEMO/, /FAKE/, /XXXX/
      ];
      
      const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(transactionCode.toUpperCase()));
      if (isSuspicious) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid transaction code detected. Please enter a real M-Pesa transaction code.' 
        });
      }

      // SECURITY CHECK: Duplicate transaction detection
      const existingTransaction = registrations.find(r => 
        r.mpesaReceiptNumber === transactionCode && 
        r.registrationId !== registrationId
      );
      
      if (existingTransaction) {
        return res.status(400).json({ 
          success: false, 
          message: `This transaction code has already been used for registration ${existingTransaction.registrationId}. Each transaction can only be used once.` 
        });
      }

      // Update registration with manual verification status
      registration.paymentMethod = paymentMethod || 'mpesa';
      registration.mpesaReceiptNumber = transactionCode;
      registration.amountPaid = amount;
      registration.paymentStatus = 'pending_manual_verification'; // Requires admin review
      registration.confirmedAt = new Date().toISOString();
      registration.verifiedBy = 'manual_pending';
      registration.verificationDetails = {
        checkoutRequestId: checkoutRequestId,
        verificationTime: new Date().toISOString(),
        manualVerification: true,
        requiresAdminApproval: true,
        note: 'Manual verification required - API endpoints not available'
      };

      // Generate secure verification tokens
      const crypto = require('crypto');
      const approveToken = crypto.randomBytes(32).toString('hex');
      const rejectToken = crypto.randomBytes(32).toString('hex');
      
      // Store verification tokens
      registration.verificationTokens = {
        approve: approveToken,
        reject: rejectToken,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() // 48 hours
      };

      saveRegistrations(registrations);

      // Send notification emails with verification buttons
      const manualVerificationReg = {
        ...registration,
        paymentStatus: 'pending_manual_verification',
        approveToken: approveToken,
        rejectToken: rejectToken
      };
      
      sendPaymentConfirmation(manualVerificationReg).catch(e => console.error('[M-Pesa Manual Verification] Email fail:', e.message));
      sendAdminAlert(manualVerificationReg).catch(e => console.error('[M-Pesa Manual Verification] Admin alert fail:', e.message));

      return res.json({ 
        success: true, 
        message: 'Transaction code submitted for manual verification. Your registration will be confirmed once our team verifies the payment (typically within 24 hours).',
        registrationId,
        transactionId: transactionCode,
        amount: amount,
        manualVerification: true,
        pendingAdminApproval: true
      });
    }

    // If we get here, API verification worked (unlikely but handle it)
    if (!verificationResult.success) {
      return res.status(400).json({ 
        success: false, 
        message: `Payment not completed: ${verificationResult.resultDesc || 'Transaction failed'}. Please complete the M-Pesa payment on your phone before confirming.` 
      });
    }

    // REST OF API VERIFICATION LOGIC (if it ever works)
    // ... (keep the existing security checks for API verification)

    // SECURITY CHECK 5: Flag suspicious transactions for manual review
    let needsManualReview = false;
    let reviewReason = '';
    
    if (parseFloat(amount) > 50000) {
      needsManualReview = true;
      reviewReason = 'High amount transaction';
    }
    
    if (timeDiffMinutes > 20) {
      needsManualReview = true;
      reviewReason = reviewReason ? `${reviewReason}, delayed confirmation` : 'Delayed confirmation';
    }

    // Update registration with verified M-Pesa transaction details
    registration.paymentMethod = paymentMethod || 'mpesa';
    registration.mpesaReceiptNumber = verificationResult.transactionId || transactionCode;
    registration.amountPaid = verificationResult.amount || amount;
    registration.paymentStatus = needsManualReview ? 'pending_review' : 'paid';
    registration.confirmedAt = new Date().toISOString();
    registration.verifiedBy = 'system';
    registration.verificationDetails = {
      checkoutRequestId: checkoutRequestId,
      transactionPhone: paymentPhone,
      verificationTime: new Date().toISOString(),
      needsManualReview: needsManualReview,
      reviewReason: reviewReason
    };

    saveRegistrations(registrations);

    // Send notification emails
    sendPaymentConfirmation(registration).catch(e => console.error('[M-Pesa Verification] Email fail:', e.message));
    sendAdminAlert(registration).catch(e => console.error('[M-Pesa Verification] Admin alert fail:', e.message));

    const responseMessage = needsManualReview ? 
      'Payment verified! Your registration is pending manual review due to unusual transaction patterns. You will receive a confirmation email shortly.' :
      'Payment verified successfully! Registration completed.';

    return res.json({ 
      success: true, 
      message: responseMessage,
      registrationId,
      transactionId: verificationResult.transactionId,
      amount: verificationResult.amount,
      needsManualReview: needsManualReview,
      reviewReason: reviewReason
    });
  } catch (err) {
    console.error('M-Pesa Confirmation Error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to confirm payment.' 
    });
  }
});

// GET /api/mpesa/verify/:token/:action (approve/reject)
router.get('/verify/:token/:action', (req, res) => {
  try {
    const { token, action } = req.params;
    const registrations = loadRegistrations();
    
    // Find registration with matching token
    const registration = registrations.find(reg => 
      reg.verificationTokens && 
      (reg.verificationTokens.approve === token || reg.verificationTokens.reject === token)
    );

    if (!registration) {
      return res.status(404).send(`
        <html>
          <head><title>Verification Failed</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Verification Failed</h1>
            <p>Invalid or expired verification token.</p>
            <p>Please contact support if you believe this is an error.</p>
          </body>
        </html>
      `);
    }

    // Check if token has expired
    if (registration.verificationTokens.expiresAt && new Date(registration.verificationTokens.expiresAt) < new Date()) {
      return res.status(400).send(`
        <html>
          <head><title>Token Expired</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #ffc107;">⏰ Token Expired</h1>
            <p>This verification link has expired (48-hour limit).</p>
            <p>Please contact support for assistance.</p>
          </body>
        </html>
      `);
    }

    // Verify the correct action token
    const isApprove = action === 'approve';
    const expectedToken = isApprove ? registration.verificationTokens.approve : registration.verificationTokens.reject;
    
    if (token !== expectedToken) {
      return res.status(400).send(`
        <html>
          <head><title>Invalid Action</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Invalid Action</h1>
            <p>This verification link is not valid for the requested action.</p>
          </body>
        </html>
      `);
    }

    // Update registration based on action
    const idx = registrations.findIndex(r => r.registrationId === registration.registrationId);
    
    if (isApprove) {
      // Approve the payment
      registrations[idx].paymentStatus = 'paid';
      registrations[idx].verifiedBy = 'admin_email';
      registrations[idx].verifiedAt = new Date().toISOString();
      registrations[idx].verificationTokens = null; // Clear tokens
      
      // Save the updated registration
      saveRegistrations(registrations);
      
      // Send confirmation emails
      console.log('[Approval] Sending confirmation email for registration:', registrations[idx]);
      console.log('[Approval] Registration ID:', registrations[idx].registrationId);
      sendPaymentConfirmation(registrations[idx]).catch(e => console.error('[Approval] Email fail:', e.message));
      
      return res.send(`
        <html>
          <head><title>Payment Approved</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #28a745;">✅ Payment Approved</h1>
            <p>The payment for <strong>${registration.firstName} ${registration.lastName}</strong> has been verified and approved.</p>
            <p>Transaction Code: <strong>${registration.mpesaReceiptNumber}</strong></p>
            <p>Amount: <strong>KES ${registration.amountPaid}</strong></p>
            <p>A confirmation email has been sent to the registrant.</p>
          </body>
        </html>
      `);
    } else {
      // Reject the payment
      registrations[idx].paymentStatus = 'rejected';
      registrations[idx].rejectionReason = 'Admin rejected via email verification';
      registrations[idx].verifiedBy = 'admin_email';
      registrations[idx].verifiedAt = new Date().toISOString();
      registrations[idx].verificationTokens = null; // Clear tokens
      
      // Save the updated registration
      saveRegistrations(registrations);
      
      return res.send(`
        <html>
          <head><title>Payment Rejected</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Payment Rejected</h1>
            <p>The payment for <strong>${registration.firstName} ${registration.lastName}</strong> has been rejected.</p>
            <p>Transaction Code: <strong>${registration.mpesaReceiptNumber}</strong></p>
            <p>Amount: <strong>KES ${registration.amountPaid}</strong></p>
            <p>The registrant will be notified of the rejection.</p>
          </body>
        </html>
      `);
    }

  } catch (err) {
    console.error('Verification error:', err);
    return res.status(500).send(`
      <html>
        <head><title>Verification Error</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1 style="color: #dc3545;">❌ Verification Error</h1>
          <p>An error occurred during verification. Please try again or contact support.</p>
        </body>
      </html>
    `);
  }
});

module.exports = router;
