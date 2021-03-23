<script context="module">
  import { swrLoad } from "$components/Fetcher.svelte"

  export async function load({ page }) {
    return swrLoad(`https://jsonplaceholder.typicode.com/posts/${page.params.id}`)
  }
</script>

<script>
  import { swr } from "$components/swr"
  import Fetcher from "$components/Fetcher.svelte"

  export let url: string

  interface Post {
    id: number
    userId: number
    title: string
    body: string
  }

  let value = "https://jsonplaceholder.typicode.com/posts/15"
	const { data: store, errors } = swr.use<Post>(value)
	
	const rev = () => swr.revalidate(value)
  store.subscribe(resp => console.log(resp))
</script>

<main class="px-12 py-6">
  <!-- <Fetcher {url} let:model={post}>
    <h1 class="text-center">{post.title}</h1>
    <p>{post.body}</p>
  </Fetcher> -->

  <input class="px-1 border-2 rounded border-blue-500" bind:value />
  <button class="py-1 px-2 bg-red-600 rounded text-white" on:click={rev}>revalidate</button>
  
  {#if $store}
    <h1>{JSON.stringify($store)}</h1>
  {/if}

  {#if $errors}
    <h2>{JSON.stringify($errors)}</h2>
  {/if}
</main>
