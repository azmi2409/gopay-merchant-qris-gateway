(function() {
    'use strict';

    // ── Extract QRIS ID from URL path (/qr/:id) ──
    const pathParts = window.location.pathname.split('/');
    const qrisId = pathParts[pathParts.length - 1];

    let qrisData = null;
    let expiresTimestamp = 0;
    let totalDurationMs = 0;
    let isChecking = false;
    let isPaid = false;
    let isExpired = false;
    let pollTimer = null;
    let countdownInterval = null;

    // ── Fetch QRIS data from API ──
    async function init() {
        try {
            const res = await fetch('/api/v1/qris/' + qrisId);
            const json = await res.json();

            if (!json.success) {
                document.getElementById('error-page').style.display = 'block';
                return;
            }

            qrisData = json.data;
            expiresTimestamp = qrisData.expires_at;
            totalDurationMs = qrisData.duration_ms || (5 * 60 * 1000);

            // Populate UI
            document.getElementById('amount-display').textContent = qrisData.formatted_amount;
            document.getElementById('qr-image').src = qrisData.qr_image_url;
            document.getElementById('payment-card').style.display = 'block';

            document.title = 'QRIS Payment - ' + qrisData.formatted_amount;

            // Check if already paid
            if (qrisData.status === 'PAID' && qrisData.transaction) {
                onPaymentSuccess(qrisData.transaction);
                return;
            }

            // Start countdown
            countdownInterval = setInterval(updateCountdown, 1000);
            updateCountdown();
            updateProgress();

            // Enable auto-poll by default
            document.getElementById('chk-auto').checked = true;
            startAutoPoll();

        } catch (err) {
            console.error('Failed to load QRIS data:', err);
            document.getElementById('error-page').style.display = 'block';
        }
    }

    // ── Countdown ──
    function updateCountdown() {
        if (isPaid) return;
        const now = Date.now();
        const diff = expiresTimestamp - now;

        if (diff <= 0) {
            isExpired = true;
            const timerEl = document.getElementById('timer-text');
            timerEl.textContent = '00:00';
            timerEl.classList.add('danger');

            document.getElementById('status-badge').className = 'status-badge status-expired';
            document.getElementById('status-text').textContent = 'Kode QRIS kedaluwarsa';
            document.getElementById('btn-check').disabled = true;
            document.getElementById('btn-download').disabled = true;
            document.getElementById('chk-auto').disabled = true;
            document.getElementById('scan-hint').style.display = 'none';
            document.getElementById('qr-overlay').classList.add('visible');
            document.getElementById('progress-fill').style.width = '0%';

            clearInterval(countdownInterval);
            stopAutoPoll();
            return;
        }

        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        const timerEl = document.getElementById('timer-text');
        timerEl.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');

        // Danger styling when < 1 min
        if (diff < 60000) {
            timerEl.classList.add('danger');
            document.getElementById('progress-fill').classList.add('danger');
        }

        updateProgress();
    }

    function updateProgress() {
        const now = Date.now();
        const remaining = Math.max(0, expiresTimestamp - now);
        const pct = (remaining / totalDurationMs) * 100;
        document.getElementById('progress-fill').style.width = pct + '%';
    }

    // ── Status Check ──
    window.checkStatusManual = async function() {
        if (isChecking || isPaid || isExpired) return;
        isChecking = true;

        const btn = document.getElementById('btn-check');
        const spinner = document.getElementById('btn-spinner');
        const label = document.getElementById('btn-label');

        btn.disabled = true;
        spinner.style.display = 'inline-block';
        label.textContent = 'Memeriksa...';

        try {
            const res = await fetch('/api/v1/qris/' + qrisId + '/status');
            const data = await res.json();

            if (data.success && data.paid) {
                onPaymentSuccess(data.transaction);
            } else if (data.status === 'EXPIRED') {
                isExpired = true;
                updateCountdown();
            } else {
                document.getElementById('status-text').textContent = 'Pembayaran belum diterima';
                setTimeout(() => {
                    if (!isPaid && !isExpired) {
                        document.getElementById('status-text').textContent = 'Menunggu pembayaran';
                    }
                }, 2000);
            }
        } catch (err) {
            console.error('Check status failed:', err);
        } finally {
            isChecking = false;
            if (!isPaid && !isExpired) {
                btn.disabled = false;
            }
            spinner.style.display = 'none';
            label.textContent = 'Periksa status pembayaran';
        }
    };

    // ── Payment Success ──
    function onPaymentSuccess(tx) {
        isPaid = true;
        stopAutoPoll();
        if (countdownInterval) clearInterval(countdownInterval);

        document.getElementById('status-badge').className = 'status-badge status-paid';
        document.getElementById('status-text').textContent = 'Pembayaran berhasil';
        document.getElementById('scan-hint').style.display = 'none';
        document.getElementById('btn-check').style.display = 'none';
        document.querySelector('.auto-poll-toggle').style.display = 'none';
        document.getElementById('timer-row').style.display = 'none';
        document.querySelector('.progress-track').style.display = 'none';

        if (tx) {
            document.getElementById('tx-order').textContent = tx.order_id || tx.transaction_id || '—';
            document.getElementById('tx-issuer').textContent = tx.payer_issuer || 'GoPay / Bank';
            document.getElementById('tx-time').textContent = tx.transaction_time
                ? new Date(tx.transaction_time).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
                : '—';
            document.getElementById('tx-amount').textContent = qrisData
                ? qrisData.formatted_amount
                : ('Rp ' + (tx.amount || 0).toLocaleString('id-ID'));
            document.getElementById('success-panel').classList.add('visible');
        }

        // 🎉 Fire confetti
        launchConfetti();
    }

    // ── Auto Poll ──
    function startAutoPoll() {
        stopAutoPoll();
        pollTimer = setInterval(() => {
            if (!isChecking && !isPaid && !isExpired) {
                checkStatusManual();
            }
        }, 5000);
    }

    function stopAutoPoll() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    window.handleAutoPollChange = function(chk) {
        if (chk.checked) {
            startAutoPoll();
        } else {
            stopAutoPoll();
        }
    };

    window.downloadQR = function() {
        if (!qrisData) return;

        const link = document.createElement('a');
        link.href = '/qr/' + encodeURIComponent(qrisId) + '?download=1';
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    // ── Confetti Animation ──
    function launchConfetti() {
        const canvas = document.getElementById('confetti-canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const particles = [];
        const colors = ['#34d399', '#38bdf8', '#fbbf24', '#818cf8', '#f472b6', '#22d3ee', '#a78bfa'];

        for (let i = 0; i < 120; i++) {
            particles.push({
                x: canvas.width / 2 + (Math.random() - 0.5) * 200,
                y: canvas.height / 2,
                vx: (Math.random() - 0.5) * 16,
                vy: -Math.random() * 18 - 4,
                w: Math.random() * 8 + 4,
                h: Math.random() * 6 + 2,
                color: colors[Math.floor(Math.random() * colors.length)],
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 12,
                gravity: 0.25 + Math.random() * 0.15,
                opacity: 1,
                decay: 0.008 + Math.random() * 0.006
            });
        }

        let frame;
        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let alive = false;

            for (const p of particles) {
                if (p.opacity <= 0) continue;
                alive = true;
                p.x += p.vx;
                p.vy += p.gravity;
                p.y += p.vy;
                p.vx *= 0.99;
                p.rotation += p.rotationSpeed;
                p.opacity -= p.decay;

                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.globalAlpha = Math.max(0, p.opacity);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            }

            if (alive) {
                frame = requestAnimationFrame(animate);
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }

        animate();
    }

    // ── Start ──
    init();
})();
