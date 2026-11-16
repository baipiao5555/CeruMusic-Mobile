import { randomUUID } from '../shims/crypto'
import type { ProviderHandle } from './plugin/manager'

interface ResourceContext {
  pluginId: string
  providerId: string
  ref: any
  title: string
  artwork: string
}

// 私有连接信息不放 URL；刷新后丢失上下文时应返回搜索重开，不能猜测公共 ref。
const resources = new Map<string, ResourceContext>()
export function retainResource(owner: ProviderHandle, item: any, artwork: string): string {
  const token = randomUUID()
  resources.set(token, { pluginId: owner.pluginId, providerId: owner.providerId,
    ref: JSON.parse(JSON.stringify(item.ref)), title: String(item.title || '歌单'), artwork })
  while (resources.size > 64) resources.delete(resources.keys().next().value!)
  return token
}
export function resourceContext(token: unknown): ResourceContext | undefined {
  return typeof token === 'string' ? resources.get(token) : undefined
}
