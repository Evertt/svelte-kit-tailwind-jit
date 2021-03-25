import { BehaviorSubject, defer, merge, Observable, Subscription } from "rxjs"
import { filter, finalize, map, tap } from "rxjs/operators"
import type { CacheItem } from "./common"
import { fromWindowEvent } from "./common"

const storageEvents = fromWindowEvent("storage")

interface Cache {
  data: Observable<any>
  errors: BehaviorSubject<any>
  source: BehaviorSubject<CacheItem>
  isValidating: BehaviorSubject<boolean>
}

type CacheOptions = {
  initialData?: any
  dedupingInterval: number
  revalidate: (key: string, item: CacheItem) => void
}

const windowEvents = merge(
  fromWindowEvent("focus"),
  fromWindowEvent("online")
)

export default class StorageCache {
  private storageKey = "sswr"
  private cache = new Map<string, Cache>()

  constructor() {
    this.syncWithStorage()

    storageEvents.subscribe((event: StorageEvent) => {
      if (event.key !== this.storageKey) return
      if (event.newValue === event.oldValue) return
      this.syncWithStorage()
    })
  }

  private getMapFromStorage(): Map<string, CacheItem> {
    if (typeof localStorage === "undefined") return new Map()
    const value = localStorage.getItem(this.storageKey)
    return new Map(JSON.parse(value || "[]"))
  }

  private saveMapInStorage(map: Map<string, CacheItem>) {
    if (typeof localStorage === "undefined") return
    const oldValue = localStorage.getItem(this.storageKey)
    const newValue = JSON.stringify([ ...map ])
    if (newValue === oldValue) return
    localStorage.setItem(this.storageKey, newValue)
  }

  private syncWithStorage() {
    const map = this.getMapFromStorage()

    map.forEach((item, key) => {
      if (this.isExpired(item)) return map.delete(key)
      if (!this.cache.has(key)) return
      const cache = this.cache.get(key)
      const currentItem = cache.source.value
      if (item.expiresAt <= currentItem.expiresAt) return
      cache.source.next(item)
    })

    this.saveMapInStorage(map)
  }

  private getItemFromStorage(key: string): CacheItem|undefined {
    const item = this.getMapFromStorage().get(key)
    return item && !this.isExpired(item) ? item : undefined
  }

  public saveItemInStorage(key: string, item: CacheItem) {
    const map = this.getMapFromStorage()
    this.saveMapInStorage(map.set(key, item))
  }

  public removeItemFromStorage(key: string) {
    const map = this.getMapFromStorage()
    map.delete(key) && this.saveMapInStorage(map)
  }

  public isExpired(cacheItem: CacheItem) {
    return cacheItem.expiresAt < Date.now()
  }

  public get(key: string) {
    return this.cache.get(key)
  }

  public getOrInit(key: string, options: CacheOptions) {
    return this.get(key)?.source.isStopped !== false
      ? this.init(key, options) : this.get(key)
  }

  public stopAndDelete(key: string) {
    if (!this.cache.has(key)) return
    const cache = this.cache.get(key)
    const item = cache.source.value

    if (item && this.isExpired(item)) {
      this.removeItemFromStorage(key)
    }

    cache.source.complete()
    cache.errors.complete()
    cache.isValidating.complete()
  }

  public init(key: string, options: CacheOptions) {
    let initialData = this.getItemFromStorage(key) || options?.initialData

    if (initialData && initialData.expiresAt === undefined) {
      initialData = { expiresAt: 0, data: initialData }
    }

    this.cache.set(key, {
      source: new BehaviorSubject(initialData),
      errors: new BehaviorSubject(undefined),
      isValidating: new BehaviorSubject(false),
      data: this.initDataCache(key, options)
    })

    return this.cache.get(key)
  }

  private initDataCache(key: string, options: CacheOptions) {
    let timeout: NodeJS.Timeout
    let revalidationSubscription: Subscription
    let subscriptions = 0

    return defer(() => {
      const cache = this.cache.get(key)

      if (++subscriptions === 1) {
        clearTimeout(timeout)
        revalidationSubscription = windowEvents.subscribe(
          () => options.revalidate(key, cache.source.value)
        )
      }

      return cache.source.pipe(
        filter(cacheItem => cacheItem !== undefined),
        tap(cacheItem => this.saveItemInStorage(key, cacheItem)),
        map(cacheItem => cacheItem.data),
        finalize(() => {
          if (--subscriptions !== 0) return
          revalidationSubscription.unsubscribe()
          timeout = setTimeout(() =>
            subscriptions === 0
            && !cache.isValidating.value
            && this.stopAndDelete(key)
          , options.dedupingInterval + 100)
        }),
      )
    })
  }
}