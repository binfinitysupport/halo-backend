export function notFound(req, res) {
  res.status(404).json({ message: 'Not found' });
}

export function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  if (err.name === 'CastError') status = 400;
  if (err.name === 'ValidationError') status = 400;
  if (status === 500) console.error(err);
  res.status(status).json({ message: status === 500 ? 'Server error' : err.message });
}
