document.addEventListener('DOMContentLoaded', () => {
    const menuToggle = document.getElementById('mobile-menu');
    const navLinks = document.querySelector('.nav-links');

    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', () => {
            menuToggle.classList.toggle('is-active');
            navLinks.classList.toggle('mobile-active');
            
            // Prevent scrolling when menu is open
            if (navLinks.classList.contains('mobile-active')) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = 'auto';
            }
        });

        // Close menu when a link is clicked
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                menuToggle.classList.remove('is-active');
                navLinks.classList.remove('mobile-active');
                document.body.style.overflow = 'auto';
            });
        });
    }

    // Global Observer for Reveal & Counter animations
    const observerOptions = { threshold: 0.15 };
    const globalObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                // Handle Reveal animation
                if (entry.target.classList.contains('reveal') || entry.target.classList.contains('reveal-blur')) {
                    entry.target.classList.add('active');
                }
                
                // Handle Counter animation
                if (entry.target.classList.contains('counter')) {
                    const target = +entry.target.getAttribute('data-target');
                    const speed = 200;
                    const updateCount = () => {
                        const current = +entry.target.innerText;
                        const inc = target / speed;
                        if (current < target) {
                            entry.target.innerText = Math.ceil(current + inc);
                            setTimeout(updateCount, 1);
                        } else {
                            entry.target.innerText = target + '+'; // Add plus sign back
                        }
                    };
                    updateCount();
                    globalObserver.unobserve(entry.target);
                }
            }
        });
    }, observerOptions);

    document.querySelectorAll('.reveal, .reveal-blur, .counter').forEach(el => globalObserver.observe(el));
});
