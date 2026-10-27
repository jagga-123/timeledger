import { ZodError } from 'zod';
import { HttpError } from '../utils/httpError.js';

export const notFound = (req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
};

// Central error handler. Responds with { message, errors? }.
// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(err);
  }

  // The message of an unexpected server error can reveal internals, so it is hidden.
  // An HttpError is thrown on purpose with a message written for the user, so that one is always shown.
  const showMessage = status < 500 || err instanceof HttpError;

  res.status(status).json({
    message: showMessage ? err.message : 'Internal server error',
    ...(showMessage && err.errors && { errors: err.errors }),
  });
};
