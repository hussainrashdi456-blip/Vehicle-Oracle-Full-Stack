const multer = require('multer');

function notFound(req, res) {
  res.status(404).json({ error: 'Route not found.' });
}

// Express 5 forwards rejected promises from async handlers here, so route code
// doesn't need its own try/catch just to return a 500.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof multer.MulterError) {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res
      .status(tooBig ? 413 : 400)
      .json({ error: tooBig ? 'Image must be smaller than 5 MB.' : 'Invalid file upload.' });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
  if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid identifier.' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });

  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
}

module.exports = { notFound, errorHandler };
