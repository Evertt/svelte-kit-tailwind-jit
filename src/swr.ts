import { BehaviorSubject, NEVER, fromEvent, merge, Observable, Subject, defer, Subscription } from "rxjs";
import { map, share, filter, finalize } from "rxjs/operators";

interface CacheItem {
  expiresAt: number
  data: any
}

type Fetcher = (...args: any[]) => Promise<any>

type DataArg<T = any> = T | Promise<T> | ((data: T) => T | Promise<T>)

export interface SwrReturn<T = any> {
  data: Observable<T>,
  errors: Observable<T>
  mutate: (data?: DataArg<T>, revalidate?: boolean) => void
}

const PREFIX = 'sswr-'

const fromWindowEvent = (event: string) => typeof window !== "undefined"
  ? fromEvent(window, event).pipe(share()) : NEVER

const focusEvents = fromWindowEvent("focus")
const onlineEvents = fromWindowEvent("online")
const storageEvents = fromWindowEvent("storage")
const windowEvents = merge(focusEvents, onlineEvents)

interface Cache {
  data: BehaviorSubject<CacheItem>
  errors: Subject<any>
}

export class SWR<F extends Fetcher> {
  static fetch: Fetcher
  private cache = new Map<string, Cache>()
  private cacheData = new Map<string, Observable<any>>()
  private fetch: F

  constructor({ fetcher }: { fetcher: F }) {
    this.fetch = fetcher

    if (typeof window === "undefined") return

    this.getCacheFromStorage()
    this.purgeStorage()

    storageEvents.subscribe(this.getCacheFromStorage.bind(this))
    setInterval(this.purgeStorage.bind(this), 15000)
  }

  private getCacheFromStorage() {
    if (typeof window === "undefined") return
    const storage = window.localStorage

    for (let i = 0; i < storage.length; i++) {
      const storageKey = storage.key(i) as string
      const prefix = storageKey.slice(0, PREFIX.length)
      if (prefix !== PREFIX) continue
      const key = storageKey.slice(PREFIX.length)
      const value = storage.getItem(storageKey) as string
      const item = JSON.parse(value) as CacheItem
      const cache = this.getOrCreateCache(key)
      cache.data.next(item)
    }
  }

  private purgeStorage() {
    this.cache.forEach((cache, key) =>
      cache.data.value &&
      this.isExpired(cache.data.value) &&
      this.saveItemInStorage(key)
    )
  }

  private saveItemInStorage(key: string, item?: CacheItem) {
    if (typeof window === "undefined") return
    const storage = window.localStorage
    item
      ? storage.setItem(PREFIX+key, JSON.stringify(item))
      : storage.removeItem(PREFIX+key)
  }

  public async mutate<T = any>(key: string, data?: DataArg<T>, revalidate?: boolean): Promise<T> {
    const cache = this.cache.get(key)
    if (!cache) throw "Key not found"
    const cacheItem = cache.data.value

    if (typeof data === "function") {
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
    revalidate && this.revalidate(key, cacheItem, true)

    return data as T
  }

  private isExpired(cacheItem: CacheItem) {
    return cacheItem.expiresAt < Date.now()
  }

  private resolveArgs(args: Parameters<F>|(() => Parameters<F>)[]): Parameters<F> {
    if (typeof args[0] === "function") {
      args = (args[0] as () => Parameters<F>)()
      if (!Array.isArray(args)) args = [args]
    }

    return args as Parameters<F>
  }

  private revalidate(key: string, item?: CacheItem, force: boolean = false) {
    if (force || !item || this.isExpired(item)) this.getData(key)
  }

  private getOrCreateCache(key: string): Cache {
    let cached = this.cache.get(key)

    if (!cached || cached.data.isStopped) {
      cached = {
        data: new BehaviorSubject(undefined),
        errors: new Subject()
      }

      this.cache.set(key, cached)

      if (typeof window !== "undefined") cached.data
        .pipe(filter(cacheItem => cacheItem !== undefined))
        .subscribe(item => this.saveItemInStorage(key, item))
    }

    return cached
  }

  public use<T = any>(argsFactory: () => Parameters<F>): SwrReturn<T>
  public use<T = any>(...args: Parameters<F>): SwrReturn<T>
  public use<T = any>(...args: Parameters<F>|(() => Parameters<F>)[]): SwrReturn<T> {
    try {
      args = this.resolveArgs(args)
    } catch (_) {
      return { data: NEVER, errors: NEVER, mutate: () => {} }
    }

    const key = JSON.stringify(args)

    const cached = this.getOrCreateCache(key)
    this.revalidate(key, cached.data.value)

    let revalidationSubscription: Subscription

    let subscriptions = 0

    if (!this.cacheData.has(key)) {
      this.cacheData.set(key, defer(() => {
        if (++subscriptions === 1) {
          revalidationSubscription = windowEvents.subscribe(
            () => this.revalidate(key, cached.data.value)
          )
        }
  
        return cached.data.pipe(
          filter(cacheItem => cacheItem !== undefined),
          map(cacheItem => cacheItem.data),
          finalize(() => --subscriptions === 0
            && revalidationSubscription.unsubscribe()
          ),
        )
      }))
    }

    return {
      errors: cached.errors,
      data: this.cacheData.get(key)!,
      mutate: this.mutate.bind(this, key)
    }
  }

  private async getData(key: string) {
    const args = JSON.parse(key)
    const cache = this.cache.get(key)
    if (!cache) throw "Key not found"

    try {
      const data = await this.fetch(...args as Parameters<typeof fetch>)
      const cacheItem = { data, expiresAt: Date.now() + 6000 }
      cache.data.next(cacheItem)
    } catch (error) {
      cache.errors.next(error)
      if (cache.data.value) return
      cache.data.error(error)
      cache.errors.complete()
    }
  }
}

export const wrapFetch = (f: typeof fetch) => async (...args: Parameters<typeof fetch>): Promise<any> => {
  const resp = await f(...args)
  return await resp.json()
}
