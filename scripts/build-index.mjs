#!/usr/bin/env node
/**
 * Builds and signs index.v1.json + index.v1.json.sig from manifests/*.yaml,
 * blocked.yaml, and compiled artifacts in dist/packages/<id>/<version>/.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSimpleYAML, validateManifestObject } from './validate-manifests.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')

const DEFAULT_MIRRORS = [
  'https://registry.skinloom.cn',
  'https://raw.githubusercontent.com/Entropy-Increase-Team/skinloom-registry/dist',
]

const NATIVE_PLATFORMS = [
  'linux/amd64',
  'linux/arm64',
  'windows/amd64',
  'darwin/arm64',
  'darwin/amd64',
]

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function signEd25519Base64(dataBuffer, privateKeyPem) {
  const privKey = crypto.createPrivateKey(privateKeyPem)
  return crypto.sign(null, dataBuffer, privKey).toString('base64')
}

export function buildRegistryIndex({
  rootDir = ROOT_DIR,
  artifactsDir = path.join(ROOT_DIR, 'dist', 'packages'),
  mirrors = DEFAULT_MIRRORS,
  privateKeyPem = process.env.SKINLOOM_REGISTRY_PRIVATE_KEY || '',
} = {}) {
  const manifestsDir = path.join(rootDir, 'manifests')
  const files = fs.existsSync(manifestsDir)
    ? fs
        .readdirSync(manifestsDir)
        .filter((f) => /\.(ya?ml|json)$/i.test(f))
        .sort()
    : []

  const packages = []
  for (const file of files) {
    const raw = fs.readFileSync(path.join(manifestsDir, file), 'utf8')
    const doc = parseSimpleYAML(raw)
    const errs = validateManifestObject(doc, file)
    if (errs.length > 0) {
      throw new Error(`Invalid manifest ${file}: ${errs.join('; ')}`)
    }

    const runtime = doc.runtime || 'js'
    const versions = []
    for (const rel of doc.releases) {
      const verDir = path.join(artifactsDir, doc.id, rel.version)
      const artifacts = {}

      if (runtime === 'js' || doc.kind === 'theme') {
        const fileName = `${doc.id}-${rel.version}.slp`
        const pkgPath = path.join(verDir, fileName)
        const relUrl = `packages/${doc.id}/${rel.version}/${fileName}`
        if (fs.existsSync(pkgPath)) {
          const buf = fs.readFileSync(pkgPath)
          artifacts.any = {
            urls: mirrors.map((m) => `${m.replace(/\/$/, '')}/${relUrl}`),
            sha256: sha256Hex(buf),
            size: buf.length,
            ...(privateKeyPem ? { signature: signEd25519Base64(buf, privateKeyPem) } : {}),
          }
        }
      } else {
        const targets = Array.isArray(rel.targets) && rel.targets.length > 0 ? rel.targets : NATIVE_PLATFORMS
        for (const plat of targets) {
          const [osName, archName] = plat.split('/')
          const fileName = `${doc.id}-${rel.version}-${osName}-${archName}.slp`
          const pkgPath = path.join(verDir, fileName)
          const relUrl = `packages/${doc.id}/${rel.version}/${fileName}`
          if (fs.existsSync(pkgPath)) {
            const buf = fs.readFileSync(pkgPath)
            artifacts[plat] = {
              urls: mirrors.map((m) => `${m.replace(/\/$/, '')}/${relUrl}`),
              sha256: sha256Hex(buf),
              size: buf.length,
              ...(privateKeyPem ? { signature: signEd25519Base64(buf, privateKeyPem) } : {}),
            }
          }
        }
      }

      versions.push({
        version: rel.version,
        apiVersion: Number(rel.apiVersion) || 1,
        ...(runtime === 'native' ? { nativeProtocolVersion: Number(rel.nativeProtocolVersion) || 1 } : {}),
        ...(rel.engines ? { engines: rel.engines } : {}),
        permissions: Array.isArray(rel.permissions) ? rel.permissions : [],
        dependencies: rel.dependencies || {},
        optionalDependencies: rel.optionalDependencies || {},
        publishedAt: rel.publishedAt || new Date().toISOString(),
        yanked: Boolean(rel.yanked),
        ...(rel.changelog ? { changelog: rel.changelog } : {}),
        artifacts,
      })
    }

    packages.push({
      id: doc.id,
      kind: doc.kind,
      runtime,
      category: doc.category,
      official: Boolean(doc.official),
      name: doc.name,
      description: doc.description,
      authors: doc.authors,
      license: doc.license,
      ...(doc.homepage ? { homepage: doc.homepage } : {}),
      repository: doc.repository,
      latest: doc.releases[0].version,
      versions,
    })
  }

  let blocked = []
  const blockedPath = path.join(rootDir, 'blocked.yaml')
  if (fs.existsSync(blockedPath)) {
    const blockedDoc = parseSimpleYAML(fs.readFileSync(blockedPath, 'utf8'))
    if (Array.isArray(blockedDoc?.blocked)) {
      blocked = blockedDoc.blocked
    }
  }

  const indexObj = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    registryId: 'official',
    mirrors,
    packages,
    blocked,
  }
  const indexBytes = Buffer.from(JSON.stringify(indexObj, null, 2) + '\n', 'utf8')
  const indexSig = privateKeyPem ? signEd25519Base64(indexBytes, privateKeyPem) : ''
  return { indexObj, indexBytes, indexSig }
}

function main() {
  const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT_DIR, 'dist')
  const artifactsDir = process.argv[3] ? path.resolve(process.argv[3]) : path.join(outDir, 'packages')
  fs.mkdirSync(outDir, { recursive: true })

  const { indexBytes, indexSig } = buildRegistryIndex({
    rootDir: ROOT_DIR,
    artifactsDir,
  })
  const indexPath = path.join(outDir, 'index.v1.json')
  fs.writeFileSync(indexPath, indexBytes)
  console.log(`Wrote ${indexPath} (${indexBytes.length} bytes)`)

  if (indexSig) {
    const sigPath = path.join(outDir, 'index.v1.json.sig')
    fs.writeFileSync(sigPath, indexSig + '\n')
    console.log(`Wrote Ed25519 signature ${sigPath}`)
  } else {
    console.warn('Warning: SKINLOOM_REGISTRY_PRIVATE_KEY not set; skipped writing index.v1.json.sig')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
