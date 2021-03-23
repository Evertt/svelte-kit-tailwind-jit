<script context="module">
  import { swr, firstValueFrom } from "$components/swr"

  interface Post {
    id: number
    userId: number
    title: string
    body: string
  }

  export async function load({ page }) {
    const url = `https://jsonplaceholder.typicode.com/posts/${page.params.id}`
    const { data: post, errors, mutate } = swr.use<Post>(url)
    await firstValueFrom(post)
    return { props: { post, errors, mutate } }
  }
</script>

<script>
  import type { Observable } from "rxjs"
  import type { SwrReturn } from "$components/swr"

  export let post: Observable<Post>
  export let errors: Observable<any>
  export let mutate: SwrReturn["mutate"]
</script>

<main class="px-12 py-6">
  {#if $post}
    <h1 class="text-center">{$post.title}</h1>
    <p>{$post.body}</p>
  {/if}

  <button on:click={_ => mutate()}>revalidate</button>

  {#if $errors}<h2>{JSON.stringify($errors)}</h2>{/if}
</main>
