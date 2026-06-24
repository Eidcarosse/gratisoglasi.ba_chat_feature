/**
 * Layer: Common (middleware).
 * validate(schema) — Express middleware that parses/validates req (body/params/query) against a
 * zod schema, replacing the raw input with the parsed result or throwing a 400 AppError. The
 * single validation entry point for REST; socket handlers reuse the same zod schemas directly.
 */
import { AppError } from '../errors/AppError.js';

/**
 * @param {{body?: import('zod').ZodTypeAny, params?: ..., query?: ...}} schema
 */
export function validate(schema) {
  return (req, _res, next) => {
    try {
      for (const part of ['body', 'params', 'query']) {
        if (schema[part]) {
          const parsed = schema[part].parse(req[part] ?? {});
          // req.query is a getter-only on some Express versions — assign defensively.
          if (part === 'query') {
            Object.keys(req.query).forEach((k) => delete req.query[k]);
            Object.assign(req.query, parsed);
          } else {
            req[part] = parsed;
          }
        }
      }
      next();
    } catch (err) {
      if (err?.issues) {
        next(AppError.validation('Validation failed', err.flatten().fieldErrors));
      } else {
        next(err);
      }
    }
  };
}

/**
 * validatePayload(schema, payload) — for socket handlers. Returns parsed data; throws AppError
 * on failure so the handler can translate it into an ack error.
 */
export function validatePayload(schema, payload) {
  try {
    return schema.parse(payload ?? {});
  } catch (err) {
    if (err?.issues) throw AppError.validation('Validation failed', err.flatten().fieldErrors);
    throw err;
  }
}

export default validate;
