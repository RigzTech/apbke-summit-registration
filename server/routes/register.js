const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { sendPaymentConfirmation, sendAdminAlert } = require('../services/notifier');

const DATA_FILE = path.join(__dirname, '../data/registrations.json');

function loadRegistrations() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return []; }
}
function saveRegistrations(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

router.post('/', (req, res) => {
  try {
    const data = req.body;
    const registrations = loadRegistrations();
    
    let registrationId = data.registrationId;
    let newReg;

    if (registrationId) {
      // Update existing registration
      const idx = registrations.findIndex(r => r.registrationId === registrationId);
      if (idx !== -1) {
        newReg = {
          ...registrations[idx],
          ...data,
          updatedDate: new Date().toISOString()
        };
        registrations[idx] = newReg;
        console.log('[Registration] Updated record:', registrationId);
      } else {
        return res.status(404).json({ success: false, message: 'Registration ID not found.' });
      }
    } else {
      // Create new registration
      const currentYear = new Date().getFullYear();
      const idNum = String(registrations.length + 1).padStart(4, '0');
      registrationId = `REG-${currentYear}-${idNum}`;
      
      console.log('[Registration] Generated ID:', registrationId, 'for:', data.firstName, data.lastName);
      
      newReg = {
        ...data,
        registrationId,
        registrationDate: new Date().toISOString(),
        paymentStatus: 'pending'
      };
      registrations.push(newReg);
    }

    saveRegistrations(registrations);
    return res.json({ success: true, registrationId });
  } catch (err) {
    console.error('Registration Error:', err);
    return res.status(500).json({ success: false, message: 'Registration failed.' });
  }
});

// POST /api/register/bank-transfer
router.post('/bank-transfer', (req, res) => {
  try {
    const { registrationId, transactionId, amount, paymentMethod } = req.body;

    if (!registrationId || !transactionId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Registration ID and transaction reference are required.' 
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

    // Generate secure verification tokens
    const crypto = require('crypto');
    const approveToken = crypto.randomBytes(32).toString('hex');
    const rejectToken = crypto.randomBytes(32).toString('hex');

    // Update registration with bank transfer details
    registrations[idx].paymentMethod = paymentMethod || 'bank';
    registrations[idx].transactionId = transactionId;
    registrations[idx].bankTransferAmount = amount;
    registrations[idx].paymentStatus = 'pending_verification'; // Awaiting manual verification
    registrations[idx].bankTransferDate = new Date().toISOString();

    // Store verification tokens
    registrations[idx].verificationTokens = {
      approve: approveToken,
      reject: rejectToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
    };

    saveRegistrations(registrations);

    // Send notification emails
    const reg = {
      ...registrations[idx],
      approveToken: approveToken,
      rejectToken: rejectToken
    };
    sendPaymentConfirmation(reg).catch(e => console.error('[Bank Transfer] Email fail:', e.message));
    sendAdminAlert(reg).catch(e => console.error('[Bank Transfer] Admin alert fail:', e.message));

    return res.json({ 
      success: true, 
      message: 'Bank transfer details submitted successfully. Your registration will be confirmed once payment is verified.',
      registrationId 
    });
  } catch (err) {
    console.error('Bank Transfer Error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to process bank transfer details.' 
    });
  }
});

// GET /api/register/verify/:token/:action (approve/reject bank transfer)
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
          </body>
        </html>
      `);
    }

    // Check expiration
    if (registration.verificationTokens.expiresAt && new Date(registration.verificationTokens.expiresAt) < new Date()) {
      return res.status(400).send(`
        <html>
          <head><title>Token Expired</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #ffc107;">⏰ Token Expired</h1>
            <p>This verification link has expired.</p>
          </body>
        </html>
      `);
    }

    const isApprove = action === 'approve';
    const expectedToken = isApprove ? registration.verificationTokens.approve : registration.verificationTokens.reject;
    
    if (token !== expectedToken) {
      return res.status(400).send(`
        <html>
          <head><title>Invalid Action</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Invalid Action</h1>
          </body>
        </html>
      `);
    }

    const idx = registrations.findIndex(r => r.registrationId === registration.registrationId);
    
    if (isApprove) {
      // Approve the payment
      registrations[idx].paymentStatus = 'paid';
      registrations[idx].verifiedBy = 'admin_email';
      registrations[idx].verifiedAt = new Date().toISOString();
      registrations[idx].verificationTokens = null; // Clear tokens
      
      saveRegistrations(registrations);
      
      // We will pretend we have a mpesaReceiptNumber mapped from transactionId so the success email template works seamlessly
      const emailParams = { ...registrations[idx], mpesaReceiptNumber: registrations[idx].transactionId || 'EFT-APPROVED', amountPaid: registrations[idx].bankTransferAmount };
      sendPaymentConfirmation(emailParams).catch(e => console.error('[Bank Transfer Approval] Email fail:', e.message));
      
      return res.send(`
        <html>
          <head><title>Bank Transfer Approved</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #28a745;">✅ Bank Transfer Approved</h1>
            <p>The payment for <strong>${registration.firstName} ${registration.lastName}</strong> has been verified.</p>
            <p>Transaction Reference: <strong>${registration.transactionId}</strong></p>
            <p>Amount: <strong>KES ${registration.bankTransferAmount}</strong></p>
          </body>
        </html>
      `);
    } else {
      // Reject the payment
      registrations[idx].paymentStatus = 'rejected';
      registrations[idx].rejectionReason = 'Admin rejected via email verification';
      registrations[idx].verifiedBy = 'admin_email';
      registrations[idx].verifiedAt = new Date().toISOString();
      registrations[idx].verificationTokens = null;
      
      saveRegistrations(registrations);
      
      return res.send(`
        <html>
          <head><title>Bank Transfer Rejected</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h1 style="color: #dc3545;">❌ Bank Transfer Rejected</h1>
            <p>The payment for <strong>${registration.firstName} ${registration.lastName}</strong> has been rejected.</p>
            <p>Transaction Reference: <strong>${registration.transactionId}</strong></p>
          </body>
        </html>
      `);
    }

  } catch (err) {
    console.error('Bank Transfer Verification error:', err);
    return res.status(500).send('An error occurred during verification.');
  }
});

// GET /api/register/:registrationId - Lookup registration by ID
router.get('/:registrationId', (req, res) => {
  try {
    const { registrationId } = req.params;
    const registrations = loadRegistrations();
    const registration = registrations.find(r => r.registrationId === registrationId);
    
    if (!registration) {
      return res.status(404).json({ 
        success: false, 
        message: 'Registration not found.' 
      });
    }
    
    // Return registration details (excluding sensitive data)
    const publicDetails = {
      registrationId: registration.registrationId,
      firstName: registration.firstName,
      lastName: registration.lastName,
      email: registration.email,
      phone: registration.phone,
      registrationType: registration.registrationType,
      county: registration.county,
      gender: registration.gender,
      ageRange: registration.ageRange,
      organization: registration.organization,
      position: registration.position,
      registrationDate: registration.registrationDate,
      paymentStatus: registration.paymentStatus,
      amountPaid: registration.amountPaid,
      paymentMethod: registration.paymentMethod
    };
    
    return res.json({ 
      success: true, 
      registration: publicDetails 
    });
    
  } catch (err) {
    console.error('Registration Lookup Error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to lookup registration.' 
    });
  }
});

module.exports = router;
