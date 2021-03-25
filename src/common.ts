export class CacheItem {
  public data: any
  public expiresAt: number

  get isExpired() {
    return this.expiresAt <= Date.now()
  }

  constructor(data: any, expiresAt: number) {
    this.data = data
    this.expiresAt = expiresAt
  }
}
