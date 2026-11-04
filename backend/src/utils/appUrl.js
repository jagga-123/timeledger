// The address people open the app at: the start of every link in an email, e.g. http://localhost:5173
// APP_URL wins; the CORS origin (FRONTEND_URL) is a good second guess because it is the same place.
export const appUrl = () => (process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

// The link a client opens to see an invoice without logging in
export const shareUrlFor = (token) => (token ? `${appUrl()}/i/${token}` : null);
