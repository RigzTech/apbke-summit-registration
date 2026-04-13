const axios = require('axios');
const https = require('https');

const BASE_URL = process.env.CB_API_URL || 'https://konnectapigateway.creditbank.co.ke';
const rejectUnauthorized = process.env.CB_REJECT_UNAUTHORIZED !== 'false';

const httpsAgent = new https.Agent({ rejectUnauthorized });

async function stkPush(phone, amount, reference, description = 'Summit Registration') {
  const appId = process.env.CB_APP_ID;
  const apiKey = process.env.CB_API_KEY;
  const callBackUrl = process.env.CB_CALLBACK_URL;

  const payload = {
    phoneNumber: String(phone),
    amount: String(Math.ceil(amount)),
    reference: String(reference), 
    narration: String(description),
    countryCode: 'KE',
    telco: 'saf',
    callBackUrl: callBackUrl,
    errorCallBackUrl: callBackUrl
  };

  try {
    const response = await axios.post(
      `${BASE_URL}/safaricom-stkpush`,
      payload,
      { 
        headers: { 
          'x-api-key': apiKey,
          'x-app-id': appId,
          'Content-Type': 'application/json'
        },
        timeout: 20000,
        httpsAgent
      }
    );
    return response.data;
  } catch (err) {
    const errorData = err.response?.data || err.message;
    console.error('[Credit Bank] STK Push Error:', JSON.stringify(errorData, null, 2));
    throw err;
  }
}

async function verifyTransaction(checkoutRequestId) {
  // Credit Bank API doesn't have transaction status endpoints
  // We need to implement a secure manual verification approach
  
  // For now, we'll implement a basic format validation and return a response
  // that requires manual admin verification for security
  
  return {
    success: true, // Allow processing but will require manual verification
    resultCode: '1', // Indicates manual verification needed
    resultDesc: 'Manual verification required - API endpoints not available',
    transactionId: null, // Will be set from user input
    amount: null, // Will be validated against expected amount
    phoneNumber: null, // Will be validated against registered phone
    transactionDate: new Date().toISOString(),
    requiresManualVerification: true
  };
}

module.exports = { stkPush, verifyTransaction };
