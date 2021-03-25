import { EMPTY, fromEvent } from "rxjs"
import { share } from "rxjs/operators"

export interface CacheItem {
  expiresAt: number
  data: any
}

export const fromWindowEvent = (event: string) =>
  typeof window !== "undefined"
    ? fromEvent(window, event).pipe(share()) : EMPTY
