// Intl.supportedValuesOf('timeZone') only lists each zone's canonical name, so it leaves out common
// names such as "Asia/Kolkata" (listed as "Asia/Calcutta") and "UTC". Resolving the name first
// turns those into their canonical form, which is then checked against the list.
const SUPPORTED_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

export const isValidTimeZone = (timeZone) => {
  if (typeof timeZone !== 'string' || timeZone === '') return false;

  try {
    const canonical = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
    return canonical === 'UTC' || SUPPORTED_ZONES.has(canonical);
  } catch {
    return false; // Intl doesn't know this zone
  }
};
