/**
 * Hardened downloads for URLs that came from user-editable data.
 * - Resolution happens inside the socket `lookup`, so the address that is
 *   checked is the address that is connected to (no DNS-rebinding gap).
 * - Loopback, private, link-local, CGNAT, multicast and reserved addresses are refused.
 * - Redirects are followed manually (max 3) and each hop is re-validated.
 * - Body size is capped while streaming; the whole request has a deadline.
 */
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

export function isPrivateIPv4(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip)
  if (kind === 4) return isPrivateIPv4(ip)
  if (kind === 6) {
    const lower = ip.toLowerCase()
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIPv4(mapped[1])
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16)
      const lo = parseInt(mappedHex[2], 16)
      return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
    }
    return (
      lower === '::' || lower === '::1' ||
      /^f[cd]/.test(lower) || // fc00::/7
      /^fe[89ab]/.test(lower) || // fe80::/10
      lower.startsWith('ff') // multicast
    )
  }
  return true
}

/** net.connect `lookup` that refuses private addresses. */
const guardedLookup = ((hostname: string, options: dns.LookupOptions, cb: (...a: unknown[]) => void) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err)
    const list = addrs as dns.LookupAddress[]
    const ok = list.filter((a) => !isPrivateIp(a.address))
    if (!ok.length) return cb(new Error(`blocked address for ${hostname}`))
    if (options.all) return cb(null, ok)
    cb(null, ok[0].address, ok[0].family)
  })
}) as unknown as net.LookupFunction

export interface SafeGetOptions {
  maxBytes: number
  timeoutMs?: number
  /** If set, the first URL's origin must be in this list (redirects must stay in it too). */
  allowedOrigins?: string[]
  maxRedirects?: number
}

export async function safeGet(url: string, opts: SafeGetOptions): Promise<Buffer> {
  const deadline = Date.now() + (opts.timeoutMs ?? 25000)
  let current = url
  for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
    const u = new URL(current)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('unsupported url scheme')
    if (u.username || u.password) throw new Error('credentials in url')
    if (opts.allowedOrigins && !opts.allowedOrigins.includes(u.origin)) throw new Error('origin not allowed')
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(host) && isPrivateIp(host)) throw new Error('blocked address')
    const res = await requestOnce(u, opts.maxBytes, deadline - Date.now())
    if (res.redirect) {
      current = new URL(res.redirect, u).toString()
      continue
    }
    return res.body!
  }
  throw new Error('too many redirects')
}

function requestOnce(u: URL, maxBytes: number, timeoutMs: number): Promise<{ redirect?: string; body?: Buffer }> {
  return new Promise((resolve, reject) => {
    if (timeoutMs <= 0) return reject(new Error('timeout'))
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request(u, { method: 'GET', lookup: guardedLookup, headers: { 'user-agent': 'reel-worker' } }, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        return resolve({ redirect: String(res.headers.location) })
      }
      if (status < 200 || status >= 300) {
        res.resume()
        return reject(new Error(`HTTP ${status}`))
      }
      if (Number(res.headers['content-length'] || 0) > maxBytes) {
        req.destroy()
        return reject(new Error('file too large'))
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (c: Buffer) => {
        size += c.length
        if (size > maxBytes) {
          req.destroy()
          reject(new Error('file too large'))
          return
        }
        chunks.push(c)
      })
      res.on('end', () => resolve({ body: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    const overall = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs)
    req.on('close', () => clearTimeout(overall))
    req.on('error', reject)
    req.end()
  })
}
