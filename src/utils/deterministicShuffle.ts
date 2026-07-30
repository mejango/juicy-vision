export function deterministicShuffle<T>(
  values: readonly T[],
  seed = 0x6a756963,
): T[] {
  const result = [...values]
  let state = seed >>> 0

  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    const swapIndex = Math.floor((state / 0x1_0000_0000) * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }

  return result
}
