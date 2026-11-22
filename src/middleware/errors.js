// The last two handlers in index.js: they decide what the client sees when nothing matched or something failed.
// Every error response has the same shape: { "message": "..." }.

// Unknown /api path -> 404.
export function notFound(req, res) {
  res.status(404).json({ message: 'Not found' });
}

// Any error thrown in a route (see asyncHandler in utils/http.js) ends up here.
// - Errors with a status (HttpError) are expected problems, e.g. 400 "Enter an amount": send their message.
// - Errors without a status are bugs or database failures: log the details on the server and send a
//   generic "Server error" so internal details are never shown to the client.
// Express recognises an error handler by its four parameters, so `_next` must stay even though it's unused.
export function errorHandler(error, req, res, _next) {
  const status = error.status || 500;
  const isUnexpectedError = status === 500;

  if (isUnexpectedError) {
    console.error(error);
  }
  const message = isUnexpectedError ? 'Server error' : error.message;
  res.status(status).json({ message });
}
