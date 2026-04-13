document.addEventListener('DOMContentLoaded', () => {
    const contactForm = document.getElementById('contactForm');
    const formContainer = document.getElementById('contactFormContainer');
    const successContainer = document.getElementById('contactSuccessContainer');
    const errorMsg = document.getElementById('contactErrorMessage');
    const submitBtn = document.getElementById('submitContactBtn');
    const subjectSelect = document.getElementById('subject');

    // Pre-fill subject based on URL query parameter (e.g., ?subject=Gold%20Partnership)
    const urlParams = new URLSearchParams(window.location.search);
    const subjectParam = urlParams.get('subject');
    if (subjectParam) {
        // Try to match the exact option value
        const optionToSelect = Array.from(subjectSelect.options).find(opt => opt.value === subjectParam);
        if (optionToSelect) {
            optionToSelect.selected = true;
        } else {
            // If it doesn't match an exact tier, set it to Bespoke or General based on string matching
            if(subjectParam.toLowerCase().includes('partner')) {
                subjectSelect.value = "Bespoke Partnership";
            } else {
                subjectSelect.value = "General Inquiry";
            }
        }
    }

    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Reset state
        errorMsg.style.display = 'none';
        submitBtn.disabled = true;
        const originalBtnText = submitBtn.innerText;
        submitBtn.innerText = 'Sending...';

        const formData = new FormData(contactForm);
        const data = Object.fromEntries(formData.entries());

        try {
            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Failed to send message');
            }

            // Show success
            formContainer.style.display = 'none';
            successContainer.style.display = 'block';

        } catch (err) {
            errorMsg.innerText = err.message || 'An unexpected error occurred. Please try again.';
            errorMsg.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.innerText = originalBtnText;
        }
    });
});
