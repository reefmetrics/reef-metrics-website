// Waitlist deposit checkout — one place controls every "Join the Waitlist" button.
// ⚠ TEST link (sandbox — test cards only, NO real money) while verifying the flow.
//    LIVE link to restore on re-launch: https://buy.stripe.com/14A14oeuW2wr8TO2K97Re00
const STRIPE_WAITLIST_LINK = "https://buy.stripe.com/test_5kQ14p6IO33weGn6kUbjW00";
if (STRIPE_WAITLIST_LINK) {
  document.querySelectorAll('[data-waitlist]').forEach(function (a) {
    a.setAttribute('href', STRIPE_WAITLIST_LINK);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  });
}
