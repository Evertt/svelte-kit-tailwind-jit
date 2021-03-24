<script context="module">
  import { firstValueFrom } from "rxjs"
  import { swr } from "$components/swr"
  import type { Post } from "../models"

  export async function load({ page }) {
    const url = `https://jsonplaceholder.typicode.com/posts/${page.params.id}`
    const { data: post, error, isValidating } = swr.use<Post>([url])

    try {
      await firstValueFrom(post)
    } catch (e) {
      return e
    }

    return { props: { post, error, isValidating } }
  }
</script>

<script>
  import type { Observable } from "rxjs"
  export let post: Observable<Post>
  export let error: Observable<any>
  export let isValidating: Observable<boolean>
</script>

<main class="px-12 py-6">
  {#if $post}
    <h1 class="text-center">{$post.title}</h1>
    <p>{$post.body}</p>
  {/if}

  {#if $error && $isValidating}
    <p>Something's not going right, but I'm trying...</p>
  {:else if $isValidating}
    <p>Loading...</p>
  {:else if $error}
    <p>Sorry, I failed...</p>
  {/if}
</main>
