import { rxios } from "rxios"
import { BehaviorSubject, NEVER, fromEvent, merge, Observable, Subject, Subscriber } from "rxjs";
import { shareReplay, map, share, switchMap, catchError, tap } from "rxjs/operators";

interface CacheItem {
  expiresAt: number
  data: any
}

type DataArg<T = any> = T | Promise<T> | ((data: T) => T | Promise<T>)
type Fetcher = (...args: any[]) => Observable<any>

export interface SwrReturn<T = any> {
  data: Observable<T>,
  errors: Observable<T>
  mutate: (data?: DataArg<T>, revalidate?: boolean) => void
}

const fromWindowEvent = (event: string) => typeof window !== "undefined"
  ? fromEvent(window, event).pipe(share()) : NEVER

const focus = fromWindowEvent("focus")
const online = fromWindowEvent("online")

export function firstValueFrom<T>(source: Observable<T>) {
  return new Promise<T>((resolve, reject) => {
    const subscriber = new Subscriber<T>({
      next: value => {
        resolve(value);
        subscriber.unsubscribe();
      },
      error: reject,
      complete: () => {
        reject(new Error());
      },
    });
    source.subscribe(subscriber);
  });
}

export class SWR<F extends Fetcher> {
  private revalidateSubjects = new Map<string, BehaviorSubject<boolean>>()
  private cache = new Map<string, Observable<CacheItem>>()
  private fetch: F

  constructor({ fetcher }: { fetcher: F }) {
    this.fetch = fetcher
  }

  private cacheNewStream(str: string) {
    const args = JSON.parse(str)

    return this.cache.set(str, this.fetch(...args).pipe(
      map(this.wrapResponse()), shareReplay(1)
    )).get(str)!
  }

  public async mutate<T = any>(str: string, data?: DataArg<T>, revalidate?: boolean): Promise<T> {
    if (typeof data === "function") {
      let cacheItem = await firstValueFrom(this.getCachedStream(str))
      data = (data as (data: T) => T)(cacheItem.data as T)
      if (revalidate == null) revalidate = false
    }

    if (data instanceof Promise) {
      data = await data
      if (revalidate == null) revalidate = false
    }

    data && this.cache.set(str, new BehaviorSubject(data).pipe(
      map(this.wrapResponse()), shareReplay(1)
    ))

    if (revalidate == null) revalidate = true
    revalidate && this.revalidate(str, true)

    return data as T
  }

  private wrapResponse(expiresAt: number = Date.now() + 6000) {
    if (typeof window === "undefined") expiresAt = Date.now() + 1000
    return (data: any) => ({ expiresAt, data })
  }

  private getCachedStream(str: string) {
    return this.cache.get(str) || this.cacheNewStream(str)
  }

  private isExpired(cacheItem: CacheItem) {
    return cacheItem.expiresAt < Date.now()
  }

  private unexpiredCachedStream(str: string) {
    return (item: CacheItem) =>
      this.isExpired(item)
        ? this.cacheNewStream(str)
        : this.getCachedStream(str)
  }

  private getRevalidateSubject(str: string) {
    return this.revalidateSubjects.get(str) ||
      this.revalidateSubjects.set(str, new BehaviorSubject(false)).get(str)!
  }

  private resolveKeys(keys: Parameters<F>|(() => Parameters<F>)[]): Parameters<F> {
    if (typeof keys[0] === "function") {
      keys = (keys[0] as () => Parameters<F>)()
      if (!Array.isArray(keys)) keys = [keys]
    }

    return keys as Parameters<F>
  }

  public revalidate(str: string, force: boolean = false) {
    this.getRevalidateSubject(str).next(force)
  }

  public use<T = any>(keysFactory: () => Parameters<F>): SwrReturn<T>
  public use<T = any>(...keys: Parameters<F>): SwrReturn<T>
  public use<T = any>(...keys: Parameters<F>|(() => Parameters<F>)[]): SwrReturn<T> {
    try {
      keys = this.resolveKeys(keys)
    } catch (_) {
      return { data: NEVER, errors: NEVER, mutate: () => {} }
    }

    const str = JSON.stringify(keys)

    const errors = new Subject<any>()

    const mutate = this.mutate.bind(this, str) as (data?: DataArg<T>, revalidate?: boolean) => void

    let lastItem: T

    const data: Observable<T> = merge(
        this.getRevalidateSubject(str),
        focus, online,
      ).pipe(
        tap(revalidate => revalidate === true && this.cacheNewStream(str)),
        switchMap(() => this.getCachedStream(str)),
        switchMap(this.unexpiredCachedStream(str)),
        map(item => item.data),
        tap(item => lastItem = item),
        shareReplay({ bufferSize: 1, refCount: true }),
        catchError((error, source) => {
          if (!lastItem) throw error
          errors.next(error)
          mutate(lastItem, false)
          return source
        })
      )

    return { data, errors, mutate }
  }
}

const fetcher = rxios.get.bind(rxios) as typeof rxios.get
export const swr = new SWR({ fetcher })
