document.addEventListener('DOMContentLoaded', () => {
    
    // --- PRELOADER ---
    const preloader = document.getElementById('preloader');
    const loadProgress = document.querySelector('.loader-progress');
    
    if (preloader) {
        let width = 0;
        const interval = setInterval(() => {
            width += 5 + Math.random() * 10;
            if (width > 100) width = 100;
            loadProgress.style.width = width + '%';
            
            if (width >= 100) {
                clearInterval(interval);
                setTimeout(() => {
                    preloader.style.opacity = '0';
                    preloader.style.visibility = 'hidden';
                    initPageAnimations();
                }, 400);
            }
        }, 30);
    } else {
        initPageAnimations();
    }

    function initPageAnimations() {
        // --- CUSTOM CURSOR ---
        const cursor = document.getElementById('custom-cursor');
        if (cursor && !window.matchMedia("(max-width: 900px)").matches) {
            document.addEventListener('mousemove', e => {
                cursor.style.left = e.clientX + 'px';
                cursor.style.top = e.clientY + 'px';
            });

            const interactables = document.querySelectorAll('a, .btn, .glass-card, .feature-card, .arch-box');
            interactables.forEach(el => {
                el.addEventListener('mouseenter', () => cursor.classList.add('hovering'));
                el.addEventListener('mouseleave', () => cursor.classList.remove('hovering'));
            });
        }

        // --- SCROLL REVEALS ---
        const revealElements = document.querySelectorAll('.reveal');
        const fadeInElements = document.querySelectorAll('.fade-in');

        const revealObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });

        revealElements.forEach(el => revealObserver.observe(el));
        
        fadeInElements.forEach(el => {
            if (!el.classList.contains('reveal')) {
                el.classList.add('visible');
            }
        });

        // --- PARTICLE BACKGROUND CANVAS ---
        const canvas = document.getElementById('particle-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            let particlesArray;

            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            let mouse = {
                x: null,
                y: null,
                radius: 120
            };

            window.addEventListener('mousemove', function(event) {
                mouse.x = event.x;
                mouse.y = event.y;
            });

            window.addEventListener('mouseout', function() {
                mouse.x = undefined;
                mouse.y = undefined;
            });

            class Particle {
                constructor(x, y, directionX, directionY, size, color) {
                    this.x = x;
                    this.y = y;
                    this.directionX = directionX;
                    this.directionY = directionY;
                    this.size = size;
                    this.color = color;
                }
                draw() {
                    ctx.beginPath();
                    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2, false);
                    ctx.fillStyle = this.color;
                    ctx.fill();
                }
                update() {
                    if (this.x > canvas.width || this.x < 0) this.directionX = -this.directionX;
                    if (this.y > canvas.height || this.y < 0) this.directionY = -this.directionY;

                    // Mouse interactivity
                    let dx = mouse.x - this.x;
                    let dy = mouse.y - this.y;
                    let distance = Math.sqrt(dx*dx + dy*dy);
                    if (distance < mouse.radius) {
                        const forceDirectionX = dx / distance;
                        const forceDirectionY = dy / distance;
                        const force = (mouse.radius - distance) / mouse.radius;
                        const directionX = forceDirectionX * force * 2;
                        const directionY = forceDirectionY * force * 2;

                        this.x -= directionX;
                        this.y -= directionY;
                    } else {
                        this.x += this.directionX;
                        this.y += this.directionY;
                    }
                    this.draw();
                }
            }

            function initParticles() {
                particlesArray = [];
                let numberOfParticles = (canvas.height * canvas.width) / 15000;
                for (let i = 0; i < numberOfParticles; i++) {
                    let size = (Math.random() * 2) + 0.5;
                    let x = (Math.random() * ((canvas.width - size * 2) - (size * 2)) + size * 2);
                    let y = (Math.random() * ((canvas.height - size * 2) - (size * 2)) + size * 2);
                    let directionX = (Math.random() * 2) - 1;
                    let directionY = (Math.random() * 2) - 1;
                    let color = 'rgba(100, 100, 255, 0.4)';
                    particlesArray.push(new Particle(x, y, directionX, directionY, size, color));
                }
            }

            function animateParticles() {
                requestAnimationFrame(animateParticles);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                for (let i = 0; i < particlesArray.length; i++) {
                    particlesArray[i].update();
                }
            }

            window.addEventListener('resize', () => {
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
                initParticles();
            });

            initParticles();
            animateParticles();
        }

        // Header scroll background effect
        const header = document.getElementById('site-header');
        window.addEventListener('scroll', () => {
            if (window.scrollY > 50) header.classList.add('scrolled');
            else header.classList.remove('scrolled');
        });

        // Mobile menu toggle
        const menuToggle = document.getElementById('menu-toggle');
        const navLinks = document.querySelector('.nav-links');
        if (menuToggle) {
            menuToggle.addEventListener('click', () => navLinks.classList.toggle('active'));
        }

        // 3D Tilt effect for main card
        if (window.matchMedia("(hover: hover)").matches) {
            const glassCard = document.querySelector('.main-card');
            const heroGraphic = document.querySelector('.hero-graphic');
            if (glassCard && heroGraphic) {
                heroGraphic.addEventListener('mousemove', (e) => {
                    const rect = heroGraphic.getBoundingClientRect();
                    const x = e.clientX - rect.left - rect.width / 2;
                    const y = e.clientY - rect.top - rect.height / 2;
                    const rotateX = (-y / 20) + 10;
                    const rotateY = (x / 20) - 15;
                    glassCard.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-10px)`;
                    glassCard.style.transition = 'transform 0.1s ease';
                });
                heroGraphic.addEventListener('mouseleave', () => {
                    glassCard.style.transform = `rotateX(10deg) rotateY(-15deg)`;
                    glassCard.style.transition = 'transform 0.5s ease';
                });
            }
        }
    }
});
