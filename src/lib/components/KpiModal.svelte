<script>
  import { onMount, onDestroy, tick, createEventDispatcher } from 'svelte';
  import { getApiUrl } from '$lib/config.js';
  import { X } from 'lucide-svelte';

  const dispatch = createEventDispatcher();

  let API_URL = '';
  let dialog;
  let previouslyFocused = null;

  const TIMEFRAMES = [
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'quarterly', label: 'Quarterly' },
    { key: 'yearly', label: 'Yearly' }
  ];

  let timeframe = 'weekly';
  let medium = 'discord';
  let webhookUrl = '';
  let honeypot = '';          // bots fill this; humans never see it

  let availability = {};      // timeframe -> { available, currentLabel, comparisonLabel, ... }
  let loadingAvailability = true;
  let sending = false;
  let result = null;          // { ok: boolean, message: string }
  let touched = false;

  const WEBHOOK_PATTERN =
    /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

  $: webhookValid = WEBHOOK_PATTERN.test(webhookUrl.trim());
  $: selected = availability[timeframe];
  $: timeframeUsable = !selected || selected.available;
  $: canSubmit = !sending && webhookValid && timeframeUsable;

  onMount(async () => {
    API_URL = getApiUrl();
    previouslyFocused = document.activeElement;
    await tick();
    dialog?.querySelector('input[type="radio"]:checked')?.focus();

    try {
      const response = await fetch(`${API_URL}/api/kpi/availability`);
      const data = await response.json();
      availability = Object.fromEntries((data.timeframes || []).map(t => [t.timeframe, t]));
    } catch (error) {
      console.error('KPI availability check failed:', error);
    } finally {
      loadingAvailability = false;
    }
  });

  onDestroy(() => previouslyFocused?.focus?.());

  function close() {
    dispatch('close');
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }

    if (event.key !== 'Tab') return;

    // Focus trap
    const focusable = dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit() {
    touched = true;
    if (!canSubmit) return;

    sending = true;
    result = null;

    try {
      const response = await fetch(`${API_URL}/api/kpi-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeframe,
          medium,
          target: webhookUrl.trim(),
          website: honeypot
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        const partial = data.metricsReported < data.metricsTotal
          ? ` ${data.metricsTotal - data.metricsReported} metric(s) lacked full history and were marked as insufficient data.`
          : '';
        result = {
          ok: true,
          message: `Report sent: ${data.currentLabel} vs ${data.comparisonLabel}.${partial}`
        };
      } else {
        result = { ok: false, message: data.error || 'Could not send the report.' };
      }
    } catch (error) {
      result = { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
    } finally {
      sending = false;
    }
  }
</script>

<svelte:window on:keydown={onKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="kpi-backdrop" on:click={close}>
  <div
    class="kpi-dialog terminal-border"
    role="dialog"
    aria-modal="true"
    aria-labelledby="kpi-title"
    bind:this={dialog}
    on:click|stopPropagation
  >
    <div class="kpi-header">
      <h2 id="kpi-title" class="kpi-title">KPI Report</h2>
      <button class="kpi-close" on:click={close} aria-label="Close">
        <X size={16} strokeWidth={2} />
      </button>
    </div>

    <p class="kpi-intro">
      Compares the most recently completed period against the one before it. The
      in-progress period is never included.
    </p>

    <fieldset class="kpi-field">
      <legend>Time frame</legend>
      <div class="kpi-radios">
        {#each TIMEFRAMES as option}
          {@const info = availability[option.key]}
          {@const disabled = loadingAvailability ? false : info && !info.available}
          <label class="kpi-radio" class:disabled>
            <input
              type="radio"
              name="timeframe"
              value={option.key}
              bind:group={timeframe}
              {disabled}
            />
            <span class="kpi-radio-label">{option.label}</span>
            {#if info}
              <span class="kpi-radio-hint">
                {#if info.available}
                  {info.currentLabel} vs {info.comparisonLabel}
                {:else}
                  Not enough history yet
                {/if}
              </span>
            {/if}
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="kpi-field">
      <legend>Delivery</legend>
      <div class="kpi-radios">
        <label class="kpi-radio">
          <input type="radio" name="medium" value="discord" bind:group={medium} />
          <span class="kpi-radio-label">Discord</span>
        </label>
        <label class="kpi-radio disabled">
          <input type="radio" name="medium" value="email" disabled />
          <span class="kpi-radio-label">Email</span>
          <span class="kpi-radio-hint">Not configured on this instance</span>
        </label>
      </div>
    </fieldset>

    <div class="kpi-field">
      <label class="kpi-input-label" for="kpi-webhook">Discord webhook URL</label>
      <input
        id="kpi-webhook"
        class="kpi-input"
        class:invalid={touched && !webhookValid}
        type="url"
        inputmode="url"
        autocomplete="off"
        placeholder="https://discord.com/api/webhooks/..."
        bind:value={webhookUrl}
        on:blur={() => (touched = true)}
      />
      {#if touched && !webhookValid}
        <div class="kpi-error">Enter a valid Discord webhook URL.</div>
      {/if}
    </div>

    <!-- Honeypot: off-screen and aria-hidden, never shown to a real user -->
    <input
      class="kpi-honeypot"
      type="text"
      name="website"
      tabindex="-1"
      autocomplete="off"
      aria-hidden="true"
      bind:value={honeypot}
    />

    {#if selected && !selected.available}
      <div class="kpi-notice">
        There isn't enough history for a {timeframe} report yet
        ({selected.currentLabel} vs {selected.comparisonLabel}). Choose a shorter time frame.
      </div>
    {/if}

    {#if result}
      <div class="kpi-result" class:ok={result.ok} class:fail={!result.ok} role="status">
        {result.message}
      </div>
    {/if}

    <div class="kpi-actions">
      <button class="kpi-btn" on:click={close} disabled={sending}>Cancel</button>
      <button class="kpi-btn primary" on:click={submit} disabled={!canSubmit}>
        {sending ? 'Sending...' : 'Send KPI Report'}
      </button>
    </div>
  </div>
</div>

<style>
  .kpi-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-md);
    z-index: 1000;
  }

  .kpi-dialog {
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    padding: var(--spacing-lg);
    width: 100%;
    max-width: 520px;
    max-height: 90vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .kpi-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-md);
  }

  .kpi-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: 1px;
    text-transform: uppercase;
  }

  .kpi-close {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-dim);
    border-radius: var(--radius-sm);
    padding: 0.25rem;
    cursor: pointer;
    display: flex;
  }

  .kpi-close:hover {
    color: var(--text-primary);
    border-color: var(--border-glow);
  }

  .kpi-intro {
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  .kpi-field {
    border: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .kpi-field legend,
  .kpi-input-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    font-weight: 600;
    padding: 0;
  }

  .kpi-radios {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .kpi-radio {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--text-dim);
    /* Comfortable tap target on mobile */
    min-height: 2.25rem;
  }

  .kpi-radio:hover:not(.disabled) {
    border-color: var(--border-glow);
  }

  .kpi-radio.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .kpi-radio-label {
    font-weight: 600;
    color: var(--text-white);
  }

  .kpi-radio.disabled .kpi-radio-label {
    color: var(--text-dim);
  }

  .kpi-radio-hint {
    font-size: 0.68rem;
    color: var(--text-muted);
    min-width: 0;
  }

  .kpi-input {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    color: var(--text-white);
    padding: 0.5rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    width: 100%;
  }

  .kpi-input:focus {
    outline: none;
    border-color: var(--text-primary);
  }

  .kpi-input.invalid {
    border-color: var(--accent-red, #ff5555);
  }

  .kpi-honeypot {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .kpi-error {
    font-size: 0.7rem;
    color: var(--accent-red, #ff5555);
  }

  .kpi-notice,
  .kpi-result {
    font-size: 0.75rem;
    line-height: 1.5;
    padding: 0.5rem 0.6rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    color: var(--text-dim);
  }

  .kpi-result.ok {
    border-color: var(--accent-green);
    color: var(--accent-green);
  }

  .kpi-result.fail {
    border-color: var(--accent-red, #ff5555);
    color: var(--accent-red, #ff5555);
  }

  .kpi-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    flex-wrap: wrap;
  }

  .kpi-btn {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-dim);
    padding: 0.45rem 0.9rem;
    border-radius: var(--radius-sm);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s ease;
    min-height: 2.25rem;
  }

  .kpi-btn:hover:not(:disabled) {
    color: var(--text-primary);
    border-color: var(--border-glow);
  }

  .kpi-btn.primary {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }

  .kpi-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  @media (max-width: 600px) {
    .kpi-dialog {
      padding: var(--spacing-md);
      max-height: 100vh;
      border-radius: 0;
    }

    .kpi-backdrop {
      padding: 0;
      align-items: stretch;
    }

    .kpi-actions .kpi-btn {
      flex: 1;
    }
  }
</style>
