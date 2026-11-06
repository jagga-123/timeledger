// Label + input + error. Use as="select" (with <option> children) for a dropdown.
// warning: a soft note in amber under the field (it is not an error: the form can still be saved); an error replaces it
export default function FormField({ label, name, error, warning, as: Field = 'input', children, ...fieldProps }) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <Field
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : warning ? `${name}-warning` : undefined}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 ${
          error
            ? 'border-red-500 focus:ring-red-500/20'
            : 'border-slate-300 focus:border-primary focus:ring-primary/20'
        }`}
        {...fieldProps}
      >
        {children}
      </Field>
      {error && (
        <p id={`${name}-error`} className="mt-1 text-sm text-red-500">
          {error}
        </p>
      )}
      {warning && !error && (
        <p id={`${name}-warning`} className="mt-1 text-sm text-amber-700" role="status" data-testid={`${name}-warning`}>
          {warning}
        </p>
      )}
    </div>
  );
}
