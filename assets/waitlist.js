// Waitlist deposit checkout — one place controls every "Join the Waitlist" button.
// ⚠ Currently the TEST payment link (sandbox — test cards only, NO real money).
//    Swap this to your LIVE Stripe payment link before launch.
const STRIPE_WAITLIST_LINK = "https://buy.stripe.com/test_5kQ14p6IO33weGn6kUbjW00";
if (STRIPE_WAITLIST_LINK) {
  document.querySelectorAll('[data-waitlist]').forEach(function (a) {
    a.setAttribute('href', STRIPE_WAITLIST_LINK);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  });
}
