export default function FormField({ label, name, error, ...inputProps }) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none transition focus:ring-2 ${
          error
            ? 'border-red-500 focus:ring-red-500/20'
            : 'border-slate-300 focus:border-primary focus:ring-primary/20'
        }`}
        {...inputProps}
      />
      {error && (
        <p id={`${name}-error`} className="mt-1 text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
