// Everything that makes a story.json valid: the JSON Schema (compiled ahead
// of time into generated/schemaValidator.js -- see
// scripts/generate-validator.mjs for why) plus the cross-references the
// schema can't express (spec/1.0/README.md section 8).
import schema from "../spec/1.0/story.schema.json" with { type: "json" };
import { validate as schemaValidate } from "./generated/schemaValidator.js";
import { CURRENT_MAJOR, parseVersion } from "./version";
import type { StoryDoc } from "./types";

/** Minor version of the schema bundled here: unknown fields in a file of
 * this minor version or older are probably typos, not newer features. */
const SCHEMA_MINOR = 0;

export interface StoryIssue {
  /** JSON Pointer into story.json ("" for the root), e.g. "/slides/2/media/0/ref". */
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: StoryIssue[];
  /** Not wrong, but probably not intended: unknown fields in a file that
   * claims a version this package fully knows, media nothing uses. */
  warnings: StoryIssue[];
}

/** Checks a story document. `files`, when given, is the set of paths in the
 * zip (relative to its story root), so every media `src` can be checked
 * too; without it only story.json itself is checked. */
export function validate(doc: unknown, files?: { has(path: string): boolean }): ValidationResult {
  const errors: StoryIssue[] = [];
  const warnings: StoryIssue[] = [];

  if (!schemaValidate(doc)) {
    for (const err of schemaValidate.errors ?? []) {
      errors.push({ path: err.instancePath, message: describeSchemaError(err) });
    }
    // Cross-reference checks below assume the basic shape is right.
    return { valid: false, errors, warnings };
  }
  const story = doc as StoryDoc;

  const slideIds = new Set<string>();
  const usedMedia = new Set<string>();
  const checkRef = (key: string, path: string) => {
    usedMedia.add(key);
    if (!Object.prototype.hasOwnProperty.call(story.media, key)) {
      errors.push({ path, message: `refers to media "${key}", which isn't in "media".` });
    }
  };
  story.slides.forEach((slide, i) => {
    if (slideIds.has(slide.id)) {
      errors.push({ path: `/slides/${i}/id`, message: `duplicate slide id "${slide.id}".` });
    }
    slideIds.add(slide.id);
    slide.media?.forEach((m, j) => checkRef(m.ref, `/slides/${i}/media/${j}/ref`));
    slide.place?.overlays?.forEach((o, j) => checkRef(o.media, `/slides/${i}/place/overlays/${j}/media`));
  });

  for (const [key, item] of Object.entries(story.media)) {
    const path = `/media/${escapePointer(key)}`;
    if (files && !files.has(item.src)) {
      errors.push({ path: `${path}/src`, message: `file "${item.src}" is not in the zip.` });
    }
    if (!usedMedia.has(key)) {
      warnings.push({ path, message: `media "${key}" isn't used by any slide or overlay.` });
    }
  }

  const version = parseVersion(story.version);
  if (version && version.major === CURRENT_MAJOR && version.minor <= SCHEMA_MINOR) {
    findUnknownFields(story, schema as unknown as SchemaNode, "", warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

interface AjvError {
  instancePath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

function describeSchemaError(err: AjvError): string {
  if (err.keyword === "pattern" && err.params.pattern === "\\S") return "must not be empty.";
  if (err.keyword === "required") return `is missing required field "${String(err.params.missingProperty)}".`;
  if (err.keyword === "const") return `must be ${JSON.stringify(err.params.allowedValue)}.`;
  if (err.keyword === "enum") return `must be one of ${(err.params.allowedValues as unknown[]).map((v) => JSON.stringify(v)).join(", ")}.`;
  return `${err.message ?? "is invalid"}.`;
}

function escapePointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

type SchemaNode = {
  $ref?: string;
  properties?: Record<string, SchemaNode>;
  additionalProperties?: SchemaNode | boolean;
  items?: SchemaNode;
  prefixItems?: SchemaNode[];
};

function resolveRef(node: SchemaNode, root: Record<string, unknown>): SchemaNode {
  if (!node.$ref) return node;
  const name = node.$ref.replace(/^#\/\$defs\//, "");
  return (root.$defs as Record<string, SchemaNode>)[name];
}

/** Walks the document alongside the schema, warning about any key an
 * object's schema doesn't name. An object whose schema says
 * `additionalProperties: true` (GeoJSON) or gives a schema for extra keys
 * (`media`, `extensions`) is open, not a typo trap. */
function findUnknownFields(value: unknown, node: SchemaNode, path: string, warnings: StoryIssue[], root = schema as unknown as Record<string, unknown>) {
  node = resolveRef(node, root);
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      const itemNode = node.prefixItems?.[i] ?? node.items;
      if (itemNode) findUnknownFields(item, itemNode, `${path}/${i}`, warnings, root);
    });
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${escapePointer(key)}`;
    const known = node.properties?.[key];
    if (known) {
      findUnknownFields(child, known, childPath, warnings, root);
    } else if (typeof node.additionalProperties === "object") {
      findUnknownFields(child, node.additionalProperties, childPath, warnings, root);
    } else if (node.properties && node.additionalProperties !== true) {
      warnings.push({ path: childPath, message: `unknown field "${key}" (ignored).` });
    }
  }
}
