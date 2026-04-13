/**
 * form.js — Multi-step registration form logic + M-Pesa STK Push
 * FINAL PRODUCTION VERSION - CLEAN SWEEP (Surgical Re-Restoration)
 */

// ─── Configuration ──────────────────────────────────────────────
const PRICES = {
    kenya: { physical: 15000, virtual: 5000, name: "Kenyan Delegate", currency: "KES" },
    ea: { physical: 295, virtual: 145, name: "East African Delegate", currency: "USD" },
    exhibition: { physical: 1000, virtual: 1000, name: "Exhibition", currency: "USD" },
    sponsor: { physical: 500000, virtual: 500000, name: "Sponsorship & Partnership", currency: "KES" },
    apb: { physical: 5000, virtual: 5000, name: "APB Member", currency: "KES" }
};

let currentStep = 1;
let registrationId = null;
let checkoutRequestId = null;
let pollInterval = null;

// Read registration category from URL
const params = new URLSearchParams(window.location.search);
const regType = (params.get('type') || 'kenya').toLowerCase();

let qty_physical = 1;
let qty_virtual = 0;
let regAmount = 0;

// ─── Initialization ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // 1. Initial UI Setup
    const standardSection = document.getElementById('standard-attendance-section');
    const multiSection = document.getElementById('multi-attendance-section');
    const p = PRICES[regType] || PRICES.kenya;

    if (regType === 'ea') {
        if (multiSection) multiSection.style.display = 'block';
        if (standardSection) standardSection.style.display = 'none';
    } else {
        if (multiSection) multiSection.style.display = 'none';
        if (standardSection) {
            standardSection.style.display = 'block';
            document.getElementById('pass-title-main').textContent = p.name;
            document.getElementById('pass-price-main').textContent = `${p.currency} ${p.physical.toLocaleString()}`;

            const subTitle = document.getElementById('pass-subtitle-main');
            if (subTitle) {
                subTitle.textContent = (regType === 'exhibition') ? 'Premium Exhibition Booth' : 'Standard Registration';
            }
        }
    }

    // 2. Regional Field Swapping
    if (regType !== 'kenya') {
        const countySelect = document.getElementById('county');
        const cityInput = document.getElementById('cityRegion');
        const countyLabel = document.getElementById('county-label');
        if (countySelect && cityInput && countyLabel) {
            countySelect.style.display = 'none';
            countySelect.removeAttribute('required');
            countySelect.value = 'N/A';
            cityInput.style.display = 'block';
            cityInput.setAttribute('required', 'required');
            countyLabel.innerHTML = 'City / Region <span class="required-star">*</span>';
        }
    }

    // 3. Event Listeners
    const btnNext = document.getElementById('nextBtn');
    const btnPrev = document.getElementById('prevBtn');

    if (btnNext) btnNext.addEventListener('click', () => {
        if (currentStep < 3) goToStep(currentStep + 1);
    });
    if (btnPrev) btnPrev.addEventListener('click', () => {
        if (currentStep > 1) goToStep(currentStep - 1);
    });

    // Quantity Listeners
    ['btn-p-minus', 'btn-p-plus', 'btn-v-minus', 'btn-v-plus'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => {
            const type = id.includes('-p-') ? 'physical' : 'virtual';
            const delta = id.includes('plus') ? 1 : -1;
            updateQty(type, delta);
        });
    });

    // Payment Button Listeners
    const btnPay = document.getElementById('btn-pay');
    if (btnPay) btnPay.addEventListener('click', initiatePayment);

    const btnBank = document.getElementById('btn-bank-confirm');
    if (btnBank) btnBank.addEventListener('click', confirmBankTransfer);

    const btnMpesaConfirm = document.getElementById('btn-mpesa-confirm');
    if (btnMpesaConfirm) btnMpesaConfirm.addEventListener('click', confirmMpesaPayment);

    calculateTotal();
});

// ─── Core Logic ───────────────────────────────────────────────
function calculateTotal() {
    const p = PRICES[regType] || PRICES.kenya;
    regAmount = (regType === 'ea')
        ? (qty_physical * p.physical) + (qty_virtual * p.virtual)
        : p.physical;

    const totalStr = `${p.currency} ${regAmount.toLocaleString()}`;

    // Update all total displays
    ['summaryTotal', 'mpesa-total', 'bank-total'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = totalStr;
    });
}

function updateQty(type, delta) {
    if (type === 'physical') qty_physical = Math.max(0, qty_physical + delta);
    else qty_virtual = Math.max(0, qty_virtual + delta);

    const pEl = document.getElementById('qty-physical');
    const vEl = document.getElementById('qty-virtual');
    if (pEl) pEl.textContent = qty_physical;
    if (vEl) vEl.textContent = qty_virtual;
    calculateTotal();
}

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
        filterPaymentMethods();
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
    document.getElementById('v-email-val').textContent = document.getElementById('email').value || '—';
    document.getElementById('v-phone').textContent = document.getElementById('phone').value || '—';
    document.getElementById('v-org').textContent = document.getElementById('organization').value || '—';
    document.getElementById('v-job').textContent = document.getElementById('jobTitle').value || '—';
    document.getElementById('v-gender').textContent = document.getElementById('gender').value || '—';
    document.getElementById('v-age').textContent = document.getElementById('ageRange').value || '—';

    const regionVal = (regType === 'kenya') ? document.getElementById('county')?.value : document.getElementById('cityRegion')?.value;
    document.getElementById('v-county').textContent = regionVal || '—';

    document.getElementById('summaryPassType').textContent = (PRICES[regType] || PRICES.kenya).name;
    document.getElementById('summaryPassCategory').textContent = (regType === 'ea')
        ? (`${qty_physical} Physical, ${qty_virtual} Virtual`)
        : (regType === 'apb' ? 'APB Member Rate' : (regType === 'exhibition' ? 'Exhibition Booth' : 'Standard Attendance'));

    calculateTotal();

    saveRegistration().then(id => {
        if (id) {
            if (document.getElementById('bank-reference')) {
                document.getElementById('bank-reference').textContent = id;
            }
            document.querySelectorAll('.reg-id-display').forEach(el => {
                el.textContent = id;
            });
        }
    });
}

function filterPaymentMethods() {
    const mSec = document.getElementById('mpesa-section');
    const bSec = document.getElementById('bank-section');
    const title = document.getElementById('payment-step-title');

    if (mSec) mSec.style.display = 'none';
    if (bSec) bSec.style.display = 'none';

    if (regType === 'kenya' || regType === 'apb') {
        if (title) title.textContent = '3. Complete Payment via M-Pesa';
        if (mSec) mSec.style.display = 'block';
        window.selectedPaymentMethod = 'mpesa';
        document.getElementById('mpesaPhone').value = document.getElementById('phone').value;

        // Custom instruction for APB
        if (regType === 'apb') {
            const instr = mSec.querySelector('p');
            if (instr) {
                instr.innerHTML = `<strong>Primary Method:</strong> STK Push (You will receive a prompt on your phone).<br>
                                   <strong>Alternative:</strong> Use M-Pesa Paybill <strong>972700</strong>, Account Number: <strong>0131016000003</strong>.`;
            }
        }
    } else {
        if (title) title.textContent = '3. Complete Payment via Bank Transfer';
        if (bSec) bSec.style.display = 'block';
        const iSec = document.getElementById('intermediary-details');
        if (iSec) iSec.style.display = 'block';
        window.selectedPaymentMethod = 'bank';
    }
}

// ─── API Interaction ─────────────────────────────────────────
async function saveRegistration() {
    const payload = {
        registrationId: registrationId, // Support updating if already exists
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        organisation: document.getElementById('organization').value,
        registrationType: regType,
        gender: document.getElementById('gender').value,
        country: document.getElementById('countryRes').value,
        county: (regType === 'kenya') ? document.getElementById('county').value : document.getElementById('cityRegion').value,
        jobTitle: document.getElementById('jobTitle').value,
        ageRange: document.getElementById('ageRange').value,
        qty_physical: qty_physical,
        qty_virtual: qty_virtual,
        totalPaid: regAmount
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

async function initiatePayment() {
    const phone = document.getElementById('mpesaPhone').value.trim();
    if (!phone) { alert('Please enter phone number'); return; }

    const btn = document.getElementById('btn-pay');
    btn.disabled = true;
    btn.textContent = 'Launching M-Pesa...';

    try {
        const res = await fetch('/api/mpesa/stkpush', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, amount: regAmount, registrationId })
        });
        const data = await res.json();
        if (data.success) {
            alert('M-Pesa Prompt sent to your phone. Please enter PIN to complete.');
            document.getElementById('mpesa-confirmation-section').style.display = 'block';
            btn.style.display = 'none';
        } else {
            throw new Error(data.message || 'STK Push failed');
        }
    } catch (e) {
        alert('Payment Error: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Pay with M-Pesa';
    }
}

async function confirmMpesaPayment() {
    const code = document.getElementById('mpesaTransactionCode').value.trim();
    if (!code) { alert('Enter transaction code'); return; }
    const btn = document.getElementById('btn-mpesa-confirm');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
        const res = await fetch('/api/mpesa/confirm-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registrationId, transactionCode: code, amount: regAmount })
        });
        const data = await res.json();
        if (data.success) {
            finishSuccess(registrationId, code);
        } else { throw new Error(data.message || 'Invalid code'); }
    } catch (e) {
        alert('Error: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Complete Registration & ✅';
    }
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
            body: JSON.stringify({ registrationId, transactionId: transId, amount: regAmount })
        });
        const data = await res.json();
        if (data.success) {
            finishSuccess(registrationId, transId);
        } else { throw new Error(data.message || 'Verification failed'); }
    } catch (e) {
        alert('Verification Error: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Confirm Bank Transfer';
    }
}

function finishSuccess(regId, receipt) {
    document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
    document.getElementById('success-screen').style.display = 'block';
    document.getElementById('r-reg-id').textContent = regId;
    document.getElementById('r-receipt').textContent = receipt;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}
