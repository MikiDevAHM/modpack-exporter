<!--
  Language selector — compact dropdown that switches the active locale
  at runtime and persists the choice. Built from native form controls so it
  matches neighboring settings rows without bespoke styling.
-->
<script lang="ts">
  import { i18n, locales } from '../../i18n/index.svelte';

  interface Props {
    label?: string;
    description?: string;
    class?: string;
  }

  let { label = 'Language', description, class: className = '' }: Props = $props();
</script>

<div class={className}>
  <label for="language-select" class="block text-xs font-medium text-muted-foreground mb-1">
    {label}
  </label>
  {#if description}
    <p class="text-[11px] text-muted-foreground mb-2 leading-snug">{description}</p>
  {/if}
  <select
    id="language-select"
    class="w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-primary/40"
    value={i18n.locale}
    onchange={(e) => i18n.setLocale((e.target as HTMLSelectElement).value)}
  >
    {#each locales as l (l.code)}
      <option value={l.code}>{l.meta.nativeName} ({l.meta.englishName})</option>
    {/each}
  </select>
</div>
