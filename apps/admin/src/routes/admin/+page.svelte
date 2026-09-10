<script lang="ts">
  import { endpoints } from '$lib/constants';
  import PaymentChart from '$lib/components/PaymentChart.svelte';

  let { data } = $props();

  // State
  let authenticated = $state(false);
  let password = $state('');
  let loginError = $state('');
  let isLoggingIn = $state(false);

  let view = $state<'overview' | 'generate' | 'setup' | 'docs' | 'logs'>('overview');
  let range = $state('30');
  let dashboard = $state<any>(null);

  $effect(() => {
    authenticated = data.authenticated;
    dashboard = data.dashboard;
  });
  let logs = $state<any[]>([]);
  let webhooks = $state<any[]>([]);
  let connection = $state('Checking gateway...');
  let ready = $state(false);
  let onboarding = $state(false);

  // Generator form
  let generateAmount = $state('');
  let generateReference = $state('');
  let generateCallback = $state('');
  let generateMessage = $state('');
  let isGenerating = $state(false);
  let generatedQris = $state<any>(null);

  // Settings form
  let qrisStatic = $state('');
  let merchantId = $state('');
  let decodeMessage = $state('');
  let settingsMessage = $state('');
  let isSavingSettings = $state(false);

  // OTP form
  let phone = $state('');
  let otp = $state('');
  let otpRequested = $state(false);
  let otpMessage = $state('');
  let verifyMessage = $state('');
  let isRequestingOtp = $state(false);
  let isVerifyingOtp = $state(false);

  // Webhook form
  let webhookUrl = $state('');
  let webhookSecret = $state('');
  let webhookMessage = $state('');
  let isRegisteringWebhook = $state(false);

  const money = (val: number | string) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
      Number(val || 0)
    );

  const pageTitles: Record<string, string> = {
    overview: 'Overview',
    generate: 'Generate QRIS',
    setup: 'Gateway Setup',
    docs: 'API Reference',
    logs: 'Activity Logs'
  };

  $effect(() => {
    if (dashboard) {
      processDashboardData(dashboard);
    }
  });

  function processDashboardData(d: any) {
    if (!d || !d.setup) return;
    const qrisReady = Boolean(d.setup.qris_configured);
    onboarding = !qrisReady;
    ready = qrisReady;

    if (d.setup.mode === 'full') {
      connection = 'Gateway Online (Auto)';
    } else if (d.setup.mode === 'generation_only') {
      connection = 'Gateway Online (Manual)';
    } else {
      connection = 'Setup Needed';
    }

    if (onboarding && view === 'overview') {
      view = 'setup';
    }
  }

  async function api(path: string, options: RequestInit = {}) {
    const res = await fetch(`/admin/api${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...options.headers
      }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || 'Request failed');
    return body.data;
  }

  async function handleLogin(e: Event) {
    e.preventDefault();
    loginError = '';
    isLoggingIn = true;
    try {
      await api('/login', {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      authenticated = true;
      password = '';
      await loadDashboard();
    } catch (err: any) {
      loginError = err.message;
    } finally {
      isLoggingIn = false;
    }
  }

  async function handleLogout() {
    await api('/logout', { method: 'POST' });
    authenticated = false;
    window.location.reload();
  }

  async function loadDashboard() {
    try {
      dashboard = await api(`/dashboard?days=${range}`);
      processDashboardData(dashboard);
    } catch (err: any) {
      connection = err.message;
      ready = false;
    }
  }

  async function loadLogs() {
    try {
      logs = await api('/logs');
    } catch (err: any) {
      console.error(err);
    }
  }

  async function loadWebhooks() {
    try {
      webhooks = await api('/webhooks');
    } catch (err: any) {
      console.error(err);
    }
  }

  function setView(v: typeof view) {
    if (onboarding && (v === 'overview' || v === 'generate')) return;
    view = v;
    if (v === 'logs') loadLogs();
    if (v === 'setup') loadWebhooks();
  }

  async function handleDecodeQris(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      decodeMessage = 'Pilih file gambar PNG, JPEG, atau WebP.';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      decodeMessage = 'Ukuran file maksimal 10 MB.';
      return;
    }

    if (!('BarcodeDetector' in window)) {
      decodeMessage = 'Browser Anda tidak mendukung deteksi QR lokal. Gunakan Chrome/Edge terbaru atau tempel payload teks.';
      return;
    }

    decodeMessage = 'Membaca kode QR secara lokal...';
    try {
      const bitmap = await createImageBitmap(file);
      // @ts-ignore
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const codes = await detector.detect(bitmap);
      bitmap.close();
      const payload = codes.find((c: any) => c.rawValue)?.rawValue?.trim();
      if (!payload) throw new Error('Kode QR tidak terdeteksi. Gunakan foto yang lebih tajam dan fokus.');
      qrisStatic = payload;
      decodeMessage = 'Kode QR berhasil didekode secara lokal! Silakan simpan pengaturan.';
    } catch (err: any) {
      decodeMessage = err.message || 'Gagal membaca gambar QR.';
    }
  }

  async function handleSaveSettings(e: Event) {
    e.preventDefault();
    settingsMessage = '';
    isSavingSettings = true;
    try {
      await api('/settings', {
        method: 'PUT',
        body: JSON.stringify({ qris_static: qrisStatic, merchant_id: merchantId })
      });
      settingsMessage = 'Pengaturan berhasil disimpan dengan aman.';
      qrisStatic = '';
      await loadDashboard();
    } catch (err: any) {
      settingsMessage = err.message;
    } finally {
      isSavingSettings = false;
    }
  }

  async function handleRequestOtp(e: Event) {
    e.preventDefault();
    otpMessage = '';
    isRequestingOtp = true;
    try {
      const res = await api('/setup/otp', {
        method: 'POST',
        body: JSON.stringify({ phone })
      });
      otpMessage = `OTP terkirim ke WhatsApp/SMS. Berlaku selama ${res?.expires_in || 720} detik.`;
      otpRequested = true;
    } catch (err: any) {
      otpMessage = err.message;
    } finally {
      isRequestingOtp = false;
    }
  }

  async function handleVerifyOtp(e: Event) {
    e.preventDefault();
    verifyMessage = '';
    isVerifyingOtp = true;
    try {
      await api('/setup/verify', {
        method: 'POST',
        body: JSON.stringify({ otp })
      });
      verifyMessage = 'Akun GoBiz berhasil terhubung!';
      otp = '';
      await loadDashboard();
    } catch (err: any) {
      verifyMessage = err.message;
    } finally {
      isVerifyingOtp = false;
    }
  }

  async function handleGenerateQris(e: Event) {
    e.preventDefault();
    generateMessage = '';
    isGenerating = true;
    try {
      const data = await api('/qris', {
        method: 'POST',
        body: JSON.stringify({
          amount: generateAmount,
          reference: generateReference,
          callback_url: generateCallback
        })
      });
      generatedQris = data;
      generateMessage = 'QRIS berhasil dibuat. Berlaku selama 5 menit.';
      await loadDashboard();
    } catch (err: any) {
      generateMessage = err.message;
    } finally {
      isGenerating = false;
    }
  }

  async function handleRegisterWebhook(e: Event) {
    e.preventDefault();
    webhookMessage = '';
    isRegisteringWebhook = true;
    try {
      await api('/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          url: webhookUrl,
          secret: webhookSecret,
          events: ['payment.success']
        })
      });
      webhookMessage = 'Webhook terverifikasi dan berhasil didaftarkan.';
      webhookUrl = '';
      webhookSecret = '';
      await loadWebhooks();
    } catch (err: any) {
      webhookMessage = err.message;
    } finally {
      isRegisteringWebhook = false;
    }
  }

  async function handleRemoveWebhook(id: string) {
    if (!confirm('Hapus webhook ini?')) return;
    try {
      await api(`/webhooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadWebhooks();
    } catch (err: any) {
      alert('Gagal menghapus webhook: ' + err.message);
    }
  }

  async function handleMarkAsPaid(id: string) {
    if (!confirm('Tandai transaksi ini sebagai LUNAS secara manual?')) return;
    try {
      await api(`/qris/${encodeURIComponent(id)}/mark-paid`, { method: 'POST' });
      await loadDashboard();
    } catch (err: any) {
      alert('Gagal menandai lunas: ' + err.message);
    }
  }
</script>

<svelte:head>
  <title>GoPay Gateway Control</title>
</svelte:head>

{#if !authenticated}
  <!-- Login Screen -->
  <main class="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4 selection:bg-emerald-500/30">
    <div class="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl">
      <div class="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>
      <div class="mb-8">
        <span class="text-xs font-bold tracking-widest text-emerald-400 uppercase">Private Control Plane</span>
        <h1 class="text-3xl font-extrabold text-white tracking-tight mt-1">Gateway Admin</h1>
        <p class="text-sm text-neutral-400 mt-2">Masuk untuk mengelola dan memantau gateway pembayaran mandiri.</p>
      </div>

      <form onsubmit={handleLogin} class="space-y-5">
        <div>
          <label for="admin-pass" class="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-2">Admin Password</label>
          <input
            id="admin-pass"
            type="password"
            bind:value={password}
            minlength="12"
            required
            placeholder="••••••••••••"
            class="w-full px-4 py-3 bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-mono text-sm"
          />
        </div>

        {#if loginError}
          <div class="p-3 bg-red-950/40 border border-red-900/50 rounded-xl text-red-400 text-xs leading-relaxed" role="alert">
            {loginError}
          </div>
        {/if}

        <button
          type="submit"
          disabled={isLoggingIn}
          class="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
        >
          {#if isLoggingIn}
            <span class="w-4 h-4 border-2 border-neutral-950 border-t-transparent rounded-full animate-spin"></span>
            Memeriksa...
          {:else}
            Buka Panel Admin
          {/if}
        </button>
      </form>
    </div>
  </main>
{:else}
  <!-- Dashboard Layout -->
  <div class="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col md:flex-row selection:bg-emerald-500/30">
    <!-- Sidebar -->
    <aside class="w-full md:w-64 bg-neutral-900/60 border-b md:border-b-0 md:border-r border-neutral-800/80 p-6 flex flex-col justify-between backdrop-blur-md shrink-0">
      <div>
        <div class="flex items-center gap-3 mb-8">
          <div class="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center font-black text-neutral-950 text-base shadow-md shadow-emerald-500/20">
            G
          </div>
          <div>
            <span class="text-[10px] font-extrabold uppercase tracking-widest text-emerald-400 block leading-none">GoPay QRIS</span>
            <span class="text-base font-bold text-white tracking-tight">Control Room</span>
          </div>
        </div>

        <nav class="space-y-1">
          <button
            onclick={() => setView('overview')}
            disabled={onboarding}
            class="w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-3 {view === 'overview' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'} disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h7v9H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 16h7v5H3z"/></svg>
            Overview
          </button>

          <button
            onclick={() => setView('generate')}
            disabled={onboarding}
            class="w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-3 {view === 'generate' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'} disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 7h.01M17 7h.01M7 17h.01M17 17h.01"/></svg>
            Generate QRIS
          </button>

          <button
            onclick={() => setView('setup')}
            class="w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-3 {view === 'setup' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'}"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            Gateway Setup
          </button>

          <button
            onclick={() => setView('docs')}
            class="w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-3 {view === 'docs' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'}"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10M6 14h6"/></svg>
            API Reference
          </button>

          <button
            onclick={() => setView('logs')}
            class="w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center gap-3 {view === 'logs' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'text-neutral-400 hover:text-white hover:bg-neutral-800/50'}"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M12 7v5l3 3"/></svg>
            Activity Logs
          </button>
        </nav>
      </div>

      <div class="pt-6 border-t border-neutral-800/60 mt-6">
        <button
          onclick={handleLogout}
          class="w-full text-left px-3.5 py-2 text-xs font-semibold text-neutral-500 hover:text-red-400 rounded-lg transition-colors flex items-center gap-2"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
          Sign Out
        </button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 p-6 md:p-10 overflow-y-auto max-w-7xl mx-auto w-full">
      <!-- Header Bar -->
      <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-8 border-b border-neutral-800/80 mb-8">
        <div>
          <span class="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">Management Console</span>
          <h1 class="text-2xl md:text-3xl font-extrabold text-white tracking-tight">{pageTitles[view]}</h1>
        </div>

        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 px-3 py-1.5 rounded-full border {ready ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-400' : 'bg-amber-950/40 border-amber-800/50 text-amber-400'} text-xs font-medium">
            <span class="w-2 h-2 rounded-full {ready ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}"></span>
            {connection}
          </div>
        </div>
      </header>

      <!-- View: Overview -->
      {#if view === 'overview'}
        {#if dashboard}
          <!-- Metrics Cards -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-5 backdrop-blur-sm">
              <span class="text-xs font-medium text-neutral-400">Total QRIS Dibuat</span>
              <strong class="block text-2xl md:text-3xl font-bold text-white mt-2">{dashboard.summary.total}</strong>
            </div>
            <div class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-5 backdrop-blur-sm">
              <span class="text-xs font-medium text-neutral-400">Pembayaran Sukses</span>
              <strong class="block text-2xl md:text-3xl font-bold text-emerald-400 mt-2">{dashboard.summary.paid}</strong>
            </div>
            <div class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-5 backdrop-blur-sm">
              <span class="text-xs font-medium text-neutral-400">Volume Transaksi Lunas</span>
              <strong class="block text-2xl md:text-3xl font-bold text-white mt-2">{money(dashboard.summary.paid_volume)}</strong>
            </div>
            <div class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-5 backdrop-blur-sm">
              <span class="text-xs font-medium text-neutral-400">Tingkat Konversi</span>
              <strong class="block text-2xl md:text-3xl font-bold text-emerald-400 mt-2">{dashboard.summary.conversion_rate}%</strong>
            </div>
          </div>

          <!-- Charts and Readiness -->
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            <!-- Paid Volume Bars -->
            <div class="lg:col-span-2 bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-6 backdrop-blur-sm">
              <div class="flex items-center justify-between mb-6">
                <div>
                  <h3 class="font-bold text-white text-base">Aktivitas Pembayaran</h3>
                  <p class="text-xs text-neutral-500">Volume pembayaran {dashboard.range_days} hari terakhir</p>
                </div>
                <select
                  bind:value={range}
                  onchange={loadDashboard}
                  class="bg-neutral-950 border border-neutral-800 rounded-lg text-xs px-2.5 py-1.5 text-neutral-300 focus:outline-none focus:border-emerald-500"
                >
                  <option value="7">7 Hari</option>
                  <option value="30">30 Hari</option>
                  <option value="90">90 Hari</option>
                </select>
              </div>

              {#if dashboard.daily && dashboard.daily.length > 0}
                <PaymentChart daily={dashboard.daily} />
              {:else}
                <div class="h-52 flex items-center justify-center text-xs text-neutral-500">
                  Belum ada transaksi lunas dalam rentang waktu ini.
                </div>
              {/if}
            </div>

            <!-- Readiness Checklist -->
            <div class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-6 backdrop-blur-sm">
              <h3 class="font-bold text-white text-base mb-1">Status Kesiapan Gateway</h3>
              <p class="text-xs text-neutral-500 mb-6">Kelengkapan integrasi merchant</p>

              <div class="space-y-4">
                <div class="flex items-center justify-between pb-3 border-b border-neutral-800/60 text-sm">
                  <span class="text-neutral-400">QRIS Statis (Wajib)</span>
                  <span class="font-semibold {dashboard.setup.qris_configured ? 'text-emerald-400' : 'text-amber-400'}">
                    {dashboard.setup.qris_configured ? 'Ready' : 'Perlu Diisi'}
                  </span>
                </div>
                <div class="flex items-center justify-between pb-3 border-b border-neutral-800/60 text-sm">
                  <span class="text-neutral-400">Akun GoBiz (Opsional)</span>
                  <span class="font-semibold {dashboard.setup.session_configured ? 'text-emerald-400' : 'text-neutral-500'}">
                    {dashboard.setup.session_configured ? 'Terhubung' : 'Manual'}
                  </span>
                </div>
                <div class="flex items-center justify-between text-sm">
                  <span class="text-neutral-400">Mode Verifikasi</span>
                  <span class="font-semibold text-white px-2.5 py-1 bg-neutral-800 rounded-md text-xs">
                    {dashboard.setup.mode === 'full' ? 'Auto-Check (GoBiz)' : 'Manual (QRIS Saja)'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Recent Transactions -->
          <div class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-6 backdrop-blur-sm">
            <div class="flex items-center justify-between mb-4">
              <div>
                <h3 class="font-bold text-white text-base">QRIS Terakhir</h3>
                <p class="text-xs text-neutral-500">20 record transaksi terbaru</p>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead>
                  <tr class="text-xs font-semibold text-neutral-400 border-b border-neutral-800/80">
                    <th class="pb-3 pr-4">ID Transaksi</th>
                    <th class="pb-3 pr-4">Referensi</th>
                    <th class="pb-3 pr-4">Status</th>
                    <th class="pb-3 pr-4">Jumlah</th>
                    <th class="pb-3 pr-4">Waktu Dibuat</th>
                    <th class="pb-3">Tindakan</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-neutral-800/50">
                  {#if dashboard.recent && dashboard.recent.length > 0}
                    {#each dashboard.recent as row}
                      <tr class="hover:bg-neutral-800/20 transition-colors">
                        <td class="py-3.5 pr-4 font-mono text-xs text-neutral-300">{row.trx_id || row.id}</td>
                        <td class="py-3.5 pr-4 text-xs text-neutral-400">{row.reference || '-'}</td>
                        <td class="py-3.5 pr-4">
                          <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider
                            {row.status === 'PAID' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                             row.status === 'EXPIRED' ? 'bg-red-950 text-red-400 border border-red-800' :
                             'bg-amber-950 text-amber-400 border border-amber-800'}">
                            {row.status}
                          </span>
                        </td>
                        <td class="py-3.5 pr-4 font-semibold text-white">{money(row.amount)}</td>
                        <td class="py-3.5 pr-4 text-xs text-neutral-400">{new Date(row.created_at).toLocaleString('id-ID')}</td>
                        <td class="py-3.5">
                          {#if row.status === 'PENDING'}
                            <button
                              onclick={() => handleMarkAsPaid(row.id)}
                              class="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-xs font-semibold transition-colors"
                            >
                              Tandai Lunas
                            </button>
                          {:else}
                            <span class="text-neutral-600 text-xs">-</span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  {:else}
                    <tr>
                      <td colspan="6" class="py-8 text-center text-neutral-500 text-xs">Belum ada data transaksi QRIS.</td>
                    </tr>
                  {/if}
                </tbody>
              </table>
            </div>
          </div>
        {/if}
      {/if}

      <!-- View: Generate QRIS -->
      {#if view === 'generate'}
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <form onsubmit={handleGenerateQris} class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-6 backdrop-blur-sm space-y-4">
            <div>
              <span class="text-xs font-bold text-emerald-400 uppercase tracking-widest">Dynamic Payment</span>
              <h3 class="text-xl font-bold text-white mt-1">Buat QRIS Baru</h3>
              <p class="text-xs text-neutral-400 mt-1">Generate pembayaran QRIS dinamis 5 menit tanpa mengekspos API key publik.</p>
            </div>

            <div>
              <label for="gen-amount" class="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-2">Jumlah Pembayaran (IDR) *</label>
              <input
                id="gen-amount"
                type="number"
                bind:value={generateAmount}
                min="1"
                required
                placeholder="Contoh: 50000"
                class="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 text-sm font-mono"
              />
            </div>

            <div>
              <label for="gen-ref" class="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-2">ID Referensi / Invoice (Opsional)</label>
              <input
                id="gen-ref"
                type="text"
                bind:value={generateReference}
                placeholder="Contoh: INV-2026-001"
                class="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 text-sm font-mono"
              />
            </div>

            <div>
              <label for="gen-callback" class="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-2">Callback URL Pengalihan (Opsional)</label>
              <input
                id="gen-callback"
                type="url"
                bind:value={generateCallback}
                placeholder="https://merchant.example.com/payment/callback"
                class="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 text-sm font-mono"
              />
            </div>

            {#if generateMessage}
              <div class="p-3 bg-neutral-950 border border-neutral-800 rounded-xl text-xs text-emerald-400">
                {generateMessage}
              </div>
            {/if}

            <button
              type="submit"
              disabled={isGenerating}
              class="w-full py-3 px-4 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl transition-all shadow-md shadow-emerald-500/10 text-sm disabled:opacity-50"
            >
              {isGenerating ? 'Membuat QRIS...' : 'Generate Kode Pembayaran'}
            </button>
          </form>

          {#if generatedQris}
            <div class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-6 backdrop-blur-sm text-center">
              <span class="text-xs font-bold text-emerald-400 uppercase tracking-widest">Siap Discan</span>
              <h3 class="text-2xl font-black text-white mt-1">{money(generatedQris.amount)}</h3>

              <div class="w-64 h-64 bg-white p-3 rounded-2xl mx-auto my-6 shadow-xl flex items-center justify-center">
                <img
                  src="/admin/api/qris/{generatedQris.qris_id}/image"
                  alt="Kode QRIS"
                  class="w-full h-full object-contain"
                />
              </div>

              <div class="text-left space-y-2 text-xs bg-neutral-950 border border-neutral-800/80 rounded-xl p-4 mb-6 font-mono">
                <div class="flex justify-between">
                  <span class="text-neutral-500">ID Transaksi</span>
                  <span class="text-neutral-200">{generatedQris.trx_id}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-neutral-500">Berlaku Sampai</span>
                  <span class="text-neutral-200">{new Date(generatedQris.expires_at).toLocaleTimeString('id-ID')}</span>
                </div>
              </div>

              <div class="flex gap-3">
                <a
                  href={generatedQris.qris_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="flex-1 py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl text-xs transition-colors"
                >
                  Buka Halaman Bayar
                </a>
                <a
                  href="/admin/api/qris/{generatedQris.qris_id}/image"
                  download="qris-{generatedQris.qris_id}.png"
                  class="py-2.5 px-4 bg-neutral-800 hover:bg-neutral-700 text-white font-semibold rounded-xl text-xs transition-colors border border-neutral-700"
                >
                  Unduh PNG
                </a>
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- View: Setup -->
      {#if view === 'setup'}
        {#if onboarding}
          <div class="p-6 bg-emerald-950/30 border border-emerald-800/40 rounded-2xl mb-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <span class="text-xs font-bold text-emerald-400 uppercase tracking-wider">Setup Pertama Kali</span>
              <h2 class="text-xl font-bold text-white mt-1">Lengkapi Pengaturan Gateway</h2>
              <p class="text-xs text-neutral-400 mt-1">Upload QRIS statis untuk mulai menerima pembayaran. Koneksi GoBiz bersifat opsional jika Anda ingin verifikasi otomatis.</p>
            </div>
            <div class="flex gap-2">
              <div class="px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-xl text-xs font-semibold {dashboard?.setup?.qris_configured ? 'text-emerald-400 border-emerald-800' : 'text-amber-400'}">
                01 QRIS Statis: {dashboard?.setup?.qris_configured ? 'OK' : 'Perlu'}
              </div>
              <div class="px-3 py-2 bg-neutral-900 border border-neutral-800 rounded-xl text-xs font-semibold {dashboard?.setup?.session_configured ? 'text-emerald-400 border-emerald-800' : 'text-neutral-500'}">
                02 GoBiz: {dashboard?.setup?.session_configured ? 'OK' : 'Opsional'}
              </div>
            </div>
          </div>
        {/if}

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start mb-8">
          <!-- Step 1: Static QRIS -->
          <form onsubmit={handleSaveSettings} class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-6 backdrop-blur-sm space-y-4">
            <div>
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-bold text-emerald-400 uppercase tracking-widest">01 / Identitas Pembayaran (Wajib)</span>
                {#if dashboard?.setup?.qris_configured}
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/80 border border-emerald-800 text-emerald-400">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    Sudah Dikonfigurasi
                  </span>
                {:else}
                  <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-950/80 border border-amber-800 text-amber-400">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    Belum Dikonfigurasi
                  </span>
                {/if}
              </div>
              <h3 class="text-xl font-bold text-white mt-1">Konfigurasi QRIS Statis</h3>
              <p class="text-xs text-neutral-400 mt-1">Pilih gambar QR untuk didekode langsung secara privat di browser Anda, atau tempel string EMVCo manual.</p>
            </div>

            {#if dashboard?.setup?.qris_configured}
              <div class="p-3.5 bg-emerald-950/30 border border-emerald-800/40 rounded-xl text-xs space-y-1">
                <div class="flex items-center justify-between text-neutral-300">
                  <span class="font-medium text-emerald-400">Status Template QRIS:</span>
                  <span class="font-bold text-white">Aktif & Tersimpan</span>
                </div>
                {#if dashboard?.setup?.merchant_id_configured}
                  <div class="flex items-center justify-between text-neutral-400">
                    <span>Merchant ID:</span>
                    <span class="font-mono text-neutral-200">{dashboard.setup.merchant_id || 'Terkonfigurasi'}</span>
                  </div>
                {/if}
                <p class="text-[11px] text-neutral-400 pt-1">Anda dapat mengunggah gambar QR baru atau memasukkan string baru di bawah untuk memperbarui template kapan saja.</p>
              </div>
            {/if}

            <div class="p-4 bg-neutral-950 border border-dashed border-neutral-800 rounded-xl text-center">
              <label for="qris-img-input" class="cursor-pointer block">
                <span class="text-xs text-neutral-300 font-semibold block mb-1">Pilih / Upload Gambar QRIS</span>
                <span class="text-[11px] text-neutral-500 block">Mendukung file PNG, JPG, WebP (Didekode lokal via BarcodeDetector)</span>
                <input
                  id="qris-img-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onchange={handleDecodeQris}
                  class="hidden"
                />
              </label>
            </div>

            {#if decodeMessage}
              <p class="text-xs text-emerald-400 bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">{decodeMessage}</p>
            {/if}

            <div>
              <label for="qris-payload-input" class="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-2">Payload String QRIS Statis</label>
              <textarea
                id="qris-payload-input"
                bind:value={qrisStatic}
                rows="4"
                placeholder="00020101021126610014..."
                class="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 text-xs font-mono resize-y"
              ></textarea>
            </div>

            <div>
              <label for="merchant-id-input" class="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-2">Merchant ID (Opsional)</label>
              <input
                id="merchant-id-input"
                type="text"
                bind:value={merchantId}
                placeholder="Terdeteksi otomatis bila terhubung GoBiz"
                class="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 text-sm font-mono"
              />
            </div>

            {#if settingsMessage}
              <p class="text-xs text-emerald-400 bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">{settingsMessage}</p>
            {/if}

            <button
              type="submit"
              disabled={isSavingSettings}
              class="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl text-xs transition-colors disabled:opacity-50"
            >
              {isSavingSettings ? 'Menyimpan...' : 'Simpan Pengaturan QRIS'}
            </button>
          </form>

          <!-- Step 2: GoBiz OTP Connection -->
          <div class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-6 backdrop-blur-sm space-y-6">
            <form onsubmit={handleRequestOtp} class="space-y-4">
              <div>
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-bold text-neutral-400 uppercase tracking-widest">02 / Sesi GoBiz (Opsional)</span>
                  {#if dashboard?.setup?.session_configured}
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/80 border border-emerald-800 text-emerald-400">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      Terhubung
                    </span>
                  {:else}
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-neutral-800 border border-neutral-700 text-neutral-400">
                      Belum Terhubung
                    </span>
                  {/if}
                </div>
                <h3 class="text-xl font-bold text-white mt-1">Sambungkan Akun GoBiz</h3>
                <p class="text-xs text-neutral-400 mt-1">Kirim OTP ke nomor telepon terdaftar GoBiz untuk verifikasi mutasi otomatis secara real-time.</p>
              </div>

              {#if dashboard?.setup?.session_configured}
                <div class="p-3.5 bg-emerald-950/30 border border-emerald-800/40 rounded-xl text-xs space-y-1">
                  <div class="flex items-center justify-between text-neutral-300">
                    <span class="font-medium text-emerald-400">Status Sesi:</span>
                    <span class="font-bold text-white">Aktif (Verifikasi Otomatis Nyala)</span>
                  </div>
                  {#if dashboard?.setup?.outlet_name}
                    <div class="flex items-center justify-between text-neutral-400">
                      <span>Outlet:</span>
                      <span class="text-white font-semibold">{dashboard.setup.outlet_name}</span>
                    </div>
                  {/if}
                  {#if dashboard?.setup?.session_expires_at}
                    <div class="flex items-center justify-between text-neutral-400">
                      <span>Berlaku Hingga:</span>
                      <span class="text-neutral-300">{new Date(dashboard.setup.session_expires_at).toLocaleString('id-ID')}</span>
                    </div>
                  {/if}
                  <p class="text-[11px] text-neutral-400 pt-1">Kirim OTP ulang di bawah jika Anda ingin mengganti akun GoBiz atau memperbarui sesi secara manual.</p>
                </div>
              {/if}

              <div>
                <label for="phone-input" class="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-2">Nomor Telepon GoBiz</label>
                <input
                  id="phone-input"
                  type="tel"
                  bind:value={phone}
                  required
                  placeholder="0812xxxxxxxx"
                  class="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 text-sm font-mono"
                />
              </div>

              {#if otpMessage}
                <p class="text-xs text-emerald-400 bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">{otpMessage}</p>
              {/if}

              <button
                type="submit"
                disabled={isRequestingOtp}
                class="w-full py-2.5 px-4 bg-neutral-800 hover:bg-neutral-700 text-white font-semibold rounded-xl text-xs transition-colors border border-neutral-700 disabled:opacity-50"
              >
                {isRequestingOtp ? 'Mengirim...' : 'Kirim Kode OTP'}
              </button>
            </form>

            {#if otpRequested}
              <form onsubmit={handleVerifyOtp} class="pt-6 border-t border-neutral-800/60 space-y-4">
                <div>
                  <span class="text-xs font-bold text-emerald-400 uppercase tracking-widest">Verifikasi Kode</span>
                  <label for="otp-code-input" class="block text-xs font-semibold text-neutral-300 uppercase tracking-wider my-2">Masukkan Kode OTP</label>
                  <input
                    id="otp-code-input"
                    type="text"
                    bind:value={otp}
                    required
                    pattern="[0-9]+"
                    placeholder="Contoh: 1234"
                    class="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 text-sm font-mono text-center tracking-widest text-lg"
                  />
                </div>

                {#if verifyMessage}
                  <p class="text-xs text-emerald-400 bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">{verifyMessage}</p>
                {/if}

                <button
                  type="submit"
                  disabled={isVerifyingOtp}
                  class="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl text-xs transition-colors disabled:opacity-50"
                >
                  {isVerifyingOtp ? 'Memverifikasi...' : 'Verifikasi & Hubungkan'}
                </button>
              </form>
            {/if}
          </div>
        </div>

        <!-- Webhook Configuration -->
        <div class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-6 backdrop-blur-sm">
          <div class="mb-6">
            <span class="text-xs font-bold text-emerald-400 uppercase tracking-widest">Notifikasi Transaksi</span>
            <h3 class="text-xl font-bold text-white mt-1">Registrasi Webhook</h3>
            <p class="text-xs text-neutral-400 mt-1">Gateway akan mem-ping URL tujuan terlebih dahulu sebelum menyimpannya untuk validasi.</p>
          </div>

          <form onsubmit={handleRegisterWebhook} class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div class="md:col-span-2">
              <label for="webhook-url" class="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-2">Endpoint URL *</label>
              <input
                id="webhook-url"
                type="url"
                bind:value={webhookUrl}
                required
                placeholder="https://myshop.com/api/webhooks/gopay"
                class="w-full px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 text-xs font-mono"
              />
            </div>
            <div>
              <label for="webhook-secret" class="block text-xs font-semibold text-neutral-300 uppercase tracking-wider mb-2">Signing Secret (Opsional)</label>
              <input
                id="webhook-secret"
                type="password"
                bind:value={webhookSecret}
                placeholder="••••••••••••"
                class="w-full px-4 py-2 bg-neutral-950 border border-neutral-800 rounded-xl text-white placeholder-neutral-600 focus:outline-none focus:border-emerald-500 text-xs font-mono"
              />
            </div>

            {#if webhookMessage}
              <div class="md:col-span-3 text-xs text-emerald-400 bg-neutral-950 p-2.5 rounded-lg border border-neutral-800">
                {webhookMessage}
              </div>
            {/if}

            <div class="md:col-span-3">
              <button
                type="submit"
                disabled={isRegisteringWebhook}
                class="py-2 px-4 bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold rounded-xl text-xs transition-colors disabled:opacity-50"
              >
                {isRegisteringWebhook ? 'Memverifikasi...' : 'Daftarkan Webhook'}
              </button>
            </div>
          </form>

          <!-- Webhook List -->
          <div class="space-y-2 border-t border-neutral-800/80 pt-4">
            <h4 class="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">Daftar Webhook Aktif</h4>
            {#if webhooks && webhooks.length > 0}
              {#each webhooks as wh}
                <div class="flex items-center justify-between p-3 bg-neutral-950 border border-neutral-800/80 rounded-xl text-xs">
                  <div>
                    <span class="font-mono text-white block">{wh.url}</span>
                    <span class="text-[11px] text-neutral-500 mt-0.5 block">Events: {wh.events?.join(', ')} {wh.has_secret ? '• Ditandatangani HMAC' : ''}</span>
                  </div>
                  <button
                    onclick={() => handleRemoveWebhook(wh.id)}
                    class="text-red-400 hover:text-red-300 font-semibold px-2 py-1 rounded bg-red-950/40 border border-red-900/50"
                  >
                    Hapus
                  </button>
                </div>
              {/each}
            {:else}
              <p class="text-xs text-neutral-500 py-2">Belum ada webhook yang terdaftar.</p>
            {/if}
          </div>
        </div>
      {/if}

      <!-- View: API Docs -->
      {#if view === 'docs'}
        <div class="space-y-4">
          <div class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-6 backdrop-blur-sm mb-6">
            <span class="text-xs font-bold text-emerald-400 uppercase tracking-widest">REST API v1</span>
            <h3 class="text-xl font-bold text-white mt-1">Referensi Integrasi OpenAPI / Swagger</h3>
            <p class="text-xs text-neutral-400 mt-1">Endpoint privat membutuhkan header <code>x-api-key</code> atau Bearer JWT. Halaman pembayaran dan polling status berstatus publik.</p>
          </div>

          <div class="space-y-3">
            {#each endpoints as ep}
              <details class="group bg-neutral-900/60 border border-neutral-800/80 rounded-2xl overflow-hidden backdrop-blur-sm">
                <summary class="p-4 md:p-5 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 select-none hover:bg-neutral-800/20 transition-colors">
                  <div class="flex items-center gap-3">
                    <span class="px-2.5 py-1 rounded text-[11px] font-black tracking-wider uppercase
                      {ep.method === 'POST' ? 'bg-blue-950 text-blue-400 border border-blue-800' :
                       ep.method === 'DELETE' ? 'bg-red-950 text-red-400 border border-red-800' :
                       'bg-emerald-950 text-emerald-400 border border-emerald-800'}">
                      {ep.method}
                    </span>
                    <code class="font-mono text-sm text-neutral-200">{ep.path}</code>
                  </div>
                  <div class="flex items-center gap-4 text-xs">
                    <span class="text-neutral-400 font-medium">{ep.summary}</span>
                    <span class="text-[10px] text-neutral-500 px-2 py-0.5 bg-neutral-950 border border-neutral-800 rounded">{ep.auth}</span>
                  </div>
                </summary>

                <div class="p-6 border-t border-neutral-800/80 bg-neutral-950/40 space-y-6">
                  {#if ep.params}
                    <div>
                      <h4 class="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">Parameters</h4>
                      <div class="border border-neutral-800 rounded-xl overflow-hidden divide-y divide-neutral-800/60 text-xs">
                        {#each ep.params as [pName, pIn, pType, pDesc]}
                          <div class="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div class="flex items-center gap-2">
                              <code class="font-bold text-emerald-400">{pName}</code>
                              <span class="text-[10px] text-neutral-500">({pIn}, {pType})</span>
                            </div>
                            <span class="text-neutral-400">{pDesc}</span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  {#if ep.body}
                    <div>
                      <h4 class="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">Request Body (JSON)</h4>
                      <pre class="p-4 bg-neutral-950 border border-neutral-800 rounded-xl text-xs font-mono text-emerald-300 overflow-x-auto">{JSON.stringify(ep.body, null, 2)}</pre>
                    </div>
                  {/if}

                  <div>
                    <h4 class="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">Contoh Response</h4>
                    <pre class="p-4 bg-neutral-950 border border-neutral-800 rounded-xl text-xs font-mono text-neutral-300 overflow-x-auto">{typeof ep.response === 'string' ? ep.response : JSON.stringify(ep.response, null, 2)}</pre>
                  </div>
                </div>
              </details>
            {/each}
          </div>
        </div>
      {/if}

      <!-- View: Logs -->
      {#if view === 'logs'}
        <div class="bg-neutral-900/60 border border-neutral-800/80 rounded-2xl p-6 backdrop-blur-sm">
          <div class="flex items-center justify-between mb-6">
            <div>
              <span class="text-xs font-bold text-emerald-400 uppercase tracking-widest">Audit Trail</span>
              <h3 class="text-xl font-bold text-white mt-1">Aktivitas Gateway</h3>
              <p class="text-xs text-neutral-400 mt-1">Catatan event operasional persisten.</p>
            </div>
            <button
              onclick={loadLogs}
              class="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-semibold border border-neutral-700 transition-colors"
            >
              Refresh
            </button>
          </div>

          <div class="space-y-2 divide-y divide-neutral-800/60 font-mono text-xs">
            {#if logs && logs.length > 0}
              {#each logs as l}
                <div class="pt-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <span class="text-neutral-500 text-[11px] shrink-0">{new Date(l.timestamp).toLocaleString('id-ID')}</span>
                  <span class="font-bold px-1.5 py-0.5 rounded text-[10px] uppercase shrink-0
                    {l.type === 'ERROR' ? 'bg-red-950 text-red-400' :
                     l.type === 'SUCCESS' ? 'bg-emerald-950 text-emerald-400' :
                     'bg-neutral-800 text-neutral-300'}">
                    {l.type}
                  </span>
                  <span class="text-neutral-200 break-all">{l.message}</span>
                </div>
              {/each}
            {:else}
              <p class="text-xs text-neutral-500 py-6 text-center">Belum ada aktivitas yang dicatat.</p>
            {/if}
          </div>
        </div>
      {/if}
    </main>
  </div>
{/if}
