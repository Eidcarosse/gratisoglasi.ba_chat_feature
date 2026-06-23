/**
 * Layer: Common (middleware).
 * validate(schema) — Express middleware that parses/validates req (body/params/query) against a
 * zod schema, replacing the raw input with the parsed result or throwing a 400 AppError. The
 * single validation entry point for REST; socket handlers reuse the same zod schemas directly.
 */
