<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    Chart,
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    CategoryScale,
    Filler,
    Tooltip
  } from 'chart.js';

  Chart.register(
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    CategoryScale,
    Filler,
    Tooltip
  );

  let { daily = [] }: { daily: Array<{ day: string; amount: number; total?: number; paid?: number }> } = $props();

  let canvasEl = $state<HTMLCanvasElement | null>(null);
  let chartInstance: Chart | null = null;

  const money = (val: number | string) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(
      Number(val || 0)
    );

  function renderChart() {
    if (!canvasEl) return;
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    const labels = daily.map(d => {
      const parts = d.day.split('-');
      return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d.day;
    });
    const amounts = daily.map(d => Number(d.amount || 0));

    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;

    const gradient = ctx.createLinearGradient(0, 0, 0, 200);
    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
    gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    chartInstance = new Chart(canvasEl, {
      type: 'line',
      data: {
        labels: labels.length > 0 ? labels : ['No Data'],
        datasets: [
          {
            label: 'Volume Pembayaran (IDR)',
            data: amounts.length > 0 ? amounts : [0],
            borderColor: '#10b981',
            borderWidth: 2.5,
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#09090b',
            pointBorderWidth: 2,
            pointRadius: 3.5,
            pointHoverRadius: 6,
            backgroundColor: gradient,
            fill: true,
            tension: 0.35
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index'
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#18181b',
            titleColor: '#a1a1aa',
            bodyColor: '#10b981',
            borderColor: '#27272a',
            borderWidth: 1,
            padding: 10,
            displayColors: false,
            callbacks: {
              label: (context) => `Volume: ${money(context.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(39, 39, 42, 0.4)'
            },
            ticks: {
              color: '#71717a',
              font: { size: 11 }
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(39, 39, 42, 0.4)'
            },
            ticks: {
              color: '#71717a',
              font: { size: 11 },
              callback: (value) => {
                const num = Number(value);
                if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
                if (num >= 1000) return (num / 1000).toFixed(0) + 'k';
                return num;
              }
            }
          }
        }
      }
    });
  }

  $effect(() => {
    // Re-render when daily data changes
    if (daily && canvasEl) {
      renderChart();
    }
  });

  onDestroy(() => {
    if (chartInstance) {
      chartInstance.destroy();
    }
  });
</script>

<div class="w-full h-52 relative">
  <canvas bind:this={canvasEl}></canvas>
</div>
