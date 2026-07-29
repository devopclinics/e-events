// Phase 3 (API contract pipeline): converts the backend's exported OpenAPI
// document (docs/api-contract/openapi.json — see backend/scripts/export_openapi.py)
// into ambient TypeScript declarations for every named Pydantic schema.
//
// This project is plain JS/JSX, not TypeScript, and this script deliberately
// doesn't change that. The generated .d.ts file is picked up by editors (via
// frontend/jsconfig.json) so `adaptX()` functions and API call sites get real
// type information and autocomplete without a build-step migration. Treat this
// as the types half of the contract; request/response *runtime* validation at
// the highest-risk call sites is a separate, later effort (see docs/API_CONTRACTS.md).
//
// Scope: only components.schemas (the 251 named request/response models) are
// converted — not a per-path request/response map. Every api.js function's
// payload and return shape is one of these named schemas already, so this
// covers what adapters actually consume without the added complexity of
// matching each path+method to its schema individually.
//
// Regenerate after any backend schema change:
//   node scripts/generate-api-types.mjs
// Detect drift (fails if committed types are stale) in CI:
//   ./scripts/check-api-contract-drift.sh

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const SPEC_PATH = path.join(here, '..', '..', 'docs', 'api-contract', 'openapi.json')
const outFlagIndex = process.argv.indexOf('--out')
const OUT_PATH = outFlagIndex !== -1 && process.argv[outFlagIndex + 1]
  ? path.resolve(process.argv[outFlagIndex + 1])
  : path.join(here, '..', 'src', 'types', 'api.d.ts')

function readSpec() {
  const raw = readFileSync(SPEC_PATH, 'utf8')
  return JSON.parse(raw)
}

function refName(ref) {
  return ref.split('/').pop()
}

function isNullSchema(s) {
  return s && s.type === 'null'
}

// Converts one JSON-Schema node to a TS type expression (as a string).
function schemaToType(schema, schemas) {
  if (!schema) return 'unknown'
  if (schema.$ref) return refName(schema.$ref)

  if (Array.isArray(schema.anyOf)) {
    const variants = schema.anyOf.filter((v) => !isNullSchema(v)).map((v) => schemaToType(v, schemas))
    const hasNull = schema.anyOf.some(isNullSchema)
    const unique = [...new Set(variants)]
    const body = unique.length ? unique.join(' | ') : 'unknown'
    return hasNull ? `(${body}) | null` : body
  }
  if (Array.isArray(schema.oneOf)) {
    const variants = schema.oneOf.map((v) => schemaToType(v, schemas))
    return [...new Set(variants)].join(' | ')
  }
  if (Array.isArray(schema.allOf)) {
    // Pydantic rarely emits this here (checked: 0 occurrences at generation
    // time), but if it appears, an intersection is the closest honest mapping.
    return schema.allOf.map((v) => schemaToType(v, schemas)).join(' & ')
  }

  if (schema.enum) {
    const literals = schema.enum.map((v) => (typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'` : JSON.stringify(v)))
    return [...new Set(literals)].join(' | ')
  }

  switch (schema.type) {
    case 'string':
      return 'string'
    case 'integer':
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return `(${schemaToType(schema.items, schemas)})[]`
    case 'object': {
      if (schema.properties && Object.keys(schema.properties).length) {
        return objectLiteral(schema, schemas)
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        return `Record<string, ${schemaToType(schema.additionalProperties, schemas)}>`
      }
      // Free-form JSON blob (e.g. design-service's theme_config/asset_config/
      // page_config) — deliberately not `any`; callers must narrow before use.
      return 'Record<string, unknown>'
    }
    default:
      return 'unknown'
  }
}

function objectLiteral(schema, schemas) {
  const required = new Set(schema.required || [])
  const lines = Object.entries(schema.properties || {}).map(([key, propSchema]) => {
    const optional = required.has(key) ? '' : '?'
    const propKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : `'${key}'`
    return `  ${propKey}${optional}: ${schemaToType(propSchema, schemas)}`
  })
  return `{\n${lines.join('\n')}\n}`
}

function schemaToDeclaration(name, schema, schemas) {
  // Plain string/int enum with no properties -> a union type alias reads
  // better than an empty interface.
  const isEnumAlias = (schema.enum || schema.oneOf || schema.anyOf) && schema.type !== 'object' && !schema.properties
  if (schema.type === 'object' && (schema.properties || schema.additionalProperties)) {
    return `export interface ${name} ${objectLiteral(schema, schemas)}\n`
  }
  if (isEnumAlias || schema.type !== 'object') {
    return `export type ${name} = ${schemaToType(schema, schemas)}\n`
  }
  return `export interface ${name} {}\n`
}

function main() {
  const spec = readSpec()
  const schemas = spec.components?.schemas || {}
  const names = Object.keys(schemas).sort((a, b) => a.localeCompare(b))

  const header = `// GENERATED FILE — do not hand-edit.
// Source: docs/api-contract/openapi.json (backend OpenAPI document).
// Regenerate: node scripts/generate-api-types.mjs
// Drift check (CI): ./scripts/check-api-contract-drift.sh
//
// Covers every named request/response schema FastAPI generates from the
// Pydantic models in backend/app/schemas.py. Pull one into a plain .js/.jsx
// file with a JSDoc annotation — no build step, no runtime import (a .d.ts
// has no JS output; editors resolve the type-only import statically):
//   /** @type {import('../types/api').GuestOut[]} */
//   const guests = await api.listGuests(eventId)

`

  const body = names.map((name) => schemaToDeclaration(name, schemas[name], schemas)).join('\n')

  writeFileSync(OUT_PATH, header + body)
  console.log(`Wrote ${path.relative(process.cwd(), OUT_PATH)} (${names.length} schemas)`)
}

main()
