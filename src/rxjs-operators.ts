import type { MonoTypeOperatorFunction } from "rxjs"
import { delay as delayOperator, retryWhen, scan, tap } from "rxjs/operators"

export function retryWithDelay<T>(
  delay: number,
  count = 1
): MonoTypeOperatorFunction<T> {
  return (input) =>
    input.pipe(
      retryWhen((errors) =>
        errors.pipe(
          scan((acc, error) => ({ count: acc.count + 1, error }), {
            count: 0,
            error: undefined as any,
          }),
          tap((current) => {
            if (current.count >= count) {
              throw current.error
            }
          }),
          delayOperator(delay)
        )
      )
    )
}