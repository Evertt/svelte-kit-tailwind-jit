<script context="module">
  import { swrLoad } from "$components/Fetcher.svelte"

  export async function load() {
    return swrLoad("https://jsonplaceholder.typicode.com/posts")
  }
</script>

<script>
  import Counter from "$components/Counter.svelte"
  import Fetcher from "$components/Fetcher.svelte"
  
  export let url: string
</script>

<main class="text-center">
  <h1>Hello world!</h1>
  
  <Counter />
  <p class="py-8">Visit the <a href="https://svelte.dev">svelte.dev</a> to learn how to build Svelte apps.</p>
  
  <Fetcher {url} let:list={posts}>
    <p slot="error">Something went wrong...</p>
    <p slot="loading">Loading...</p>
    
    <ul>
      {#each posts as post}
        <li><a href="{post.id}" sveltekit:prefetch>{post.title}</a></li>
      {/each}
    </ul>
  </Fetcher>
</main>

<style>
  @screen xl {
    h1 {
      @apply text-8xl;
    }
  }
</style>
