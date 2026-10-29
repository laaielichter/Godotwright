/** Indexed read for numeric arrays whose bounds are known to the caller (keeps tight loops readable). */
export function at(values: ArrayLike<number>, index: number): number {
  return values[index] as number;
}
