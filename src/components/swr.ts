import { rxios } from "rxios"
import { BehaviorSubject, of, NEVER, fromEvent, merge, Observable, Subject, combineLatest } from "rxjs";
import { shareReplay, map, share, switchMap, catchError, tap } from "rxjs/operators";

interface CacheItem {
  expiresAt: number
  data: any
}

type Keys = (string|object)[]
type KeysFactory = () => Keys
type Fetcher = (...args: any[]) => Observable<any>

interface SwrReturn<T = any> {
  data: Observable<T>,
  errors: Observable<T>
  mutate: (data: T) => void
}

const fromWindowEvent = (event: string) => typeof window !== "undefined"
  ? fromEvent(window, event).pipe(share()) : NEVER

const focus = fromWindowEvent("focus")
const online = fromWindowEvent("online")

export class SWR {
  private revalidateSubjects = new Map<string, BehaviorSubject<null>>()
  private cache = new Map<string, Observable<CacheItem>>()
  private fetch: Fetcher

  constructor({ fetcher }: { fetcher: Fetcher }) {
    this.fetch = fetcher
  }

  private cacheNewStream(str: string) {
    const args = JSON.parse(str)

    return this.cache.set(str, this.fetch(...args).pipe(
      map(this.wrapResponse), shareReplay(1)
    )).get(str)!
  }

  private mutate(str: string, data: any) {
    this.cache.set(str, new BehaviorSubject(data).pipe(
      map(this.wrapResponse), shareReplay(1)
    ))
  }

  private wrapResponse(data: any) {
    return { expiresAt: Date.now() + 6000, data }
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
      this.revalidateSubjects.set(str, new BehaviorSubject(null)).get(str)!
  }

  private resolveKeys(keys: Keys|KeysFactory[]): Keys {
    if (typeof keys[0] === "function") {
      keys = keys[0]()
      if (!Array.isArray(keys)) keys = [keys]
    }

    return keys
  }

  public revalidate(str: string) {
    this.getRevalidateSubject(str).next(null)
  }

  public use<T = any>(keysFactory: KeysFactory): SwrReturn<T>
  public use<T = any>(...keys: Keys): SwrReturn<T>
  public use<T = any>(...keys: Keys|KeysFactory[]): SwrReturn<T> {
    try {
      keys = this.resolveKeys(keys)
    } catch (_) {
      return { data: NEVER, errors: NEVER, mutate: () => {} }
    }

    const str = JSON.stringify(keys)

    const errors = new Subject<any>()

    const triggers = merge(
      this.getRevalidateSubject(str),
      focus, online
    )

    const mutate = this.mutate.bind(this, str) as (data: T) => void

    let lastItem: T

    const data: Observable<T> = merge(
        this.getRevalidateSubject(str),
        focus, online,
      ).pipe(
        switchMap(() => this.getCachedStream(str)),
        switchMap(this.unexpiredCachedStream(str)),
        map(item => item.data),
        tap(item => lastItem = item),
        catchError((error, source) => {
          errors.next(error)
          mutate(lastItem)
          return source
        })
      )

    return { data, errors, mutate }
  }
}

export const swr = new SWR({ fetcher: rxios.get.bind(rxios) })
