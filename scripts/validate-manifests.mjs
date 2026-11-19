#!/usr/bin/env node
/**
 * Validates all manifest files in manifests/*.{yaml,yml,json}, examples/*.{yaml,yml,json},
 * and blocked.yaml against SkinLoom registry rules and computes diff-aware tiered
 * security-review signals for GitHub Actions PR workflows.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const MANIFESTS_DIR = path.join(ROOT_DIR, 'manifests')
const EXAMPLES_DIR = path.join(ROOT_DIR, 'examples')

export const ID_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
export const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/
export const COMMIT_RE = /^[0-9a-f]{40}$/
export const VALID_KINDS = new Set(['plugin', 'theme'])
export const VALID_RUNTIMES = new Set(['js', 'native'])
export const VALID_CATEGORIES = new Set([
  'security',
  'auth',
  'score',
  'economy',
  'operations',
  'migration',
  'storage',
  'render',
  'search',
  'theme',
  'utility',
])
export const VALID_TARGETS = new Set([
  'linux/amd64',
  'linux/arm64',
  'windows/amd64',
  'darwin/arm64',
  'darwin/amd64',
])

/**
 * Exact permission catalog synced with SkinLoom internal/plugin/permissions.go.
 */
export const PERMISSION_CATALOG = {
  // Normal permissions
  'storage.kv': { tier: 'normal', nativeOnly: false },
  'storage.docs': { tier: 'normal', nativeOnly: false },
  'storage.files': { tier: 'normal', nativeOnly: false },
  cron: { tier: 'normal', nativeOnly: false },
  'admin.ui': { tier: 'normal', nativeOnly: false },
  'users.read': { tier: 'normal', nativeOnly: false },
  'players.read': { tier: 'normal', nativeOnly: false },
  'textures.read': { tier: 'normal', nativeOnly: false },
  'notify.send': { tier: 'normal', nativeOnly: false },

  // Sensitive permissions
  'http.fetch': { tier: 'sensitive', nativeOnly: false },
  'mail.send': { tier: 'sensitive', nativeOnly: false },
  'players.write': { tier: 'sensitive', nativeOnly: false },
  'textures.write': { tier: 'sensitive', nativeOnly: false },
  'closet.write': { tier: 'sensitive', nativeOnly: false },
  'score.write': { tier: 'sensitive', nativeOnly: false },
  'users.write': { tier: 'sensitive', nativeOnly: false },
  'routes.public': { tier: 'sensitive', nativeOnly: false },
  'yggdrasil.extend': { tier: 'sensitive', nativeOnly: false },
  'cdn.provider': { tier: 'sensitive', nativeOnly: false },
  'captcha.provider': { tier: 'sensitive', nativeOnly: false },
  'storage.sql': { tier: 'sensitive', nativeOnly: true },
  'http.stream': { tier: 'sensitive', nativeOnly: true },
  'provider.search': { tier: 'sensitive', nativeOnly: true },
  'provider.render': { tier: 'sensitive', nativeOnly: true },

  // High-risk permissions
  'users.ban': { tier: 'high_risk', nativeOnly: false },
  'auth.provider': { tier: 'high_risk', nativeOnly: false },
  'auth.password': { tier: 'high_risk', nativeOnly: false },
  'provider.storage': { tier: 'high_risk', nativeOnly: true },
  'native.exec': { tier: 'high_risk', nativeOnly: true },
}

export function isElevatedPermission(perm) {
  const def = PERMISSION_CATALOG[perm]
  return Boolean(def && (def.tier === 'sensitive' || def.tier === 'high_risk'))
}

/**
 * Strips inline YAML comments (# ...) outside single/double quoted strings.
 */
function stripInlineComment(rawLine) {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < rawLine.length; i++) {
    const ch = rawLine[i]
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (ch === '"' && !inSingle && (i === 0 || rawLine[i - 1] !== '\\')) {
      inDouble = !inDouble
    } else if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(rawLine[i - 1])) {
        return rawLine.slice(0, i)
      }
    }
  }
  return rawLine
}

/**
 * Minimal structured YAML/JSON loader for registry manifest files.
 */
export function parseSimpleYAML(text) {
  const trimmed = text.trim()
  if (trimmed === '') return {}
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed)
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let idx = 0

  function peekNextNonEmpty(start) {
    for (let i = start; i < lines.length; i++) {
      const raw = lines[i]
      const stripped = stripInlineComment(raw).trim()
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
    if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
      try {
        return JSON.parse(s)
      } catch {
        return s.slice(1, -1)
      }
    }
    if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
      return s.slice(1, -1).replace(/''/g, "'")
    }
    return s
  }

  function splitKeyValue(str) {
    let inSingle = false
    let inDouble = false
    for (let i = 0; i < str.length; i++) {
      const ch = str[i]
      if (ch === "'" && !inDouble) inSingle = !inSingle
      else if (ch === '"' && !inSingle && (i === 0 || str[i - 1] !== '\\')) inDouble = !inDouble
      else if (ch === ':' && !inSingle && !inDouble) {
        if (i === str.length - 1 || /\s/.test(str[i + 1])) {
          return [str.slice(0, i).trim(), str.slice(i + 1).trim()]
        }
      }
    }
    return null
  }

  function unquoteKey(k) {
    if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
      return k.slice(1, -1)
    }
    return k
  }

  function parseBlock(baseIndent) {
    const first = peekNextNonEmpty(idx)
    if (!first || first.indent < baseIndent) return null
    if (first.stripped === '-' || first.stripped.startsWith('- ')) {
      return parseList(first.indent)
    }
    return parseMap(first.indent)
  }

  function parseList(listIndent) {
    const arr = []
    while (idx < lines.length) {
      const next = peekNextNonEmpty(idx)
      if (!next || next.indent < listIndent || (next.stripped !== '-' && !next.stripped.startsWith('- '))) {
        break
      }
      if (next.indent > listIndent) break
      idx = next.index + 1
      const afterDash = next.stripped === '-' ? '' : next.stripped.slice(2).trim()
      if (afterDash === '') {
        arr.push(parseBlock(listIndent + 2))
      } else {
        const kv = splitKeyValue(afterDash)
        if (kv) {
          const itemObj = {}
          const [rawK, vRest] = kv
          const k = unquoteKey(rawK)
          if (vRest === '|' || vRest === '|-') {
            itemObj[k] = parseMultiline(listIndent + 4)
          } else if (vRest === '') {
            itemObj[k] = parseBlock(listIndent + 4)
          } else {
            itemObj[k] = parseScalar(vRest)
          }
          const sub = peekNextNonEmpty(idx)
          if (sub && sub.indent > listIndent && sub.stripped !== '-' && !sub.stripped.startsWith('- ')) {
            const more = parseMap(sub.indent)
            Object.assign(itemObj, more)
          }
          arr.push(itemObj)
        } else {
          arr.push(parseScalar(afterDash))
        }
      }
    }
    return arr
  }

  function parseMultiline(minIndent) {
    const chunks = []
    let contentIndent = null
    while (idx < lines.length) {
      const raw = lines[idx]
      if (raw.trim() === '') {
        chunks.push('')
        idx++
        continue
      }
      const indent = raw.match(/^ */)[0].length
      if (indent < minIndent) break
      if (contentIndent === null) contentIndent = indent
      chunks.push(raw.slice(Math.min(contentIndent, indent)))
      idx++
    }
    return chunks.join('\n').trimEnd()
  }

  function parseMap(mapIndent) {
    const obj = {}
    while (idx < lines.length) {
      const next = peekNextNonEmpty(idx)
      if (!next || next.indent < mapIndent || next.stripped === '-' || next.stripped.startsWith('- ')) {
        break
      }
      if (next.indent > mapIndent) break
      idx = next.index + 1
      const kv = splitKeyValue(next.stripped)
      if (!kv) continue
      const [rawKey, rest] = kv
      const key = unquoteKey(rawKey)
      if (rest === '|' || rest === '|-') {
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
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['manifest must be a mapping/object']
  }
  if (!ID_RE.test(doc.id || '')) {
    errors.push(`invalid id "${doc.id}" (must match ${ID_RE})`)
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
  if (doc.kind === 'theme' && rt === 'native') {
    errors.push('themes cannot use runtime "native"')
  }
  if (!VALID_CATEGORIES.has(doc.category)) {
    errors.push(`category must be one of [${[...VALID_CATEGORIES].join(', ')}], got "${doc.category}"`)
  }
  if (!doc.name || typeof doc.name !== 'object' || !doc.name['zh-CN'] || !doc.name.en) {
    errors.push('name must include both "zh-CN" and "en"')
  }
  if (!doc.description || typeof doc.description !== 'object' || !doc.description['zh-CN'] || !doc.description.en) {
    errors.push('description must include both "zh-CN" and "en"')
  }
  if (!Array.isArray(doc.authors) || doc.authors.length === 0 || doc.authors.some((a) => typeof a !== 'string' || !a.trim())) {
    errors.push('authors must be a non-empty array of strings')
  }
  if (typeof doc.license !== 'string' || !doc.license.trim()) {
    errors.push('license must be a non-empty SPDX identifier (e.g. MIT, Apache-2.0)')
  }
  if (typeof doc.repository !== 'string' || !/^https:\/\/[^/\s]+\/.+/.test(doc.repository)) {
    errors.push('repository must be a valid https:// Git repository URL (plain http:// is forbidden)')
  }
  if (doc.homepage !== undefined && (typeof doc.homepage !== 'string' || !/^https:\/\/[^/\s]+/.test(doc.homepage))) {
    errors.push('homepage must be a valid https:// URL when provided')
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
      if (!rel || typeof rel !== 'object') {
        errors.push('release entry must be an object')
        continue
      }
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
      if (rel.permissions !== undefined) {
        if (!Array.isArray(rel.permissions)) {
          errors.push(`release ${rel.version}: permissions must be an array`)
        } else {
          const seenPerms = new Set()
          for (const perm of rel.permissions) {
            const def = PERMISSION_CATALOG[perm]
            if (!def) {
              errors.push(`release ${rel.version}: unknown permission "${perm}"`)
              continue
            }
            if (def.nativeOnly && rt !== 'native') {
              errors.push(`release ${rel.version}: permission "${perm}" is only allowed for runtime "native"`)
            }
            if (seenPerms.has(perm)) {
              errors.push(`release ${rel.version}: duplicate permission "${perm}"`)
            }
            seenPerms.add(perm)
          }
        }
      }
      if (rt === 'native') {
        if (Number(rel.nativeProtocolVersion || 1) !== 1) {
          errors.push(`release ${rel.version}: nativeProtocolVersion must be 1`)
        }
        if (Array.isArray(rel.targets)) {
          const seenTargets = new Set()
          for (const t of rel.targets) {
            if (!VALID_TARGETS.has(t)) {
              errors.push(`release ${rel.version}: unsupported target "${t}"`)
            }
            if (seenTargets.has(t)) {
              errors.push(`release ${rel.version}: duplicate target "${t}"`)
            }
            seenTargets.add(t)
          }
        }
      } else if (rel.targets !== undefined) {
        errors.push(`release ${rel.version}: targets is only allowed for runtime "native"`)
      }
    }
  }
  return errors
}

export function validateBlockedDoc(blockedDoc) {
  const errors = []
  if (!blockedDoc || !Array.isArray(blockedDoc.blocked)) {
    return ['top-level "blocked" must be an array']
  }
  for (const item of blockedDoc.blocked) {
    if (!item || typeof item !== 'object') {
      errors.push(`invalid entry ${JSON.stringify(item)}`)
      continue
    }
    if (!ID_RE.test(item.id || '')) {
      errors.push(`invalid blocked id "${item.id}"`)
    }
    if (typeof item.reason !== 'string' || !item.reason.trim()) {
      errors.push(`blocked entry "${item.id}" requires a non-empty reason`)
    }
    if (item.versions !== undefined && (typeof item.versions !== 'string' || !item.versions.trim())) {
      errors.push(`blocked entry "${item.id}" has invalid versions constraint`)
    }
  }
  return errors
}

/**
 * Computes diff-aware security review requirements between an optional base manifest
 * (from base branch) and the current manifest in the PR.
 */
export function evaluateManifestReviewGate(currentDoc, baseDoc) {
  const rt = currentDoc.runtime || 'js'
  const reasons = []
  const isNewPackage = !baseDoc

  if (isNewPackage) {
    reasons.push('first-time submission')
  }
  if (rt === 'native') {
    reasons.push('Tier 2 native Go runtime')
  }
  if (Boolean(currentDoc.official) && !Boolean(baseDoc?.official)) {
    reasons.push('sets official: true')
  }

  const baseVersions = new Set((baseDoc?.releases || []).map((r) => r.version))
  const prevPerms = new Set(baseDoc?.releases?.[0]?.permissions || [])
  const addedReleases = []

  for (const rel of currentDoc.releases || []) {
    if (!baseVersions.has(rel.version)) {
      addedReleases.push(rel)
      const relPerms = Array.isArray(rel.permissions) ? rel.permissions : []
      const newElevated = relPerms.filter((p) => isElevatedPermission(p) && !prevPerms.has(p))
      if (newElevated.length > 0) {
        reasons.push(`release ${rel.version} adds elevated permission(s): ${newElevated.join(', ')}`)
      }
    } else if (baseDoc) {
      const prevRel = (baseDoc.releases || []).find((r) => r.version === rel.version)
      if (prevRel && prevRel.commit !== rel.commit) {
        reasons.push(`release ${rel.version} mutates an existing commit SHA`)
      }
      if (prevRel && JSON.stringify(prevRel.permissions || []) !== JSON.stringify(rel.permissions || [])) {
        reasons.push(`release ${rel.version} mutates permissions of an existing release`)
      }
    }
  }

  return {
    id: currentDoc.id,
    kind: currentDoc.kind,
    runtime: rt,
    repository: currentDoc.repository,
    subdir: currentDoc.subdir || '',
    latest: currentDoc.releases[0].version,
    commit: currentDoc.releases[0].commit,
    isNewPackage,
    addedReleases: addedReleases.map((r) => ({
      version: r.version,
      commit: r.commit,
      permissions: r.permissions || [],
      targets: r.targets || [],
    })),
    needsSecurityReview: reasons.length > 0,
    reasons,
  }
}

function readFileAtGitRef(baseRef, relPath) {
  try {
    return execFileSync('git', ['show', `${baseRef}:${relPath}`], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return null
  }
}

function listChangedFilesAgainst(baseRef) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return null
  }
}

function validateDirectory(dirPath, label) {
  if (!fs.existsSync(dirPath)) {
    return { count: 0, errors: 0, docs: new Map() }
  }
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => /\.(ya?ml|json)$/i.test(f))
    .sort()

  let errors = 0
  const docs = new Map()

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
    docs.set(file, doc)
    const rt = doc.runtime || 'js'
    const latestRel = doc.releases[0]
    console.log(`[OK] ${label}/${file} (${doc.id} v${latestRel.version}, runtime=${rt})`)
  }
  return { count: files.length, errors, docs }
}

function parseCliArgs(argv) {
  const opts = { baseRef: '', summaryMd: '' }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base' && argv[i + 1]) {
      opts.baseRef = argv[++i]
    } else if (argv[i] === '--summary-md' && argv[i + 1]) {
      opts.summaryMd = argv[++i]
    }
  }
  return opts
}

function renderSummaryMarkdown(items, infraChanged) {
  const lines = ['## SkinLoom Registry PR Validation Summary', '']
  if (items.length === 0 && infraChanged.length === 0) {
    lines.push('_No live manifests or infrastructure files changed in this diff._')
    return lines.join('\n') + '\n'
  }
  if (items.length > 0) {
    lines.push('| Package | Kind | Runtime | Latest | Review Gate | Reasons |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const item of items) {
      const gate = item.needsSecurityReview ? '🔒 Manual Security Review' : '⚡ Automated Fast-Track'
      const reasons = item.reasons.length > 0 ? item.reasons.join('; ') : '—'
      lines.push(`| \`${item.id}\` | \`${item.kind}\` | \`${item.runtime}\` | \`${item.latest}\` | ${gate} | ${reasons} |`)
    }
    lines.push('')
  }
  if (infraChanged.length > 0) {
    lines.push(`> 🔒 **Protected registry infrastructure modified**: ${infraChanged.map((f) => `\`${f}\``).join(', ')} (requires maintainer review).`)
    lines.push('')
  }
  return lines.join('\n')
}

function main() {
  const opts = parseCliArgs(process.argv.slice(2))
  const live = validateDirectory(MANIFESTS_DIR, 'manifests')
  const examples = validateDirectory(EXAMPLES_DIR, 'examples')
  let totalErrors = live.errors + examples.errors

  const blockedPath = path.join(ROOT_DIR, 'blocked.yaml')
  if (fs.existsSync(blockedPath)) {
    try {
      const blockedDoc = parseSimpleYAML(fs.readFileSync(blockedPath, 'utf8'))
      const errs = validateBlockedDoc(blockedDoc)
      if (errs.length > 0) {
        for (const e of errs) console.error(`[FAIL] blocked.yaml: ${e}`)
        totalErrors += errs.length
      } else {
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

  const changedFiles = opts.baseRef ? listChangedFilesAgainst(opts.baseRef) : null
  const changedManifestFiles = changedFiles
    ? new Set(
        changedFiles
          .filter((f) => f.startsWith('manifests/') && /\.(ya?ml|json)$/i.test(f))
          .map((f) => path.basename(f)),
      )
    : null

  const infraChanged = changedFiles
    ? changedFiles.filter(
        (f) =>
          f === 'blocked.yaml' ||
          f.startsWith('scripts/') ||
          f.startsWith('schema/') ||
          f.startsWith('.github/workflows/'),
      )
    : []

  const evaluated = []
  let needsSecurityReview = infraChanged.length > 0
  let hasNative = false

  for (const [file, doc] of live.docs.entries()) {
    if (changedManifestFiles && !changedManifestFiles.has(file)) {
      continue
    }
    let baseDoc = null
    if (opts.baseRef) {
      const baseRaw = readFileAtGitRef(opts.baseRef, `manifests/${file}`)
      if (baseRaw) {
        try {
          baseDoc = parseSimpleYAML(baseRaw)
        } catch {
          baseDoc = null
        }
      }
    }
    const gate = evaluateManifestReviewGate(doc, baseDoc)
    evaluated.push(gate)
    if (gate.needsSecurityReview) needsSecurityReview = true
    if (gate.runtime === 'native') hasNative = true
  }

  if (opts.summaryMd) {
    fs.appendFileSync(opts.summaryMd, renderSummaryMarkdown(evaluated, infraChanged))
  }

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `needs_security_review=${needsSecurityReview}`,
        `has_native=${hasNative}`,
        `changed_count=${evaluated.length}`,
        `manifests=${JSON.stringify(evaluated)}`,
        '',
      ].join('\n'),
    )
  }
  console.log(
    `Validated ${live.count} live manifest(s) and ${examples.count} example manifest(s) successfully (evaluated ${evaluated.length} manifest(s), needsSecurityReview=${needsSecurityReview}).`,
  )
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
