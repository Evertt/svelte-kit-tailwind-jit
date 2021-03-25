import { NEVER, Observable, defer, EMPTY } from "rxjs"
import { finalize, catchError } from "rxjs/operators"
import { CacheItem } from "./common"
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

type RequiredOptions<F extends Fetcher> = {
  fetcher: F
}

type DefaultOptions = {
  dedupingInterval: number
  errorRetryInterval: number
  errorRetryCount: number
}

type AllOptions<F extends Fetcher> =
  RequiredOptions<F> & DefaultOptions

type Options<F extends Fetcher> =
  Partial<AllOptions<F>>

type InitOptions<F extends Fetcher> =
  RequiredOptions<F> & Partial<DefaultOptions>

type UseOptions = {
  initialData?: any
}

type FetchParamFactories<F extends Fetcher> = 
  (() => Parameters<F> | Parameters<F>[0])

type FetchParamOptions<F extends Fetcher> =
  Parameters<F> | Parameters<F>[0] | FetchParamFactories<F>

export class SWR<F extends Fetcher> {
  static fetch: Fetcher
  
  static options: DefaultOptions = {
    errorRetryCount: 3,
    errorRetryInterval: 5000,
    dedupingInterval: 6000,
  }

  private options: AllOptions<F>
  private cache = new StorageCache()

  constructor(options: InitOptions<F>) {
    this.options = { ...SWR.options, ...options }
  }

  private async mutate<T = any>(
    key: string, data?: DataArg<T>,
    shouldRevalidate: boolean = !data,
    options: Options<F> = {}
  ): Promise<T> {
    const cache = this.cache.get(key)
    if (!cache) return
    const cacheItem = cache.source.value

    if (typeof data === "function") {
      data = (data as (data: T) => T)(cacheItem.data as T)
    }

    if (data instanceof Promise) {
      cache.isValidating.next(true)
      data = await data
      cache.isValidating.next(false)
    }

    const opts = { ...this.options, ...options }
    const expiresAt = Date.now() + opts.dedupingInterval
    data && cache.source.next(new CacheItem(data, expiresAt))
    this.revalidate(key, cacheItem, shouldRevalidate, options)

    return data as T
  }

  private revalidate(key: string, item: CacheItem, force: boolean, options: Options<F> = {}) {
    if (force || !item || item.isExpired) this.requestData(key, options)
  }

  private async requestData(key: string, options: Options<F> = {}) {
    const args = JSON.parse(key)
    const cache = this.cache.get(key)
    if (!cache) return

    const opts = { ...this.options, ...options }

    defer(async () => {
      cache.isValidating.next(true)
      return await opts.fetcher(...args)
    })
    .pipe(
      catchError(error => {
        cache.errors.next(error)
        throw error
      }),
      retryWithDelay(
        opts.errorRetryInterval,
        opts.errorRetryCount
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
      const expiresAt = Date.now() + opts.dedupingInterval
      cache.source.next(new CacheItem(data, expiresAt))
      if (cache.errors.value) cache.errors.next(undefined)
    })
  }

  public resolveArgs(args: FetchParamOptions<F>): Parameters<F> {
    if (Array.isArray(args)) return args
    if (typeof args !== "function") return [args] as Parameters<F>
    args = (args as FetchParamFactories<F>)()
    return Array.isArray(args) ? args : [args] as Parameters<F>
  }

  public use<T = any>(args: FetchParamOptions<F>, options: Options<F> & UseOptions = {}): SwrReturn<T> {
    try {
      args = this.resolveArgs(args)
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
