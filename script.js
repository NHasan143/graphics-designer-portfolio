// Set dynamic year
document.getElementById('current-year').textContent = new Date().getFullYear();

// Form Handling Script
const form = document.getElementById("my-form");
const successMessage = document.getElementById("success-message");

async function handleSubmit(event) {
    event.preventDefault();
    const status = document.getElementById("submit-btn");
    const data = new FormData(event.target);
    status.innerHTML = "Sending...";
    status.disabled = true;

    fetch(event.target.action, {
        method: form.method,
        body: data,
        headers: { 'Accept': 'application/json' }
    }).then(response => {
        if (response.ok) {
            form.style.display = "none";
            successMessage.style.display = "block";
        } else {
            response.json().then(data => {
                if (Object.hasOwn(data, 'errors')) {
                    alert(data["errors"].map(error => error["message"]).join(", "));
                } else {
                    alert("Oops! There was a problem submitting your form");
                }
            })
        }
    }).catch(error => {
        alert("Oops! There was a problem submitting your form");
    }).finally(() => {
        status.innerHTML = "Submit";
        status.disabled = false;
    });
}
form.addEventListener("submit", handleSubmit);

const backToTop = document.getElementById('backToTop');
window.addEventListener('scroll', () => {
    if (window.scrollY > 400) { backToTop.classList.add('show'); } 
    else { backToTop.classList.remove('show'); }
});

const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('nav-links');
hamburger.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    hamburger.classList.toggle('toggle');
});

document.querySelectorAll('.nav-links a').forEach(link => {
    link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        hamburger.classList.remove('toggle');
    });
});

// NEW: Arrow Toggle Logic
const carousel = document.getElementById('expertCarousel');
const leftArrow = document.querySelector('.arrow-left');
const rightArrow = document.querySelector('.arrow-right');

carousel.addEventListener('scroll', () => {
    const scrollLeft = carousel.scrollLeft;
    const maxScroll = carousel.scrollWidth - carousel.clientWidth;

    // Toggle Left Arrow
    if (scrollLeft > 10) {
        leftArrow.style.display = 'flex';
    } else {
        leftArrow.style.display = 'none';
    }

    // Toggle Right Arrow
    if (scrollLeft >= maxScroll - 10) {
        rightArrow.style.display = 'none';
    } else {
        rightArrow.style.display = 'flex';
    }
});

// Cursor effect for bubbles
const canvas = document.getElementById('bubble-canvas');
const ctx = canvas.getContext('2d');
let particlesArray = [];

// Handle Window Resize
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const mouse = { x: null, y: null };

window.addEventListener('mousemove', (event) => {
    mouse.x = event.x;
    mouse.y = event.y;
// Create 2 bubbles per movement
for (let i = 0; i < 2; i++) {
    particlesArray.push(new Particle());
}
});

class Particle {
    constructor() {
        this.x = mouse.x;
        this.y = mouse.y;
        this.size = Math.random() * 10 + 2; // Bubble size
        this.speedX = Math.random() * 2 - 1; // Horizontal drift
        this.speedY = Math.random() * -2 - 1; // Upward float
        this.color = 'rgba(255, 255, 255, 0.3)'; // Semi-transparent white
    }
    update() {
        this.x += this.speedX;
        this.y += this.speedY;
        if (this.size > 0.2) this.size -= 0.1; // Shrink/Fade over time
    }
    draw() {
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function handleParticles() {
    for (let i = 0; i < particlesArray.length; i++) {
        particlesArray[i].update();
        particlesArray[i].draw();
        // Remove tiny particles to save memory
        if (particlesArray[i].size <= 0.3) {
            particlesArray.splice(i, 1);
            i--;
        }
    }
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    handleParticles();
    requestAnimationFrame(animate);
}
animate();

// --- UPDATED TYPEWRITER LOGIC (Slower Speeds) ---
const typewriterText = document.getElementById('typewriter');
const phrases = ["Video Editor", "Graphic Designer"];
let phraseIndex = 0;
let charIndex = 0;
let isDeleting = false;

// Speed Settings (in milliseconds)
const TYPING_SPEED = 350;     // Higher value provides Slower typing
const DELETING_SPEED = 150;   // Higher value provides Slower deleting
const PAUSE_AT_END = 2500;    // Increased from 2000 (Pause longer on full phrase)
const PAUSE_BEFORE_TYPE = 800; // Increased from 500 (Pause before starting next phrase)

function type() {
    const currentPhrase = phrases[phraseIndex];
    let typeSpeed = TYPING_SPEED;

    if (isDeleting) {
        typewriterText.textContent = currentPhrase.substring(0, charIndex - 1);
        charIndex--;
        typeSpeed = DELETING_SPEED;
    } else {
        typewriterText.textContent = currentPhrase.substring(0, charIndex + 1);
        charIndex++;
    }

    // Logic for pausing and switching directions
    if (!isDeleting && charIndex === currentPhrase.length) {
        isDeleting = true;
        typeSpeed = PAUSE_AT_END; 
    } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        typeSpeed = PAUSE_BEFORE_TYPE;
    }

    setTimeout(type, typeSpeed);
}

// Ensure it starts when the page loads
window.addEventListener('DOMContentLoaded', type);
