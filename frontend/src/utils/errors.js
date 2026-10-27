// Field errors from the API: { errors: [{ path, message }] } -> { path: message } (first error per field)
export const getFieldErrors = (err) => {
  const errors = err.response?.data?.errors;
  if (!Array.isArray(errors)) return {};

  const fieldErrors = {};
  for (const { path, message } of errors) {
    if (path && !fieldErrors[path]) fieldErrors[path] = message;
  }
  return fieldErrors;
};

// General message for toasts
export const getErrorMessage = (err) => {
  if (!err.response) return 'Cannot reach the server. Please try again.';
  return err.response.data?.message || 'Something went wrong. Please try again.';
};
