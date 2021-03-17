<script context="module">
  import { createSWR } from "sswr"

  const preloadedData = new Map<string, any>()

  export const swr = createSWR({
    dedupingInterval: 10_000,
    fetcher: async (url: string) => {
      const fetch = typeof window !== "undefined"
        ? window.fetch
        : await import("node-fetch")
            .then(mod => mod.default)

      const resp = await fetch(url)
      if (!resp.ok) throw resp
      return resp.json()
    }
  })

  export const swrLoad = async (url: string) => {
    try {
      preloadedData.clear()
      preloadedData.set(url, await swr.useSWR(url))
      return { props: { url } }
    } catch (e) {
      return {
        status: (e as Response).status,
        error: new Error(`Could not load ${url}`)
      }
    }
  }
</script>

<script>
  import { onDestroy } from "svelte"
  import { fade } from "svelte/transition"

  export let url: string
  export let initialData: any = preloadedData.get(url)

  const {
    data: store, error, mutate, revalidate, clear, unsubscribe
  } = swr.useSWR(url, { initialData })

  $: list = $store as any[]
  $: model = $store as any

  onDestroy(unsubscribe)
</script>

{#if $store}
  <slot {list} {model} {mutate} {revalidate} {clear} />
{:else if $error}
  <slot name="error" error={$error}>
    <div><p>{$error}</p></div>
  </slot>
{:else}
  <slot name="loading">
    <div in:fade={{ duration: 100, delay: 200 }}>
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" class="m-auto" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid">
        <circle cx="50" cy="50" fill="none" stroke="#85a2b6" stroke-width="10" r="35" stroke-dasharray="164.93361431346415 56.97787143782138">
          <animateTransform attributeName="transform" type="rotate" repeatCount="indefinite" dur="1.5s" values="0 50 50;360 50 50" keyTimes="0;1"></animateTransform>
        </circle>
      </svg>
    </div>
  </slot>
{/if}

<style>
  div {
    @apply flex items-center justify-center w-full h-full max-w-sm p-4 m-auto max-h-64;
  }
</style>
