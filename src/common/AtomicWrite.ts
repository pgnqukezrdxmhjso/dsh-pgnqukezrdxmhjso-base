/**
 * 插件自有 JSON 文件的写入底座:原子替换 + 按路径串行化。
 *
 * 适合所有"读-改-写"的文件。原子替换让残缺内容永远不会留在磁盘上被当成一份读不出的
 * 记录;按路径排队让并发写入串行执行 —— 后一次读得到前一次的结果,而不是各自基于
 * 同一份旧内容覆盖对方。
 *
 * @module dsh-pgnqukezrdxmhjso-base/common/AtomicWrite
 */

import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { KeyedLocks, TaskQueue } from './Locks.ts'

/** 每个文件一条写队列,同一路径的写因此串行执行。 */
const queue = new KeyedLocks(() => new TaskQueue())

/**
 * 排队一次针对某文件的写:前一次写完成后才开始执行。
 *
 * 分组由 {@link KeyedLocks} 负责,锁本身只串行;同一路径共用一条队列,路径写完
 * 不再被排队时该队列被摘掉。
 * @param path - 被写的文件。
 * @param write - 实际写入;在同一路径的写之间串行执行。
 * @returns 本次写入的结果;失败时以该失败拒绝。
 */
export async function queueWrite(path: string, write: () => Promise<void>): Promise<void> {
  await queue.run(path, write)
}

/**
 * 以原子替换写入一个文件,并在支持的文件系统上收紧为仅属主可读。
 *
 * 先写同目录下的临时文件再改名:改名在同一文件系统内是原子的,因此读到的
 * 要么是旧内容要么是新内容,不会是写了一半的内容。
 *
 * 内容是调用方给的字符串而不是由本函数序列化:`JSON.stringify` 的默认输出是一个
 * 字节的重复都没有的紧凑格式,可读性全靠调用方自己插入的换行 —— 需要控制"哪里换行"
 * 的调用方因此各自决定格式。
 * @param path - 目标文件。
 * @param content - 要写入的完整内容。
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await fs.writeFile(temp, content, { encoding: 'utf-8', mode: 0o600 })
    await fs.rename(temp, path)
  } catch (error) {
    await fs.unlink(temp).catch(() => {
      // 写入已经失败;临时文件缺失不增加信息。
    })
    throw error
  }
  await fs.chmod(path, 0o600).catch(() => {
    // 不支持 POSIX 模式的文件系统(Windows、部分网络挂载)无法收紧权限;
    // 内容仍然写入。
  })
}

/**
 * 以原子替换写入一个 JSON 文件,缩进两格。
 *
 * 缩进是给需要肉眼排查的凭据文件用的(`storage.ts` 的 refresh token 与过期时间),
 * 不是通用默认值:批量记录类文件改用 {@link writeFileAtomic} 自己排版。
 * @param path - 目标文件。
 * @param value - 要序列化的值。
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}
