// Stands in for @stripe/stripe-js, which Privy imports for its card on-ramp (unused by RUNNER).
// The real library injects Stripe's fraud-detection frame as soon as it's imported, which played a
// tone on iPhones when the app opened. The import map in index.html / admin.html points it here.
export const loadStripe = async () => null;
loadStripe.setLoadParameters = () => {};
