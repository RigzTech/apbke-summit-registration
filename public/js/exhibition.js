/**
 * exhibition.js — Dedicated logic for Exhibition Booth Booking
 * Fixed USD 1000 pricing and Bank Transfer only.
 */

let currentStep = 1;
let registrationId = null;
const BOOTH_PRICE = 1000;
const CURRENCY = "USD";

document.addEventListener('DOMContentLoaded', () => {
    // 1. Event Listeners
    const btnNext = document.getElementById('nextBtn');
    const btnPrev = document.getElementById('prevBtn');

    if (btnNext) btnNext.addEventListener('click', () => {
        if (currentStep < 3) goToStep(currentStep + 1);
    });
    if (btnPrev) btnPrev.addEventListener('click', () => {
        if (currentStep > 1) goToStep(currentStep - 1);
    });

    const btnBank = document.getElementById('btn-bank-confirm');
    if (btnBank) btnBank.addEventListener('click', confirmBankTransfer);

    updateStepper();
});

function goToStep(target) {
    if (target > currentStep && !validateStep(currentStep)) return;

    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    document.getElementById(`form-step-${target}`).classList.add('active');

    currentStep = target;
    updateStepper();

    const pBtn = document.getElementById('prevBtn');
    const nBtn = document.getElementById('nextBtn');

    if (currentStep === 1) {
        pBtn.style.display = 'none';
        nBtn.style.display = 'block';
        nBtn.textContent = 'Next Step →';
    } else if (currentStep === 2) {
        pBtn.style.display = 'block';
        nBtn.style.display = 'block';
        nBtn.textContent = 'Continue to Payment →';
        fillVerification();
    } else {
        pBtn.style.display = 'block';
        nBtn.style.display = 'none';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateStepper() {
    for (let i = 1; i <= 3; i++) {
        const el = document.getElementById(`step-${i}`);
        if (!el) continue;
        el.classList.toggle('active', i === currentStep);
        el.classList.toggle('done', i < currentStep);
        const circle = el.querySelector('.step-circle');
        if (circle) circle.textContent = (i < currentStep) ? '✓' : i;
    }
}

function validateStep(step) {
    if (step === 2) return true;
    let valid = true;
    const required = ['firstName', 'lastName', 'email', 'phone', 'organization'];
    required.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value.trim()) {
            el.style.borderColor = '#ff4d4d';
            valid = false;
        } else if (el) {
            el.style.borderColor = '';
        }
    });
    return valid;
}

function fillVerification() {
  const fn = document.getElementById('firstName').value || '—';
  const ln = document.getElementById('lastName').value || '—';
  document.getElementById('v-name').textContent = `${fn} ${ln}`;
  document.getElementById('v-org').textContent = document.getElementById('organization').value || '—';
  document.getElementById('v-email-val').textContent = document.getElementById('email').value || '—';
  document.getElementById('v-county').textContent = document.getElementById('cityRegion').value || '—';

  // Trigger registration save to get ID
  if (!registrationId) {
      saveRegistration().then(id => {
          if (id && document.getElementById('bank-reference')) {
              document.getElementById('bank-reference').textContent = id;
          }
      });
  }
}

async function saveRegistration() {
    const payload = {
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        organisation: document.getElementById('organization').value,
        registrationType: 'exhibition',
        gender: document.getElementById('gender').value,
        country: document.getElementById('countryRes').value,
        county: document.getElementById('cityRegion').value,
        jobTitle: document.getElementById('jobTitle').value,
        ageRange: document.getElementById('ageRange').value,
        amountPaid: BOOTH_PRICE,
        currency: CURRENCY
    };
    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            registrationId = data.registrationId;
            return registrationId;
        }
    } catch (e) { console.error('Reg Save Error:', e); }
    return null;
}

async function confirmBankTransfer() {
    const transId = document.getElementById('transactionId').value.trim();
    if (!transId) { alert('Please enter bank reference'); return; }

    const btn = document.getElementById('btn-bank-confirm');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
        const res = await fetch('/api/register/bank-transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                registrationId, 
                transactionId: transId, 
                amount: BOOTH_PRICE,
                paymentMethod: 'bank_transfer_usd'
            })
        });
        const data = await res.json();
        if (data.success) {
            finishSuccess(registrationId, transId);
        } else { throw new Error(data.message || 'Verification failed'); }
    } catch (e) {
        alert('Verification Error: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Confirm Booking & 🏦';
    }
}

function finishSuccess(regId, receipt) {
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    document.getElementById('success-screen').style.display = 'block';
    
    // Hide controls
    document.getElementById('prevBtn').style.display = 'none';
    document.getElementById('nextBtn').style.display = 'none';
    document.querySelector('.stepper').style.display = 'none';

    document.getElementById('r-reg-id').textContent = regId;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
