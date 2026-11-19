import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { verifyPluginJsonMatchesManifest } from './audit-changed.mjs'
import { buildRegistryIndex } from './build-index.mjs'
import {
  evaluateManifestReviewGate,
  parseSimpleYAML,
  validateBlockedDoc,
  validateManifestObject,
} from './validate-manifests.mjs'

test('parseSimpleYAML preserves # inside quoted strings and multiline blocks', () => {
  const doc = parseSimpleYAML(`
id: color-demo # trailing comment
name:
  zh-CN: "主题 #1" # comment after quote
  en: 'Theme #1'
homepage: "https://example.com/docs#section"
releases:
  - version: 1.0.0
    changelog: |
      - Fixed #42 color contrast
      - Added dark palette
`)
  assert.equal(doc.id, 'color-demo')
  assert.equal(doc.name['zh-CN'], '主题 #1')
  assert.equal(doc.name.en, 'Theme #1')
  assert.equal(doc.homepage, 'https://example.com/docs#section')
  assert.match(doc.releases[0].changelog, /Fixed #42 color contrast/)
})

test('validateManifestObject enforces HTTPS, valid permissions, and nativeOnly rules', () => {
  const base = {
    id: 'demo-plugin',
    kind: 'plugin',
    runtime: 'js',
    category: 'utility',
    name: { 'zh-CN': '示例', en: 'Demo' },
    description: { 'zh-CN': '描述', en: 'Desc' },
    authors: ['Tester'],
    license: 'MIT',
    repository: 'https://github.com/example/demo-plugin',
    releases: [
      {
        version: '1.0.0',
        commit: '0123456789abcdef0123456789abcdef01234567',
        apiVersion: 1,
        permissions: ['storage.kv', 'users.read'],
      },
    ],
  }
  assert.deepEqual(validateManifestObject(base, 'demo-plugin.yaml'), [])

  // Plain HTTP repo must be rejected
  const httpErrs = validateManifestObject(
    { ...base, repository: 'http://github.com/example/demo-plugin' },
    'demo-plugin.yaml',
  )
  assert.ok(httpErrs.some((e) => e.includes('https://')))

  // Unknown permission & nativeOnly permission on JS must be rejected
  const permErrs = validateManifestObject(
    {
      ...base,
      releases: [{ ...base.releases[0], permissions: ['storage.sql', 'fake.perm'] }],
    },
    'demo-plugin.yaml',
  )
  assert.ok(permErrs.some((e) => e.includes('storage.sql')))
  assert.ok(permErrs.some((e) => e.includes('fake.perm')))

  // Theme with native runtime must be rejected
  const themeErrs = validateManifestObject(
    { ...base, kind: 'theme', runtime: 'native', category: 'theme' },
    'demo-plugin.yaml',
  )
  assert.ok(themeErrs.some((e) => e.includes('themes cannot use runtime "native"')))
})

test('evaluateManifestReviewGate distinguishes fast-track JS updates vs elevated review', () => {
  const baseDoc = {
    id: 'demo-plugin',
    kind: 'plugin',
    runtime: 'js',
    official: false,
    repository: 'https://github.com/example/demo-plugin',
    releases: [
      {
        version: '1.0.0',
        commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        apiVersion: 1,
        permissions: ['storage.kv', 'users.read'],
      },
    ],
  }

  // First submission requires security review
  const first = evaluateManifestReviewGate(baseDoc, null)
  assert.equal(first.needsSecurityReview, true)
  assert.ok(first.reasons.includes('first-time submission'))

  // Routine JS patch without new elevated permissions is fast-tracked
  const patchDoc = {
    ...baseDoc,
    releases: [
      {
        version: '1.0.1',
        commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        apiVersion: 1,
        permissions: ['storage.kv', 'users.read'],
      },
      ...baseDoc.releases,
    ],
  }
  const fastTrack = evaluateManifestReviewGate(patchDoc, baseDoc)
  assert.equal(fastTrack.needsSecurityReview, false)

  // Adding a sensitive permission triggers manual security review
  const escalatedDoc = {
    ...baseDoc,
    releases: [
      {
        version: '1.1.0',
        commit: 'cccccccccccccccccccccccccccccccccccccccc',
        apiVersion: 1,
        permissions: ['storage.kv', 'users.read', 'http.fetch'],
      },
      ...baseDoc.releases,
    ],
  }
  const escalated = evaluateManifestReviewGate(escalatedDoc, baseDoc)
  assert.equal(escalated.needsSecurityReview, true)
  assert.ok(escalated.reasons.some((r) => r.includes('http.fetch')))
})

test('verifyPluginJsonMatchesManifest rejects mismatched permissions or version', () => {
  const manifestDoc = {
    id: 'demo-plugin',
    kind: 'plugin',
    runtime: 'js',
  }
  const rel = { version: '1.0.0', apiVersion: 1, permissions: ['storage.kv'] }

  assert.deepEqual(
    verifyPluginJsonMatchesManifest(manifestDoc, rel, {
      id: 'demo-plugin',
      kind: 'plugin',
      runtime: 'js',
      version: '1.0.0',
      apiVersion: 1,
      permissions: ['storage.kv'],
    }),
    [],
  )

  const errs = verifyPluginJsonMatchesManifest(manifestDoc, rel, {
    id: 'demo-plugin',
    kind: 'plugin',
    runtime: 'js',
    version: '1.0.0',
    apiVersion: 1,
    permissions: ['storage.kv', 'users.ban'],
  })
  assert.ok(errs.some((e) => e.includes('users.ban')))
})

test('buildRegistryIndex signs index.v1.json and artifacts with Ed25519', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-reg-test-'))
  try {
    fs.mkdirSync(path.join(tmp, 'manifests'), { recursive: true })
    fs.mkdirSync(path.join(tmp, 'dist', 'packages', 'demo-plugin', '1.0.0'), { recursive: true })
    fs.writeFileSync(
      path.join(tmp, 'manifests', 'demo-plugin.yaml'),
      `id: demo-plugin
kind: plugin
runtime: js
category: utility
name:
  zh-CN: 示例
  en: Demo
description:
  zh-CN: 描述
  en: Desc
authors:
  - Tester
license: MIT
repository: https://github.com/example/demo-plugin
releases:
  - version: 1.0.0
    commit: 0123456789abcdef0123456789abcdef01234567
    apiVersion: 1
    permissions:
      - storage.kv
`,
    )
    fs.writeFileSync(path.join(tmp, 'blocked.yaml'), 'blocked: []\n')
    const fakeArchive = Buffer.from('PK\x03\x04demo-slp-content')
    fs.writeFileSync(
      path.join(tmp, 'dist', 'packages', 'demo-plugin', '1.0.0', 'demo-plugin-1.0.0.slp'),
      fakeArchive,
    )

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    const { indexObj, indexBytes, indexSig } = buildRegistryIndex({
      rootDir: tmp,
      artifactsDir: path.join(tmp, 'dist', 'packages'),
      privateKeyPem: privateKey,
      requireArtifacts: true,
    })

    assert.equal(indexObj.packages.length, 1)
    assert.ok(indexObj.packages[0].versions[0].artifacts.any)
    assert.ok(
      crypto.verify(null, indexBytes, crypto.createPublicKey(publicKey), Buffer.from(indexSig, 'base64')),
    )
    assert.ok(
      crypto.verify(
        null,
        fakeArchive,
        crypto.createPublicKey(publicKey),
        Buffer.from(indexObj.packages[0].versions[0].artifacts.any.signature, 'base64'),
      ),
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('validateBlockedDoc rejects empty reasons or invalid IDs', () => {
  assert.deepEqual(validateBlockedDoc({ blocked: [] }), [])
  const errs = validateBlockedDoc({ blocked: [{ id: 'BAD_ID', reason: '' }] })
  assert.equal(errs.length, 2)
})
