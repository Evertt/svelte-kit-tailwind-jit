<script context="module">
  import { firstValueFrom } from "rxjs"
  import { swr } from "$components/swr"
  import type { Post } from "../models"

  export async function load({ page }) {
    const url = `https://jsonplaceholder.typicode.com/posts/${page.params.id}`
    const { data: post, errors } = swr.use<Post>(url)
    await firstValueFrom(post)
    return { props: { post, errors } }
  }
</script>

<script>
  import type { Observable } from "rxjs"
  export let post: Observable<Post>
  export let errors: Observable<any>
</script>

<main class="px-12 py-6">
  {#if $post}
    <h1 class="text-center">{$post.title}</h1>
    <p>{$post.body}</p>
  {/if}

  {#if $errors}<h2>{JSON.stringify($errors)}</h2>{/if}
</main>
