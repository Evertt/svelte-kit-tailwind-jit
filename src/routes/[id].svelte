<script context="module">
  import { fetchAndCache } from "$components/Fetcher.svelte"

  export async function load({ page, fetch }) {
    const { id } = page.params
    const url = `https://jsonplaceholder.typicode.com/posts/${id}`
    const res = await fetchAndCache(url, fetch)
    
    return res.ok
      ? {
          props: {
            url, post: await res.json()
          }
        }

      : {
          status: res.status,
          error: new Error(`Could not load ${url}`)
        }
  }
</script>

<script>
  import Fetcher from "$components/Fetcher.svelte"

  export let url: string
  export let post: any
</script>

<main class="px-12 py-6">
  <Fetcher {url} initialData={post} let:model={post}>
    <h1 class="text-center">{post.title}</h1>
    <p>{post.body}</p>
  </Fetcher>
</main>
