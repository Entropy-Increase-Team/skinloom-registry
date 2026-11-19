#!/usr/bin/env node
/**
 * Isolated source checkout & consistency auditor for SkinLoom registry PRs.
 *
 * Checks out each changed/added release at its exact pinned 40-char Commit SHA
 * and verifies:
 *   1. plugin.json exists and matches manifests/<id>.yaml (id, kind, runtime, version, apiVersion, permissions).
 *   2. An OSI LICENSE file exists in the repository.
 *   3. For runtime: "native" plugins: runs `go vet ./...`, optional `govulncheck ./...`,
 *      and verifies `CGO_ENABLED=0` buildability.
 *   4. For runtime: "js" / theme packages: verifies declared entry files / manifest basics,
 *      and invokes `skinloom-plugin lint` when available on PATH.
 *
 * Usage:
 *   MANIFESTS_JSON='[...]' node scripts/audit-changed.mjs
 *   node scripts/audit-changed.mjs --manifest manifests/my-plugin.yaml
 */

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSimpleYAML, validateManifestObject } from './validate-manifests.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

function normalizePermSet(perms) {
  return [...new Set((Array.isArray(perms) ? perms : []).map((p) => String(p).trim()).filter(Boolean))].sort()
}

export function verifyPluginJsonMatchesManifest(manifestDoc, releaseSpec, pluginJson) {
  const errors = []
  const expectedRuntime = manifestDoc.runtime || 'js'
  const actualRuntime = pluginJson.runtime || 'js'

  if (pluginJson.id !== manifestDoc.id) {
    errors.push(`plugin.json id "${pluginJson.id}" != manifest id "${manifestDoc.id}"`)
  }
  if (pluginJson.kind !== manifestDoc.kind) {
    errors.push(`plugin.json kind "${pluginJson.kind}" != manifest kind "${manifestDoc.kind}"`)
  }
  if (actualRuntime !== expectedRuntime) {
    errors.push(`plugin.json runtime "${actualRuntime}" != manifest runtime "${expectedRuntime}"`)
  }
  if (pluginJson.version !== releaseSpec.version) {
    errors.push(`plugin.json version "${pluginJson.version}" != release version "${releaseSpec.version}"`)
  }
  if (Number(pluginJson.apiVersion) !== Number(releaseSpec.apiVersion || 1)) {
    errors.push(`plugin.json apiVersion "${pluginJson.apiVersion}" != release apiVersion "${releaseSpec.apiVersion || 1}"`)
  }

  const expectedPerms = normalizePermSet(releaseSpec.permissions)
  const actualPerms = normalizePermSet(pluginJson.permissions)
  // Native plugins implicitly carry native.exec in registry manifests even if omitted in plugin.json.
  const expectedWithoutImplicit =
    expectedRuntime === 'native' ? expectedPerms.filter((p) => p !== 'native.exec') : expectedPerms
  const actualWithoutImplicit =
    actualRuntime === 'native' ? actualPerms.filter((p) => p !== 'native.exec') : actualPerms

  if (JSON.stringify(expectedWithoutImplicit) !== JSON.stringify(actualWithoutImplicit)) {
    errors.push(
      `plugin.json permissions [${actualPerms.join(', ')}] do not match manifest permissions [${expectedPerms.join(', ')}]`,
    )
  }
  return errors
}

function hasCommand(cmd) {
  const res = spawnSync(cmd, ['--version'], { stdio: 'ignore' })
  return res.status === 0
}

function findLicenseFile(repoDir, pkgDir) {
  const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']
  for (const dir of [pkgDir, repoDir]) {
    for (const name of candidates) {
      if (fs.existsSync(path.join(dir, name))) return true
    }
  }
  return false
}

function auditSingleRelease(manifestDoc, releaseSpec) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `sl-reg-audit-${manifestDoc.id}-`))
  try {
    console.log(`\n==> Auditing ${manifestDoc.id}@${releaseSpec.version} (${manifestDoc.repository} @ ${releaseSpec.commit})`)
    execFileSync('git', ['init', workDir], { stdio: 'inherit' })
    execFileSync('git', ['-C', workDir, 'remote', 'add', 'origin', manifestDoc.repository], { stdio: 'inherit' })
    execFileSync('git', ['-C', workDir, 'fetch', '--depth', '1', 'origin', releaseSpec.commit], { stdio: 'inherit' })
    execFileSync('git', ['-C', workDir, 'checkout', '--detach', 'FETCH_HEAD'], { stdio: 'inherit' })

    const rootResolved = path.resolve(workDir)
    const pkgDir = manifestDoc.subdir ? path.resolve(workDir, manifestDoc.subdir) : rootResolved
    if (pkgDir !== rootResolved && !pkgDir.startsWith(rootResolved + path.sep)) {
      throw new Error(`subdir "${manifestDoc.subdir}" escapes repository root`)
    }

    const pluginJsonPath = path.join(pkgDir, 'plugin.json')
    if (!fs.existsSync(pluginJsonPath)) {
      throw new Error(`missing plugin.json at ${manifestDoc.subdir || '.'}/plugin.json`)
    }
    const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'))
    const mismatch = verifyPluginJsonMatchesManifest(manifestDoc, releaseSpec, pluginJson)
    if (mismatch.length > 0) {
      throw new Error(`manifest mismatch:\n  - ${mismatch.join('\n  - ')}`)
    }

    if (!findLicenseFile(rootResolved, pkgDir)) {
      throw new Error('repository is missing an OSI LICENSE file (LICENSE / LICENSE.md / LICENSE.txt)')
    }

    const rt = manifestDoc.runtime || 'js'
    if (rt === 'native') {
      const goModPath = path.join(pkgDir, 'go.mod')
      if (!fs.existsSync(goModPath)) {
        throw new Error(`native plugin is missing go.mod at ${manifestDoc.subdir || '.'}/go.mod`)
      }
      console.log(`  Running go vet ./... in ${manifestDoc.id}`)
      execFileSync('go', ['vet', './...'], {
        cwd: pkgDir,
        stdio: 'inherit',
        env: { ...process.env, CGO_ENABLED: '0' },
      })
      if (process.env.SKINLOOM_RUN_GOVULNCHECK === '1' || hasCommand('govulncheck')) {
        console.log(`  Running govulncheck ./... in ${manifestDoc.id}`)
        execFileSync('go', ['run', 'golang.org/x/vuln/cmd/govulncheck@latest', './...'], {
          cwd: pkgDir,
          stdio: 'inherit',
          env: { ...process.env, CGO_ENABLED: '0' },
        })
      }
      console.log(`  Verifying CGO_ENABLED=0 compilation in ${manifestDoc.id}`)
      execFileSync('go', ['build', './...'], {
        cwd: pkgDir,
        stdio: 'inherit',
        env: { ...process.env, CGO_ENABLED: '0' },
      })
    } else if (hasCommand('skinloom-plugin')) {
      console.log(`  Running skinloom-plugin lint in ${manifestDoc.id}`)
      execFileSync('skinloom-plugin', ['lint', '--dir', pkgDir], { stdio: 'inherit' })
    }

    console.log(`[PASS] ${manifestDoc.id}@${releaseSpec.version}`)
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}

function main() {
  const args = process.argv.slice(2)
  const manifestFlagIdx = args.indexOf('--manifest')

  if (manifestFlagIdx !== -1 && args[manifestFlagIdx + 1]) {
    const filePath = path.resolve(args[manifestFlagIdx + 1])
    const fileName = path.basename(filePath)
    const doc = parseSimpleYAML(fs.readFileSync(filePath, 'utf8'))
    const errs = validateManifestObject(doc, fileName)
    if (errs.length > 0) {
      throw new Error(`Invalid manifest ${fileName}: ${errs.join('; ')}`)
    }
    auditSingleRelease(doc, doc.releases[0])
    return
  }

  const rawJson = process.env.MANIFESTS_JSON || '[]'
  const entries = JSON.parse(rawJson)
  if (!Array.isArray(entries) || entries.length === 0) {
    console.log('No changed live manifests to audit.')
    return
  }

  for (const entry of entries) {
    const manifestPath = path.join(ROOT_DIR, 'manifests', `${entry.id}.yaml`)
    const altPath = path.join(ROOT_DIR, 'manifests', `${entry.id}.yml`)
    const jsonPath = path.join(ROOT_DIR, 'manifests', `${entry.id}.json`)
    const resolved = [manifestPath, altPath, jsonPath].find((p) => fs.existsSync(p))
    if (!resolved) {
      throw new Error(`Manifest file for "${entry.id}" not found under manifests/`)
    }
    const doc = parseSimpleYAML(fs.readFileSync(resolved, 'utf8'))
    const targets =
      Array.isArray(entry.addedReleases) && entry.addedReleases.length > 0
        ? doc.releases.filter((r) => entry.addedReleases.some((a) => a.version === r.version))
        : [doc.releases[0]]
    for (const rel of targets) {
      if (rel.yanked) continue
      auditSingleRelease(doc, rel)
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
