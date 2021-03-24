<script context="module">
  import { firstValueFrom } from "rxjs"
  import { swr } from "$components/swr"
  import type { Post } from "../models"

  export async function load() {
    const url = "https://jsonplaceholder.typicode.com/posts"
    const { data: posts } = swr.use<Post[]>([url])
    await firstValueFrom(posts)
    return { props: { posts } }
  }
</script>

<script>
  import Counter from "$components/Counter.svelte"
  import type { Observable } from "rxjs"

  export let posts: Observable<Post[]>
</script>

<main class="text-center">
  <h1>Hello world!</h1>
  
  <Counter />
  <p class="py-8">Visit the <a href="https://svelte.dev">svelte.dev</a> to learn how to build Svelte apps.</p>
  
  {#if $posts}
    <ul>
      {#each $posts as post}
        <li><a href="/{post.id}" sveltekit:prefetch>{post.title}</a></li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  @screen xl {
    h1 {
      @apply text-8xl;
    }
  }
</style>
