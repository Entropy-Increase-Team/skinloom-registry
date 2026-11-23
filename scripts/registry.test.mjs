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
    changelog:
      zh-CN: "首个正式版本"
      en: "Initial release"
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
    assert.equal(indexObj.packages[0].versions[0].changelog, '首个正式版本')
    assert.deepEqual(indexObj.packages[0].versions[0].changelogI18n, {
      'zh-CN': '首个正式版本',
      en: 'Initial release',
    })
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

test('localized multiline YAML changelog parses, validates, and rejects empty entries', () => {
  const valid = parseSimpleYAML(`id: i18n-changelog
kind: plugin
runtime: js
category: utility
name:
  zh-CN: 双语日志示例
  en: Bilingual Changelog Demo
description:
  zh-CN: 示例描述
  en: Demo description
authors:
  - Team
license: MIT
repository: https://github.com/example/i18n-changelog
releases:
  - version: 1.0.1
    commit: 0123456789abcdef0123456789abcdef01234567
    apiVersion: 1
    changelog:
      zh-CN: |
        - 补全前后端中英双语提示
        - 优化移动端按钮热区
      en: |
        - Complete bilingual backend & frontend localization
        - Improve mobile touch targets
`)
  assert.deepEqual(validateManifestObject(valid, 'i18n-changelog.yaml'), [])
  assert.equal(valid.releases[0].changelog['zh-CN'], '- 补全前后端中英双语提示\n- 优化移动端按钮热区')
  assert.equal(
    valid.releases[0].changelog.en,
    '- Complete bilingual backend & frontend localization\n- Improve mobile touch targets',
  )

  const invalid = structuredClone(valid)
  invalid.releases[0].changelog = { 'zh-CN': '有效说明', en: '   ' }
  const errs = validateManifestObject(invalid, 'i18n-changelog.yaml')
  assert.ok(errs.some((e) => e.includes('localized changelog')))
})

test('high-risk Yggdrasil key and player UUID permissions trigger elevated security review', () => {
  const baseDoc = {
    id: 'mua-union',
    kind: 'plugin',
    runtime: 'native',
    official: true,
    repository: 'https://github.com/Entropy-Increase-Team/skinloom-plugins',
    releases: [
      {
        version: '1.0.0',
        commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        apiVersion: 1,
        permissions: ['admin.ui', 'native.exec', 'storage.sql', 'yggdrasil.key.write', 'players.uuid.write'],
      },
    ],
  }
  const gate = evaluateManifestReviewGate(baseDoc, null)
  assert.equal(gate.needsSecurityReview, true)
  assert.ok(gate.reasons.some((r) => r.includes('yggdrasil.key.write')))
  assert.ok(gate.reasons.some((r) => r.includes('players.uuid.write')))
})

test('validator rejects all-zero placeholder commit SHAs, theme permissions, and native packages missing native.exec', () => {
  const zeroCommit = {
    id: 'zero-demo',
    kind: 'plugin',
    runtime: 'js',
    name: { 'zh-CN': '演示', en: 'Demo' },
    description: { 'zh-CN': '描述', en: 'Desc' },
    authors: ['Team'],
    license: 'MIT',
    repository: 'https://github.com/example/zero-demo',
    releases: [{ version: '1.0.0', commit: '0000000000000000000000000000000000000000', apiVersion: 1 }],
  }
  assert.ok(validateManifestObject(zeroCommit, 'zero-demo.yaml').some((e) => e.includes('non-zero')))

  const badTheme = {
    ...zeroCommit,
    id: 'bad-theme',
    kind: 'theme',
    releases: [{ version: '1.0.0', commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', apiVersion: 1, permissions: ['users.read'] }],
  }
  assert.ok(validateManifestObject(badTheme, 'bad-theme.yaml').some((e) => e.includes('theme packages cannot declare')))

  const badNative = {
    ...zeroCommit,
    id: 'bad-native',
    runtime: 'native',
    releases: [{ version: '1.0.0', commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', apiVersion: 1, permissions: ['admin.ui'] }],
  }
  assert.ok(validateManifestObject(badNative, 'bad-native.yaml').some((e) => e.includes('native.exec')))
})

test('review gate blocks fast-track repository/subdir hijack and release removal', () => {
  const base = {
    id: 'js-pkg',
    kind: 'plugin',
    runtime: 'js',
    repository: 'https://github.com/org/repo-a',
    subdir: 'pkg',
    releases: [{ version: '1.0.0', commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', apiVersion: 1, permissions: ['admin.ui'] }],
  }
  const hijackedRepo = {
    ...base,
    repository: 'https://github.com/attacker/repo-b',
    releases: [
      { version: '1.0.1', commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', apiVersion: 1, permissions: ['admin.ui'] },
      ...base.releases,
    ],
  }
  const gate1 = evaluateManifestReviewGate(hijackedRepo, base)
  assert.equal(gate1.needsSecurityReview, true)
  assert.ok(gate1.reasons.some((r) => r.includes('repository URL')))

  const removedRel = {
    ...base,
    releases: [{ version: '1.0.1', commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', apiVersion: 1, permissions: ['admin.ui'] }],
  }
  const gate2 = evaluateManifestReviewGate(removedRel, base)
  assert.equal(gate2.needsSecurityReview, true)
  assert.ok(gate2.reasons.some((r) => r.includes('removes previously published release')))
})
