// External hosts the views load from. Each one is listed on purpose: Helmet's default
// `script-src 'self'` blocks them, which silently breaks the navbar and the error animation.
// Add a host here only when a view in src/views needs it.
export const CDN_ORIGINS = Object.freeze({
  JSDELIVR: 'https://cdn.jsdelivr.net', // Bootstrap script (partials/footer.ejs)
  UNPKG: 'https://unpkg.com', // lottie-player script (error.ejs)
  LOTTIEFILES: 'https://assets9.lottiefiles.com', // animation JSON that lottie-player fetches (error.ejs)
});

// Merged over Helmet's defaults (`useDefaults`), so every directive not named here keeps its safe default.
export const CSP_DIRECTIVES = Object.freeze({
  scriptSrc: ["'self'", CDN_ORIGINS.JSDELIVR, CDN_ORIGINS.UNPKG],
  connectSrc: ["'self'", CDN_ORIGINS.LOTTIEFILES],
});
