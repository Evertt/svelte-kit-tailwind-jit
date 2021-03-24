import { BehaviorSubject, NEVER, fromEvent, merge, Observable, defer, Subscription, EMPTY } from "rxjs"
import { map, share, filter, finalize, catchError, tap } from "rxjs/operators"
import { retryWithDelay } from "./rxjs-operators"

interface CacheItem {
  expiresAt: number
  data: any
}

type Fetcher = (...args: any[]) => Promise<any>

type DataArg<T = any> = T | Promise<T> | ((data: T) => T | Promise<T>)

export interface SwrReturn<T = any> {
  data: Observable<T>,
  error: Observable<T>
  isValidating: Observable<boolean>,
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
  errors: BehaviorSubject<any>
  isValidating: BehaviorSubject<boolean>
}

interface AllOptions<F extends Fetcher> {
  fetcher: F
  dedupingInterval: number
  errorRetryInterval: number
  errorRetryCount: number
}

type RequiredOptionKeys = "fetcher"

type PartialOptions<F extends Fetcher> =
  Partial<Omit<AllOptions<F>, RequiredOptionKeys>>

type Options<F extends Fetcher> = 
  PartialOptions<F> & Pick<AllOptions<F>, RequiredOptionKeys>

type DefaultOptions = Omit<AllOptions<Fetcher>, RequiredOptionKeys>

export class SWR<F extends Fetcher> {
  static fetch: Fetcher
  static options: DefaultOptions = {
    errorRetryCount: 3,
    errorRetryInterval: 5000,
    dedupingInterval: 6000,
  }
  private cache = new Map<string, Cache>()
  private cacheData = new Map<string, Observable<any>>()
  private options: AllOptions<F>

  constructor(options: Options<F>) {
    this.options = { ...SWR.options, ...options }

    if (typeof localStorage === "undefined") return

    this.getCacheFromStorage()
    this.purgeStorage()

    storageEvents.subscribe(this.getCacheFromStorage.bind(this))
    setInterval(this.purgeStorage.bind(this), 60_000)
  }

  private getCacheFromStorage() {
    if (typeof localStorage === "undefined") return

    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i) as string
      const prefix = storageKey.slice(0, PREFIX.length)
      if (prefix !== PREFIX) continue
      const key = storageKey.slice(PREFIX.length)
      const value = localStorage.getItem(storageKey) as string
      const item = JSON.parse(value) as CacheItem
      if (this.isExpired(item)) continue
      const cache = this.getOrCreateCache(key)
      cache.data.next(item)
    }
  }

  private purgeStorage() {
    this.cache.forEach((cache, key) =>
      cache.data.value &&
      this.isExpired(cache.data.value) &&
      this.removeItemFromStorage(key)
    )
  }

  private saveItemInStorage(key: string, item: CacheItem) {
    if (typeof localStorage === "undefined") return
    localStorage.setItem(PREFIX+key, JSON.stringify(item))
  }

  private removeItemFromStorage(key: string) {
    if (typeof localStorage === "undefined") return
    localStorage.removeItem(PREFIX+key)
  }

  public async mutate<T = any>(key: string, data?: DataArg<T>, revalidate?: boolean, options: Partial<AllOptions<F>> = {}): Promise<T> {
    const cache = this.cache.get(key)
    if (!cache) throw "Key not found"
    const cacheItem = cache.data.value

    if (typeof data === "function") {
      data = (data as (data: T) => T)(cacheItem.data as T)
      if (!revalidate) revalidate = false // in case it's null
    }

    if (data instanceof Promise) {
      cache.isValidating.next(true)
      data = await data
      if (!revalidate) {
        revalidate = false
        cache.isValidating.next(false)
      }
    }

    data && cache.data.next({
      data, expiresAt: Date.now() + 6000
    })

    if (revalidate == null) revalidate = true
    revalidate && this.revalidate(key, cacheItem, true, options)

    return data as T
  }

  private isExpired(cacheItem: CacheItem) {
    return cacheItem.expiresAt < Date.now()
  }

  private revalidate(key: string, item?: CacheItem, force: boolean = false, options: Partial<AllOptions<F>> = {}) {
    if (force || !item || this.isExpired(item)) this.getData(key, options)
  }

  private getOrCreateCache(key: string): Cache {
    let cached = this.cache.get(key)

    if (!cached || cached.data.isStopped) {
      cached = {
        data: new BehaviorSubject(undefined),
        errors: new BehaviorSubject(undefined),
        isValidating: new BehaviorSubject(false),
      }

      this.cache.set(key, cached)
    }

    return cached
  }

  public use<T = any>(argsFactory: () => Parameters<F>, options?: Partial<AllOptions<F>>): SwrReturn<T>
  public use<T = any>(args: Parameters<F>, options?: Partial<AllOptions<F>>): SwrReturn<T>
  public use<T = any>(args: Parameters<F>|(() => Parameters<F>), options: Partial<AllOptions<F>> = {}): SwrReturn<T> {
    try {
      args = Array.isArray(args) ? args : args()
    } catch (_) {
      return {
        data: NEVER, error: NEVER,
        isValidating: NEVER,
        mutate: () => {}
      }
    }

    const key = JSON.stringify(args)

    const cached = this.getOrCreateCache(key)
    this.revalidate(key, cached.data.value, false, options)

    return {
      error: cached.errors,
      isValidating: cached.isValidating,
      data: this.getOrInitCacheData(key, options),
      mutate: (data, revalidate) => this.mutate(
        key, data, revalidate, options
      )
    }
  }

  private getOrInitCacheData(key: string, options: Partial<AllOptions<F>> = {}) {
    if (this.cacheData.has(key)) {
      return this.cacheData.get(key)
    }

    const sourceCache = this.cache.get(key)
    if (!sourceCache) throw `Cached ${key} not found`

    options = { ...this.options, ...options }
    
    let timeout: NodeJS.Timeout
    let revalidationSubscription: Subscription
    let subscriptions = 0

    this.cacheData.set(key, defer(() => {
      if (++subscriptions === 1) {
        clearTimeout(timeout)
        revalidationSubscription = windowEvents.subscribe(
          () => this.revalidate(key, sourceCache.data.value)
        )
      }

      return sourceCache.data.pipe(
        filter(cacheItem => cacheItem !== undefined),
        tap(cacheItem => this.saveItemInStorage(key, cacheItem)),
        map(cacheItem => cacheItem.data),
        finalize(() => {
          if (--subscriptions !== 0) return
          revalidationSubscription.unsubscribe()
          timeout = setTimeout(() => {
            if (subscriptions !== 0) return
            if (sourceCache.isValidating.value) return

            sourceCache.data.complete()
            sourceCache.errors.complete()
            sourceCache.isValidating.complete()

            this.cache.delete(key)
            this.cacheData.delete(key)
            this.removeItemFromStorage(key)
          }, options.dedupingInterval + 100)
        }),
      )
    }))

    return this.cacheData.get(key)
  }

  private async getData(key: string, options: Partial<AllOptions<F>> = {}) {
    const args = JSON.parse(key)
    const cache = this.cache.get(key)
    if (!cache) throw "Key not found"

    options = { ...this.options, ...options }

    defer(async () => {
      cache.isValidating.next(true)
      return await options.fetcher(...args)
    })
    .pipe(
      catchError(error => {
        cache.errors.next(error)
        throw error
      }),
      retryWithDelay(
        options.errorRetryInterval,
        options.errorRetryCount
      ),
      catchError(error => {
        if (!cache.data.value) {
          cache.data.error(error)
          cache.errors.complete()
        }
        return EMPTY
      }),
      finalize(() => cache.isValidating.next(false))
    ).subscribe(data => {
      cache.data.next({ data, expiresAt: Date.now() + options.dedupingInterval })
      if (cache.errors.value) cache.errors.next(undefined)
    })
  }
}

export const wrapFetch = (f: typeof fetch) =>
  async (...args: Parameters<typeof fetch>): Promise<any> => {
    const resp = await f(...args)

    if (!resp.ok) throw {
      error: resp.statusText,
      status: resp.status,
      info: await resp.json()
    }

    return await resp.json()
  }
