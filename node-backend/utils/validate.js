/**
 * Validate `body` against a zod schema and return the cleaned data.
 * On failure it throws an error with status 400, which errorHandler turns
 * into a JSON response.
 */
function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;

  const message = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
  const error = new Error(message);
  error.status = 400;
  throw error;
}

module.exports = { parseBody };
