// Small helpers that every route file uses for error handling.
// - HttpError:            throw it to answer with a specific status code and message.
// - asyncHandler:         wrap each async route so thrown errors reach errorHandler (middleware/errors.js).
// - rethrowInvalidIdAs400: turn "that id is not a valid UUID" database errors into a friendly 400.

// An error that carries an HTTP status code.
// Example: throw new HttpError(404, 'User not found')  ->  response 404 { "message": "User not found" }
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Express (version 4) doesn't catch errors from async functions by itself. This wrapper catches them
// and passes them to next(), which sends them to errorHandler instead of crashing the request.
// Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
export const asyncHandler = (handler) => {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
};

// Postgres error code 22P02 ("invalid_text_representation") is what we get when an id in the URL
// is not a valid UUID, e.g. /api/users/abc.
const INVALID_UUID_ERROR_CODE = '22P02';

// Use as `.catch(rethrowInvalidIdAs400)` on queries that use an id from the URL:
// a malformed id becomes 400 "Invalid id"; any other database error is passed on unchanged.
export function rethrowInvalidIdAs400(error) {
  if (error.code === INVALID_UUID_ERROR_CODE) {
    throw new HttpError(400, 'Invalid id');
  }
  throw error;
}
