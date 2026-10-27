// Validates req.body against a Zod schema and replaces it with the parsed (trimmed/normalised) data.
// On failure the ZodError goes to the central error handler, which responds with
// 400 { message: 'Validation failed', errors: [{ path, message }] }.
export const validate = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body);
  next();
};
