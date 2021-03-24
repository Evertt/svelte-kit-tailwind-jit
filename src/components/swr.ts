import { SWR, wrapFetch } from "../swr"

let options: any = {}

if (typeof fetch !== "undefined") {
  SWR.fetch = wrapFetch(fetch)
} else {
  options.errorRetryCount = 0
}

export const swr = new SWR<typeof fetch>({ fetcher: SWR.fetch, ...options })
