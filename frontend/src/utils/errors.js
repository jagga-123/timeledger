import toast from 'react-hot-toast';

// Field errors from the API:{ errors: [{ path, message }] } -> { path: message } (first error per field)
export const getFieldErrors = (err) => {
  const errors = err.response?.data?.errors;
  if (!Array.isArray(errors)) return {};

  const fieldErrors = {};
  for (const { path, message } of errors) {
    if (path && !fieldErrors[path]) fieldErrors[path] = message;
  }
  return fieldErrors;
};

// Field errors go under their inputs, a 409 conflict goes under `conflictField`, anything else is a toast
export const handleFormError = (err, setErrors, conflictField) => {
  const fieldErrors = getFieldErrors(err);
  if (Object.keys(fieldErrors).length > 0) {
    setErrors(fieldErrors);
  } else if (conflictField && err.response?.status === 409) {
    setErrors({ [conflictField]: err.response.data.message });
  } else {
    toast.error(getErrorMessage(err));
  }
};

// General message for toasts
export const getErrorMessage = (err) => {
  if (!err.response) return 'Cannot reach the server. Please try again.';
  return err.response.data?.message || 'Something went wrong. Please try again.';
};
