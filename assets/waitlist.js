// Waitlist deposit checkout — one place controls every "Join the Waitlist" button.
// LIVE Stripe payment link — real $500 charges. Issues a unique customer-locked code via the webhook.
const STRIPE_WAITLIST_LINK = "https://buy.stripe.com/14A14oeuW2wr8TO2K97Re00";
if (STRIPE_WAITLIST_LINK) {
  document.querySelectorAll('[data-waitlist]').forEach(function (a) {
    a.setAttribute('href', STRIPE_WAITLIST_LINK);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
  });
}
