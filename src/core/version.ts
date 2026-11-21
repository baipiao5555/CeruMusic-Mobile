/** Strict release/plugin version ordering: a formal release is newer than its prerelease. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const match = String(value).match(/^v?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
    if (!match) throw new Error('版本格式无法自动比较，请核对后手动导入')
    return {
      numbers: [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)],
      pre: match[4]?.split('.')
    }
  }
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index += 1) {
    const diff = left.numbers[index] - right.numbers[index]
    if (diff !== 0) return diff
  }
  if (!left.pre && !right.pre) return 0
  if (!left.pre) return 1
  if (!right.pre) return -1
  for (let index = 0; index < Math.max(left.pre.length, right.pre.length); index += 1) {
    const x = left.pre[index]
    const y = right.pre[index]
    if (x === y) continue
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return Number(x) - Number(y)
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}
