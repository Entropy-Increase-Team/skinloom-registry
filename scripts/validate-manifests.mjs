#!/usr/bin/env node
/**
 * Validates all manifest files in manifests/*.{yaml,yml,json}, examples/*.{yaml,yml,json},
 * and blocked.yaml against SkinLoom registry rules and computes tiered security-review
 * signals for GitHub Actions PR workflows.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const MANIFESTS_DIR = path.join(ROOT_DIR, 'manifests')
const EXAMPLES_DIR = path.join(ROOT_DIR, 'examples')

const ID_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/
const COMMIT_RE = /^[0-9a-f]{40}$/
const VALID_KINDS = new Set(['plugin', 'theme'])
const VALID_RUNTIMES = new Set(['js', 'native'])
const VALID_TARGETS = new Set([
  'linux/amd64',
  'linux/arm64',
  'windows/amd64',
  'darwin/arm64',
  'darwin/amd64',
])

const SENSITIVE_OR_HIGH_RISK_PERMS = new Set([
  'users.write',
  'users.ban',
  'users.password_verifier',
  'players.write',
  'textures.write',
  'closet.write',
  'score.write',
  'notify.send',
  'notify.announce',
  'mail.send',
  'auth.provider',
  'auth.guard',
  'captcha.provider',
  'cdn.provider',
  'yggdrasil.extend',
  'settings.read_site',
  'storage.sql',
  'http.stream',
  'native.exec',
  'provider.storage',
  'provider.search',
  'provider.render',
])

/**
 * Minimal structured YAML/JSON loader for registry manifest files.
 */
export function parseSimpleYAML(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed)
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let idx = 0

  function peekNextNonEmpty(start) {
    for (let i = start; i < lines.length; i++) {
      const raw = lines[i]
      const stripped = raw.replace(/#.*$/, '').trim()
      if (stripped !== '') {
        const indent = raw.match(/^ */)[0].length
        return { index: i, indent, stripped, raw }
      }
    }
    return null
  }

  function parseScalar(val) {
    const s = val.trim()
    if (s === '{}') return {}
    if (s === '[]') return []
    if (s === 'true') return true
    if (s === 'false') return false
    if (s === 'null' || s === '~') return null
    if (/^-?[0-9]+$/.test(s)) return Number.parseInt(s, 10)
    if (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))
    ) {
      return s.slice(1, -1)
    }
    return s
  }

  function parseBlock(baseIndent) {
    const first = peekNextNonEmpty(idx)
    if (!first || first.indent < baseIndent) return null
    if (first.stripped.startsWith('- ')) {
      return parseList(first.indent)
    }
    return parseMap(first.indent)
  }

  function parseList(listIndent) {
    const arr = []
    while (idx < lines.length) {
      const next = peekNextNonEmpty(idx)
      if (!next || next.indent < listIndent || !next.stripped.startsWith('- ')) {
        break
      }
      if (next.indent > listIndent) break
      idx = next.index + 1
      const afterDash = next.stripped.slice(2).trim()
      if (afterDash === '') {
        arr.push(parseBlock(listIndent + 2))
      } else if (afterDash.includes(':')) {
        const itemObj = {}
        const colonIdx = afterDash.indexOf(':')
        const k = afterDash.slice(0, colonIdx).trim()
        const vRest = afterDash.slice(colonIdx + 1).trim()
        if (vRest === '|') {
          itemObj[k] = parseMultiline(listIndent + 4)
        } else if (vRest === '') {
          itemObj[k] = parseBlock(listIndent + 4)
        } else {
          itemObj[k] = parseScalar(vRest)
        }
        const sub = peekNextNonEmpty(idx)
        if (sub && sub.indent > listIndent && !sub.stripped.startsWith('- ')) {
          const more = parseMap(sub.indent)
          Object.assign(itemObj, more)
        }
        arr.push(itemObj)
      } else {
        arr.push(parseScalar(afterDash))
      }
    }
    return arr
  }

  function parseMultiline(blockIndent) {
    const chunks = []
    while (idx < lines.length) {
      const raw = lines[idx]
      if (raw.trim() === '') {
        chunks.push('')
        idx++
        continue
      }
      const indent = raw.match(/^ */)[0].length
      if (indent < blockIndent) break
      chunks.push(raw.slice(blockIndent))
      idx++
    }
    return chunks.join('\n').trimEnd()
  }

  function parseMap(mapIndent) {
    const obj = {}
    while (idx < lines.length) {
      const next = peekNextNonEmpty(idx)
      if (!next || next.indent < mapIndent || next.stripped.startsWith('- ')) {
        break
      }
      if (next.indent > mapIndent) break
      idx = next.index + 1
      const colonIdx = next.stripped.indexOf(':')
      if (colonIdx === -1) continue
      const key = next.stripped.slice(0, colonIdx).trim()
      const rest = next.stripped.slice(colonIdx + 1).trim()
      if (rest === '|') {
        obj[key] = parseMultiline(mapIndent + 2)
      } else if (rest === '') {
        obj[key] = parseBlock(mapIndent + 2)
      } else {
        obj[key] = parseScalar(rest)
      }
    }
    return obj
  }

  return parseBlock(0) ?? {}
}

export function validateManifestObject(doc, fileName) {
  const errors = []
  const expectedId = fileName.replace(/\.(ya?ml|json)$/i, '')
  if (!doc || typeof doc !== 'object') {
    return ['manifest must be an object']
  }
  if (!ID_RE.test(doc.id || '')) {
    errors.push(`invalid id "${doc.id}"`)
  }
  if (doc.id !== expectedId) {
    errors.push(`manifest id "${doc.id}" must match filename "${expectedId}"`)
  }
  if (!VALID_KINDS.has(doc.kind)) {
    errors.push(`kind must be "plugin" or "theme", got "${doc.kind}"`)
  }
  const rt = doc.runtime || 'js'
  if (!VALID_RUNTIMES.has(rt)) {
    errors.push(`runtime must be "js" or "native", got "${rt}"`)
  }
  if (!doc.name || !doc.name['zh-CN'] || !doc.name.en) {
    errors.push('name must include both "zh-CN" and "en"')
  }
  if (!doc.description || !doc.description['zh-CN'] || !doc.description.en) {
    errors.push('description must include both "zh-CN" and "en"')
  }
  if (!Array.isArray(doc.authors) || doc.authors.length === 0) {
    errors.push('authors must be a non-empty array')
  }
  if (!doc.repository || !/^https?:\/\//.test(doc.repository)) {
    errors.push('repository must be a valid http(s) URL')
  }
  if (doc.subdir !== undefined) {
    if (
      typeof doc.subdir !== 'string' ||
      doc.subdir.startsWith('/') ||
      doc.subdir.includes('\\') ||
      doc.subdir.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') ||
      !/^[a-zA-Z0-9._/-]+$/.test(doc.subdir)
    ) {
      errors.push(`invalid subdir "${doc.subdir}" (must be a clean relative path without "..")`)
    }
  }
  if (!Array.isArray(doc.releases) || doc.releases.length === 0) {
    errors.push('releases must be a non-empty array')
  } else {
    const seenVersions = new Set()
    for (const rel of doc.releases) {
      if (!SEMVER_RE.test(rel.version || '')) {
        errors.push(`invalid release version "${rel.version}"`)
      }
      if (seenVersions.has(rel.version)) {
        errors.push(`duplicate release version "${rel.version}"`)
      }
      seenVersions.add(rel.version)
      if (!COMMIT_RE.test(rel.commit || '')) {
        errors.push(`release ${rel.version}: commit must be a pinned 40-char lowercase hex SHA`)
      }
      if (Number(rel.apiVersion) !== 1) {
        errors.push(`release ${rel.version}: apiVersion must be 1`)
      }
      if (rt === 'native') {
        if (Number(rel.nativeProtocolVersion || 1) !== 1) {
          errors.push(`release ${rel.version}: nativeProtocolVersion must be 1`)
        }
        if (Array.isArray(rel.targets)) {
          for (const t of rel.targets) {
            if (!VALID_TARGETS.has(t)) {
              errors.push(`release ${rel.version}: unsupported target "${t}"`)
            }
          }
        }
      }
    }
  }
  return errors
}

function validateDirectory(dirPath, label, collectSummary) {
  if (!fs.existsSync(dirPath)) {
    return { count: 0, errors: 0, needsSecurityReview: false, hasNative: false, summary: [] }
  }
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => /\.(ya?ml|json)$/i.test(f))
    .sort()

  let errors = 0
  let needsSecurityReview = false
  let hasNative = false
  const summary = []

  for (const file of files) {
    const fullPath = path.join(dirPath, file)
    const raw = fs.readFileSync(fullPath, 'utf8')
    let doc
    try {
      doc = parseSimpleYAML(raw)
    } catch (err) {
      console.error(`[FAIL] ${label}/${file}: parse error: ${err.message}`)
      errors++
      continue
    }
    const errs = validateManifestObject(doc, file)
    if (errs.length > 0) {
      for (const e of errs) {
        console.error(`[FAIL] ${label}/${file}: ${e}`)
      }
      errors += errs.length
      continue
    }

    const rt = doc.runtime || 'js'
    const latestRel = doc.releases[0]
    const perms = Array.isArray(latestRel.permissions) ? latestRel.permissions : []
    const hasHighOrSensitive = perms.some((p) => SENSITIVE_OR_HIGH_RISK_PERMS.has(p))
    if (collectSummary) {
      if (rt === 'native') {
        hasNative = true
        needsSecurityReview = true
      }
      if (hasHighOrSensitive || doc.releases.length === 1) {
        needsSecurityReview = true
      }
      summary.push({
        id: doc.id,
        kind: doc.kind,
        runtime: rt,
        latest: latestRel.version,
        commit: latestRel.commit,
        needsSecurityReview: rt === 'native' || hasHighOrSensitive || doc.releases.length === 1,
      })
    }
    console.log(`[OK] ${label}/${file} (${doc.id} v${latestRel.version}, runtime=${rt})`)
  }
  return { count: files.length, errors, needsSecurityReview, hasNative, summary }
}

function main() {
  const live = validateDirectory(MANIFESTS_DIR, 'manifests', true)
  const examples = validateDirectory(EXAMPLES_DIR, 'examples', false)
  let totalErrors = live.errors + examples.errors

  const blockedPath = path.join(ROOT_DIR, 'blocked.yaml')
  if (fs.existsSync(blockedPath)) {
    try {
      const blockedDoc = parseSimpleYAML(fs.readFileSync(blockedPath, 'utf8'))
      if (!blockedDoc || !Array.isArray(blockedDoc.blocked)) {
        console.error('[FAIL] blocked.yaml: top-level "blocked" must be an array')
        totalErrors++
      } else {
        for (const item of blockedDoc.blocked) {
          if (!item || !ID_RE.test(item.id || '') || typeof item.reason !== 'string' || !item.reason.trim()) {
            console.error(`[FAIL] blocked.yaml: invalid entry ${JSON.stringify(item)}`)
            totalErrors++
          }
        }
        console.log(`[OK] blocked.yaml (${blockedDoc.blocked.length} rule(s))`)
      }
    } catch (err) {
      console.error(`[FAIL] blocked.yaml: ${err.message}`)
      totalErrors++
    }
  }

  if (totalErrors > 0) {
    console.error(`Validation failed with ${totalErrors} error(s).`)
    process.exit(1)
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `needs_security_review=${live.needsSecurityReview}\nhas_native=${live.hasNative}\nmanifests=${JSON.stringify(live.summary)}\n`,
    )
  }
  console.log(`Validated ${live.count} live manifest(s) and ${examples.count} example manifest(s) successfully.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
