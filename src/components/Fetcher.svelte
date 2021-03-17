<script context="module">
  import { createSWR } from "sswr"

  const preloadedData = new Map<string, any>()

  export const swr = createSWR({
    dedupingInterval: 10000,
    loadInitialCache: true,
    fetcher: async (url: string) => {
      const fetch = typeof window !== 'undefined'
        ? window.fetch
        : await import('node-fetch')
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

  export let url: string
  export let initialData: any = preloadedData.get(url)

  const {
    data: store, error, mutate, revalidate, clear, unsubscribe
  } = swr.useSWR(url, { initialData })

  $: list = $store as any[]
  $: model = $store as any

  onDestroy(unsubscribe)
</script>

{#if $error}
  <slot name="error" {error}>
    Something went wrong...
  </slot>
{:else if $store}
  <slot {list} {model} {mutate} {revalidate} {clear} />
{:else}
  <slot name="loading">
    Loading...
  </slot>
{/if}
