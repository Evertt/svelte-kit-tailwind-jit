<script context="module">
  import { createSWR } from "sswr"

  export const fetchAndCache = async (url: string, fetch?: typeof window.fetch) => {
    const request = new Request(url)

    if (typeof window === "undefined") {
      return fetch(url)
    }

    fetch = fetch || window.fetch

    const cache = await window.caches.open("fetcher")
    const cachedResp = await cache.match(request)

    if (cachedResp) {
      const date = new Date(cachedResp.headers.get("date"))
      if (new Date().getTime() - date.getTime() < 10000) {
        return cachedResp
      }
    }

    const resp = await fetch(url)
    const headers = new Headers(resp.headers)
    headers.append("date", new Date().toUTCString())
    await cache.put(request, new Response(resp.clone().body, { headers }))
    return resp
  }

  const swr = createSWR<any>({
    fetcher: async (url: string) => {
      if (typeof fetch === "undefined") {
        return new Promise<void>(r => r())
      } else {
        const resp = await fetchAndCache(url)
        return resp.json()
      }
    }
  })
</script>

<script>
  import { onDestroy } from "svelte"

  export let url: string
  export let initialData: any = null

  const {
    data: store, error, mutate, revalidate, clear, unsubscribe
  } = swr.useSWR(url)

  store.set(initialData)

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
