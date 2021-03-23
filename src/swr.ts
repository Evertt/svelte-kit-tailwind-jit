import { BehaviorSubject, NEVER, fromEvent, merge, Observable, Subject, firstValueFrom } from "rxjs";
import { map, share, filter } from "rxjs/operators";

interface CacheItem {
  expiresAt: number
  data: any
}

type Fetcher = (...args: Parameters<typeof fetch>) => Promise<any>

type DataArg<T = any> = T | Promise<T> | ((data: T) => T | Promise<T>)

export interface SwrReturn<T = any> {
  data: Observable<T>,
  errors: Observable<T>
  mutate: (data?: DataArg<T>, revalidate?: boolean) => void
}

const fromWindowEvent = (event: string) => typeof window !== "undefined"
  ? fromEvent(window, event) : NEVER

const focus = fromWindowEvent("focus")
const online = fromWindowEvent("online")
const windowEvents = merge(focus, online).pipe(share())

interface Cache {
  data: BehaviorSubject<CacheItem>
  errors: Subject<any>
}

export class SWR<F extends Fetcher> {
  static fetch: Fetcher
  private cache = new Map<string, Cache>()
  private fetch: F

  constructor({ fetcher }: { fetcher: F }) {
    this.fetch = fetcher

    windowEvents.subscribe(() => this.cache.forEach(
      (_, key) => this.revalidate(key)
    ))
  }

  public async mutate<T = any>(key: string, data?: DataArg<T>, revalidate?: boolean): Promise<T> {
    const cache = this.cache.get(key)
    if (!cache) throw "Key not found"

    if (typeof data === "function") {
      const cacheItem = await firstValueFrom(cache.data)
      data = (data as (data: T) => T)(cacheItem.data as T)
      if (revalidate == null) revalidate = false
    }

    if (data instanceof Promise) {
      data = await data
      if (revalidate == null) revalidate = false
    }

    data && cache.data.next({
      data, expiresAt: Date.now() + 6000
    })

    if (revalidate == null) revalidate = true
    revalidate && this.revalidate(key, true)

    return data as T
  }

  private isExpired(cacheItem: CacheItem) {
    return cacheItem.expiresAt < Date.now()
  }

  private resolveKeys(keys: Parameters<F>|(() => Parameters<F>)[]): Parameters<F> {
    if (typeof keys[0] === "function") {
      keys = (keys[0] as () => Parameters<F>)()
      if (!Array.isArray(keys)) keys = [keys]
    }

    return keys as Parameters<F>
  }

  private async revalidate(key: string, force: boolean = false) {
    const cache = this.cache.get(key)
    if (!cache) throw "Key not found"

    const item = await firstValueFrom(cache.data)
    if (item === undefined) return

    if (force || this.isExpired(item)) this.getData(key)
  }

  public use<T = any>(keysFactory: () => Parameters<F>): SwrReturn<T>
  public use<T = any>(...keys: Parameters<F>): SwrReturn<T>
  public use<T = any>(...keys: Parameters<F>|(() => Parameters<F>)[]): SwrReturn<T> {
    let args: Parameters<F>

    try {
      args = this.resolveKeys(keys)
    } catch (_) {
      return { data: NEVER, errors: NEVER, mutate: () => {} }
    }

    const key = JSON.stringify(args)

    let cached = this.cache.get(key)

    if (!cached || cached.data.isStopped) {
      cached = {
        data: new BehaviorSubject(undefined),
        errors: new Subject()
      }

      this.cache.set(key, cached)
      this.getData(key)
    }

    const data: Observable<T> = cached.data.pipe(
      filter(cacheItem => cacheItem !== undefined),
      map(cacheItem => cacheItem.data)
    )

    const errors = cached.errors

    const mutate = this.mutate.bind(this, key) as (data?: DataArg<T>, revalidate?: boolean) => void

    return { data, errors, mutate }
  }

  private async getData(key: string) {
    const args = JSON.parse(key)
    const cache = this.cache.get(key)
    if (!cache) throw "Key not found"

    try {
      const data = await this.fetch(...args as Parameters<typeof fetch>)
      const cacheItem: CacheItem = {
        expiresAt: Date.now() + 6000,
        data,
      }

      cache.data.next(cacheItem)
    } catch (error) {
      const lastItem = await firstValueFrom(cache.data)
      cache.errors.next(error)
      if (lastItem !== undefined) return
      cache.data.error(error)
      cache.errors.complete()
    }
  }
}

export const wrapFetch = (f: typeof fetch) => async (...args: Parameters<typeof fetch>): Promise<any> => {
  const resp = await f(...args)
  return await resp.json()
}
