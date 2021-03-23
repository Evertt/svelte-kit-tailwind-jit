import fetch from "node-fetch"
import { SWR, wrapFetch } from "./swr"

SWR.fetch = wrapFetch(fetch as any)
