<script context="module">
  import { swrLoad } from "$components/Fetcher.svelte"

  export async function load({ page }) {
    return swrLoad(`https://jsonplaceholder.typicode.com/posts/${page.params.id}`)
  }
</script>

<script>
  import Fetcher from "$components/Fetcher.svelte"

  export let url: string
</script>

<main class="px-12 py-6">
  <Fetcher {url} let:model={post}>
    <h1 class="text-center">{post.title}</h1>
    <p>{post.body}</p>
  </Fetcher>
</main>
