/**
 * form-script-fixed.js — Multi-step registration form logic + M-Pesa STK Push
 * Fixed with proper error handling for 503 errors
 */

// ─── State ────────────────────────────────────────────────────
const PRICES = { sponsor: 150000, delegate: 15000 };
let currentStep = 1;
let registrationId = null;
let checkoutRequestId = null;
let pollInterval = null;
let pollAttempts = 0;
const MAX_POLL_ATTEMPTS = 30;

// Read registration type from URL
const params = new URLSearchParams(window.location.search);
const regType = (params.get('type') || 'delegate').toLowerCase();
const regAmount = PRICES[regType];

// ─── Helper Functions ───────────────────────────────────
async function safeFetch(url, options = {}) {
  try {
    const response = await fetch(url, options);
    
    // Check if response is OK and is JSON
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      if (text.includes('<!DOCTYPE') || text.includes('<html')) {
        throw new Error('Server is returning HTML instead of JSON. The server may not be running.');
      }
      throw new Error('Server is not returning JSON data');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Fetch error:', error);
    throw error;
  }
}

// ─── DOM Elements ───────────────────────────────────────
const stepIndicators = document.querySelectorAll('.step-indicator');
const steps = document.querySelectorAll('.form-step');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const mpesaModal = document.getElementById('payment-modal');
const closeModal = document.getElementById('closeModal');
const mpesaPhone = document.getElementById('mpesaPhone');
const mpesaAmount = document.getElementById('mpesaAmount');
const btnMpesa = document.getElementById('btn-mpesa');
const btnBank = document.getElementById('btn-bank');
const mpesaSection = document.getElementById('mpesa-section');
const bankSection = document.getElementById('bank-section');
const paymentStatus = document.getElementById('payment-status');
const modalTitle = document.getElementById('modal-title');
const modalMessage = document.getElementById('modal-message');
const modalActions = document.getElementById('modal-actions');
const btnMpesaConfirm = document.getElementById('btn-mpesa-confirm');
const btnBankConfirm = document.getElementById('btn-bank-confirm');

// ─── Event Listeners ───────────────────────────────────
prevBtn?.addEventListener('click', () => changeStep(-1));
nextBtn?.addEventListener('click', () => changeStep(1));
closeModal?.addEventListener('click', closeModalHandler);
window.addEventListener('load', () => {
  updateStepIndicators();
  updateNavigationButtons();
});
btnMpesa?.addEventListener('click', () => selectPaymentMethod('mpesa'));
btnBank?.addEventListener('click', () => selectPaymentMethod('bank'));
btnMpesaConfirm?.addEventListener('click', initMpesaPayment);
btnBankConfirm?.addEventListener('click', confirmBankTransfer);

// ─── Step Navigation ───────────────────────────────
function changeStep(direction) {
  const target = currentStep + direction;
  if (target < 1 || target > 3) return;
  
  const isValid = validateStep(currentStep);
  if (!isValid && direction > 0) return;
  
  if (direction > 0) saveStepData(currentStep);
  
  document.querySelector(`.form-step[data-step="${currentStep}"]`).classList.remove('active');
  document.querySelector(`.form-step[data-step="${target}"]`).classList.add('active');
  currentStep = target;
  
  updateStepIndicators();
  updateNavigationButtons();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  
  if (target === 2) fillVerification();
  if (target === 3) fillSummary();
}

function updateStepIndicators() {
  stepIndicators.forEach((indicator, index) => {
    indicator.classList.toggle('active', index + 1 === currentStep);
    indicator.classList.toggle('completed', index + 1 < currentStep);
  });
}

function updateNavigationButtons() {
  prevBtn.style.display = currentStep === 1 ? 'none' : 'block';
  nextBtn.textContent = currentStep === 3 ? 'Submit Registration &nbsp;📤' : 'Next Step &nbsp;→';
}

// ─── Validation ───────────────────────────────────────
function validateStep(step) {
  if (step === 1) {
    const required = ['firstName', 'lastName', 'email', 'phone', 'county', 'ageRange', 'organization', 'position'];
    return required.every(id => document.getElementById(id)?.value?.trim());
  }
  if (step === 2) {
    const selectedMethod = document.querySelector('input[name="paymentMethod"]:checked');
    return selectedMethod !== undefined;
  }
  return true;
}

function saveStepData(step) {
  if (step === 1) {
    const data = {
      firstName: document.getElementById('firstName').value,
      lastName: document.getElementById('lastName').value,
      email: document.getElementById('email').value,
      phone: document.getElementById('phone').value,
      gender: document.getElementById('gender').value,
      county: document.getElementById('county').value,
      ageRange: document.getElementById('ageRange').value,
      organization: document.getElementById('organization').value,
      position: document.getElementById('position').value,
      registrationType: regType
    };
    console.log('Step 1 data saved:', data);
  }
}

// ─── Verification Display ───────────────────────────────
function fillVerification() {
  document.getElementById('v-name').textContent = `${document.getElementById('firstName').value} ${document.getElementById('lastName').value}`;
  document.getElementById('v-email-val').textContent = document.getElementById('email').value;
  document.getElementById('v-contact').textContent = document.getElementById('phone').value;
  document.getElementById('v-org').textContent = document.getElementById('organization').value;
  document.getElementById('v-job').textContent = document.getElementById('position').value;
  document.getElementById('v-address').textContent = `${document.getElementById('county').value} County`;
  document.getElementById('v-county').textContent = document.getElementById('county').value;
  document.getElementById('v-age-range').textContent = document.getElementById('ageRange').value;
}

// ─── Summary ─────────────────────────────────────────────────
function fillSummary() {
  const fn = document.getElementById('firstName').value;
  const ln = document.getElementById('lastName').value;
  document.getElementById('s-type').textContent = regType.charAt(0).toUpperCase() + regType.slice(1);
  document.getElementById('s-amount').textContent = `KSh ${regAmount.toLocaleString()}`;
  
  if (registrationId) {
    document.getElementById('s-reg-id').textContent = registrationId;
  }

  const phone = document.getElementById('phone').value;
  mpesaPhone.value = phone;
  mpesaAmount.value = regAmount;
}

// ─── Payment Method Selection ───────────────────────────────
function selectPaymentMethod(method) {
  document.querySelectorAll('.payment-card').forEach(card => {
    card.classList.remove('selected');
  });
  
  const selectedCard = document.querySelector(`[onclick="selectPaymentMethod('${method}')"]`);
  selectedCard.classList.add('selected');
  
  if (method === 'mpesa') {
    mpesaSection.style.display = 'block';
    bankSection.style.display = 'none';
  } else if (method === 'bank') {
    bankSection.style.display = 'block';
    mpesaSection.style.display = 'none';
    if (registrationId) {
      document.getElementById('bank-reference').textContent = `REG-${registrationId}`;
    }
  }
}

// ─── Registration Save ───────────────────────────────────
async function saveRegistration() {
  const payload = {
    firstName: document.getElementById('firstName').value,
    lastName: document.getElementById('lastName').value,
    email: document.getElementById('email').value,
    phone: document.getElementById('phone').value,
    gender: document.getElementById('gender').value,
    county: document.getElementById('county').value,
    ageRange: document.getElementById('ageRange').value,
    organization: document.getElementById('organization').value,
    position: document.getElementById('position').value,
    registrationType: regType
  };

  try {
    const data = await safeFetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return data.success ? data.registrationId : null;
  } catch (err) {
    console.error('Registration save error:', err);
    alert('Registration error: ' + err.message + '\n\nPlease ensure the server is running.');
    return null;
  }
}

// ─── M-Pesa Payment ───────────────────────────────────
async function initMpesaPayment() {
  if (!registrationId) {
    registrationId = await saveRegistration();
    if (!registrationId) return;
  }

  btnMpesaConfirm.disabled = true;
  btnMpesaConfirm.textContent = 'Processing...';

  try {
    const data = await safeFetch('/api/mpesa/stkpush', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: mpesaPhone, amount: regAmount, registrationId })
    });

    if (data.success) {
      checkoutRequestId = data.checkoutRequestId;
      showPaymentModal();
      startPaymentPolling();
    } else {
      throw new Error(data.message || 'M-Pesa STK push failed.');
    }
  } catch (err) {
    console.error('M-Pesa error:', err);
    alert('M-Pesa error: ' + err.message);
    btnMpesaConfirm.disabled = false;
    btnMpesaConfirm.textContent = 'Pay with M-Pesa &nbsp;💰';
  }
}

// ─── Payment Modal ───────────────────────────────────────
function showPaymentModal() {
  mpesaModal.style.display = 'flex';
  modalTitle.textContent = 'M-Pesa Payment Initiated';
  modalMessage.textContent = `Please check your phone for the M-Pesa prompt to pay KSh ${regAmount.toLocaleString()}. Enter your M-Pesa PIN to complete the transaction.`;
  modalActions.innerHTML = `
    <button onclick="manualStatusCheck()" class="btn-primary" style="width:100%; margin-bottom:12px;">
      Verify Payment Status
    </button>
    <button onclick="closeModal()" style="background:transparent; border:1px solid var(--border-light); color:var(--text-muted); padding:10px; width:100%; border-radius:var(--radius-sm); cursor:pointer;">
      Close
    </button>
  `;
}

function closeModalHandler() {
  mpesaModal.style.display = 'none';
}

function closeModal() {
  document.getElementById('payment-modal').style.display = 'none';
}

// ─── Payment Polling ───────────────────────────────────────
function startPaymentPolling() {
  pollAttempts = 0;
  pollInterval = setInterval(checkPaymentStatus, 3000);
}

function stopPaymentPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function checkPaymentStatus() {
  pollAttempts++;
  
  if (pollAttempts > MAX_POLL_ATTEMPTS) {
    stopPaymentPolling();
    showPaymentTimeout();
    return;
  }

  try {
    const data = await safeFetch(`/api/mpesa/status/${checkoutRequestId}`);
    
    if (data.success && data.status === 'completed') {
      stopPaymentPolling();
      showPaymentSuccess(data);
    } else if (data.success && data.status === 'failed') {
      stopPaymentPolling();
      showPaymentFailed(data.message || 'Payment failed');
    }
  } catch (err) {
    console.error('Status check error:', err);
  }
}

// ─── Payment Results ───────────────────────────────────────
function showPaymentSuccess(data) {
  modalTitle.textContent = '✅ Payment Successful!';
  modalMessage.textContent = 'Your payment has been confirmed. Registration is now complete.';
  modalActions.innerHTML = `
    <button onclick="closeModal()" class="btn-primary" style="width:100%;">
      Complete Registration &nbsp;✅
    </button>
  `;
  
  setTimeout(() => {
    closeModal();
    document.querySelector('.form-step.active').classList.remove('active');
    document.getElementById('success-screen').style.display = 'block';

    document.getElementById('r-reg-id').textContent = data.registrationId || registrationId || '—';
    document.getElementById('r-receipt').textContent = data.mpesaReceiptNumber || '—';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 2000);
}

function showPaymentFailed(message) {
  modalTitle.textContent = '❌ Payment Failed';
  modalMessage.textContent = message || 'Payment could not be completed. Please try again.';
  modalActions.innerHTML = `
    <button onclick="closeModal()" class="btn-primary" style="width:100%;">
      Try Again
    </button>
  `;
  btnMpesaConfirm.disabled = false;
  btnMpesaConfirm.textContent = 'Pay with M-Pesa &nbsp;💰';
}

function showPaymentTimeout() {
  modalTitle.textContent = '⏰ Payment Timeout';
  modalMessage.textContent = 'Payment verification timed out. Please confirm manually using your M-Pesa transaction code.';
  modalActions.innerHTML = `
    <input type="text" id="mpesaTransactionCode" placeholder="Enter M-Pesa Transaction Code" style="width:100%; padding:10px; margin-bottom:12px; border:1px solid var(--border-light); border-radius:var(--radius-sm);">
    <button onclick="confirmMpesaPayment()" class="btn-primary" style="width:100%;">
      Confirm Payment & Complete Registration &nbsp;✅
    </button>
  `;
  btnMpesaConfirm.disabled = false;
  btnMpesaConfirm.textContent = 'Pay with M-Pesa &nbsp;💰';
}

// ─── Manual M-Pesa Confirmation ───────────────────────
async function confirmMpesaPayment() {
  const transactionCode = document.getElementById('mpesaTransactionCode').value.trim();
  const registrationId = window.registrationId;
  const amount = document.getElementById('mpesaAmount').value;

  if (!transactionCode || !registrationId || !amount) {
    alert('Please fill in all required fields.');
    return;
  }

  try {
    const btn = document.getElementById('btn-mpesa-confirm');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    const data = await safeFetch('/api/mpesa/confirm-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        registrationId, 
        transactionCode,
        amount: amount,
        paymentMethod: 'mpesa'
      })
    });

    if (!data.success) {
      throw new Error(data.message || 'Payment verification failed.');
    }

    document.querySelector('.form-step.active').classList.remove('active');
    document.getElementById('success-screen').style.display = 'block';
    
    document.getElementById('r-reg-id').textContent = registrationId || '—';
    document.getElementById('r-receipt').textContent = '—';
    
    const successTitle = document.getElementById('success-screen').querySelector('h2');
    const successMessage = document.getElementById('success-screen').querySelector('p');
    successTitle.textContent = 'Registration Submitted Successfully!';
    successMessage.textContent = `Thank you for registering! Your Registration ID is ${registrationId}. Please save this ID for future reference.`;
    
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    console.error(err);
    btn.disabled = false;
    btn.textContent = 'Confirm Payment & Complete Registration &nbsp;✅';
    
    if (err.message.includes('Payment not completed')) {
      alert('❌ ' + err.message + '\n\nPlease ensure you have completed M-Pesa payment on your phone before confirming.');
    } else if (err.message.includes('Invalid transaction code')) {
      alert('❌ ' + err.message + '\n\nPlease enter the exact transaction code from your M-Pesa confirmation message.');
    } else if (err.message.includes('already been used')) {
      alert('❌ ' + err.message + '\n\nThis transaction code has already been used for another registration. Please check your M-Pesa messages for the correct code.');
    } else {
      alert('❌ ' + err.message);
    }
  }
}

// ─── Bank Transfer ───────────────────────────────────────
async function confirmBankTransfer() {
  const transactionId = document.getElementById('bankTransactionId').value.trim();
  
  if (!transactionId) {
    alert('Please enter your bank transaction reference number.');
    return;
  }

  try {
    const btn = document.getElementById('btn-bank-confirm');
    btn.disabled = true;
    btn.textContent = 'Processing...';

    if (!registrationId) {
      registrationId = await saveRegistration();
      if (!registrationId) return;
    }

    const data = await safeFetch('/api/register/bank-transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        registrationId, 
        transactionId,
        amount: regAmount,
        paymentMethod: 'bank'
      })
    });

    if (!data.success) {
      throw new Error(data.message || 'Bank transfer confirmation failed.');
    }

    document.querySelector('.form-step.active').classList.remove('active');
    document.getElementById('success-screen').style.display = 'block';
    document.getElementById('success-screen').querySelector('h2').textContent = 'Registration Submitted';
    document.getElementById('success-screen').querySelector('p').textContent = `Thank you for registering! Your Registration ID is ${registrationId}. Please save this ID for future reference. Your registration will be confirmed once bank transfer is verified (1-3 business days).`;
    
    document.getElementById('r-reg-id').textContent = registrationId || '—';
    document.getElementById('r-receipt').textContent = transactionId || '—';

    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    console.error(err);
    const btn = document.getElementById('btn-bank-confirm');
    btn.disabled = false;
    btn.textContent = 'Confirm Bank Transfer &nbsp;🏦';
    alert('Bank transfer error: ' + err.message);
  }
}

// ─── Manual Status Check ───────────────────────────────
function manualStatusCheck() {
  closeModal();
  showPaymentTimeout();
}

// ─── Final Submit ───────────────────────────────────────
async function submitRegistration() {
  try {
    if (!registrationId) {
      registrationId = await saveRegistration();
      if (!registrationId) return;
    }

    const data = await safeFetch('/api/register/bank-transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        registrationId, 
        transactionId: 'MANUAL',
        amount: regAmount,
        paymentMethod: 'manual'
      })
    });

    if (!data.success) {
      throw new Error(data.message || 'Registration submission failed.');
    }

    document.querySelector('.form-step.active').classList.remove('active');
    document.getElementById('success-screen').style.display = 'block';

    document.getElementById('r-reg-id').textContent = data.registrationId || registrationId || '—';
    document.getElementById('r-receipt').textContent = data.mpesaReceiptNumber || '—';

    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.error(err);
    alert('Registration error: ' + err.message);
  }
}
