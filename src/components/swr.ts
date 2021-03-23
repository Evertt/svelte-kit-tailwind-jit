import { SWR, wrapFetch } from "../swr"

if (typeof window !== "undefined") {
  SWR.fetch = wrapFetch(window.fetch)
}

export const swr = new SWR({ fetcher: SWR.fetch })
