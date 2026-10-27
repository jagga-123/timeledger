// Throw from a controller to send { message } with the given status (see errorHandler)
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Use as: doc.save().catch(conflictOnDuplicate('...')) — turns a Mongo duplicate-key error into a 409
export const conflictOnDuplicate = (message) => (err) => {
  if (err.code === 11000) {
    throw new HttpError(409, message);
  }
  throw err;
};
