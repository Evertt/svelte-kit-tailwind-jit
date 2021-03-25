import { NEVER, merge, Observable, defer, Subscription, EMPTY } from "rxjs"
import { map, filter, finalize, catchError, tap } from "rxjs/operators"
import { fromWindowEvent } from "./common"
import type { CacheItem } from "./common"
import { retryWithDelay } from "./rxjs-operators"
import StorageCache from "./cache"

type Fetcher = (...args: any[]) => Promise<any>

type DataArg<T = any> = T | Promise<T> | ((data: T) => T | Promise<T>)

export interface SwrReturn<T = any> {
  data: Observable<T>,
  error: Observable<T>
  isValidating: Observable<boolean>,
  mutate: (data?: DataArg<T>, revalidate?: boolean) => void
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

type UseOptions = {
  initialData?: any
}

export class SWR<F extends Fetcher> {
  static fetch: Fetcher
  
  static options: DefaultOptions = {
    errorRetryCount: 3,
    errorRetryInterval: 5000,
    dedupingInterval: 6000,
  }

  private options: AllOptions<F>
  private cache = new StorageCache()

  constructor(options: Options<F>) {
    this.options = { ...SWR.options, ...options }
  }

  private async mutate<T = any>(
    key: string, data?: DataArg<T>,
    shouldRevalidate?: boolean,
    options: Partial<AllOptions<F>> = {}
  ): Promise<T> {
    const cache = this.cache.get(key)
    if (!cache) return
    const cacheItem = cache.source.value

    if (typeof data === "function") {
      data = (data as (data: T) => T)(cacheItem.data as T)
      if (!shouldRevalidate) shouldRevalidate = false // in case it's null
    }

    if (data instanceof Promise) {
      cache.isValidating.next(true)
      data = await data
      if (!shouldRevalidate) {
        shouldRevalidate = false
        cache.isValidating.next(false)
      }
    }

    data && cache.source.next({
      data, expiresAt: Date.now() + 6000
    })

    if (shouldRevalidate == null) shouldRevalidate = true
    shouldRevalidate && this.revalidate(key, cacheItem, true, options)

    return data as T
  }

  private revalidate(
    key: string, item: CacheItem, force: boolean,
    options: Partial<AllOptions<F>> = {}
  ) {
    if (force || !item || this.cache.isExpired(item))
      this.requestData(key, options)
  }

  private async requestData(key: string, options: Partial<AllOptions<F>> = {}) {
    const args = JSON.parse(key)
    const cache = this.cache.get(key)
    if (!cache) return

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
        if (!cache.source.value) {
          cache.source.error(error)
          cache.errors.complete()
        }
        return EMPTY
      }),
      finalize(() => cache.isValidating.next(false))
    ).subscribe(data => {
      cache.source.next({ data, expiresAt: Date.now() + options.dedupingInterval })
      if (cache.errors.value) cache.errors.next(undefined)
    })
  }

  public use<T = any>(argsFactory: () => Parameters<F>, options?: Partial<AllOptions<F>> & UseOptions): SwrReturn<T>
  public use<T = any>(args: Parameters<F>, options?: Partial<AllOptions<F>> & UseOptions): SwrReturn<T>
  public use<T = any>(args: Parameters<F>|(() => Parameters<F>), options: Partial<AllOptions<F>> & UseOptions = {}): SwrReturn<T> {
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

    const cached = this.cache.getOrInit(key, {
      initialData: options.initialData,
      dedupingInterval: options.dedupingInterval || this.options.dedupingInterval,
      revalidate: (key, item) => this.revalidate(key, item, false, options)
    })

    this.revalidate(key, cached.source.value, false, options)

    return {
      data: cached.data,
      error: cached.errors,
      isValidating: cached.isValidating,
      mutate: (data, shouldRevalidate) => this.mutate(
        key, data, shouldRevalidate, options
      )
    }
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
