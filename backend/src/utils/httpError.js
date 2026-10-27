// Throw from a controller or service to send { message, errors? } with the given status (see errorHandler).
// `errors` is an optional list of { path, message } so the frontend can show them under the matching fields.
export class HttpError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

// Use as: doc.save().catch(conflictOnDuplicate('...')) — turns a Mongo duplicate-key error into a 409
export const conflictOnDuplicate = (message) => (err) => {
  if (err.code === 11000) {
    throw new HttpError(409, message);
  }
  throw err;
};
