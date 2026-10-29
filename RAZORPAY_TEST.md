# Razorpay test-mode setup

Local SQLite payments are configured for the existing Razorpay adapter. The hosted Render/Neon demo remains mock-only under the existing hosted policy.

## Dashboard webhook

1. Use **Test Mode** in Razorpay, then **Accounts & Settings ? Webhooks ? Add New Webhook**.
2. Read the currently running temporary endpoint with `Get-Content .tools/webhook-url.txt`. Its path is `/api/payments/webhook`.
3. Copy `RAZORPAY_WEBHOOK_SECRET` from `backend/.env` into the dashboard Secret field, without quotes. This is a separately generated secret, not the API key secret. Do not commit or paste it in chat.
4. Subscribe to `payment.captured` and `payment.failed` and save.

The URL forwards only this webhook route to the local API. The backend verifies HMAC against the raw payload. A temporary Cloudflare tunnel must remain running; restarting it changes its URL and requires updating the dashboard. Razorpay must accept the hostname in the dashboard; a successful probe does not prove dashboard registration or delivery of a real payment event.

## Start after stopping existing processes

From the repository root, run `npm run dev`. In a second terminal, run `npm run payments:webhook`. Do not start duplicates if the app and tunnel are already running. The helper uses the official SHA-256-verified Windows binary installed at `.tools/cloudflared.exe`; on another machine, install cloudflared and set `CLOUDFLARED_BIN` to its full executable path.

Open http://127.0.0.1:5173/ and sign in. If this session's app was started by the assistant with output captured, the local console OTP is in `.tools/login-dev.log`; otherwise it appears in your dev terminal.

Create a **new pickup** with a future slot, then continue to payment and click Pay. Existing mock-payment orders cannot be reused after changing gateways; cancel unpaid old reservations and create a fresh pickup. Razorpay Checkout should show Test Mode instead of Loop's mock success/failure controls.

Use Razorpay's documented test payment method. With Netbanking, select a bank and use the mock bank's Success or Failure action. Ensure your test account captures payments: Loop only confirms captured payments verified server-side. Check the resulting pickup, refresh it, and inspect the Razorpay dashboard's webhook deliveries. The app does not perform real pickup dispatch.

## Configuration

Only `backend/.env` holds `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`; `PAYMENT_PROVIDER=razorpay` selects the adapter. The key ID may be returned to Checkout; the secrets never belong in frontend environment variables. Restart the API after changing environment settings.

To return to mock mode, set `PAYMENT_PROVIDER=mock` in the backend env and restart the API. Start a fresh booking after switching gateways.

## Verification performed during setup

- Authenticated read against Razorpay's test Orders API: HTTP 200.
- Existing server adapter created one INR 100-paise test order. No payment was charged.
- Local API health reports `paymentProvider: razorpay`.
- Public tunnel rejects unrelated API routes (404), rejects unsigned webhooks (400), and accepts a correctly signed synthetic unsupported-event routing probe (200). The routing probe does not settle a payment.
- Actual captured-payment delivery remains to be verified after dashboard registration and a completed test checkout.

References: [Razorpay webhook setup](https://github.com/razorpay/markdown-docs/blob/master/payments/dashboard/account-settings/webhooks.md), [Razorpay webhook validation](https://github.com/razorpay/markdown-docs/blob/master/webhooks/validate-test.md), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Final checks: 100 backend tests passed, including the gateway-switch regression. ESLint, workspace TypeScript checks and the backend build passed. Dashboard registration was confirmed by the user. Actual captured test-payment delivery remains to be verified.

After dashboard registration, the public endpoint checks passed again: unrelated API routes 404, unsigned webhook 400, signed routing probe 200. The local database currently has no Razorpay payments or recorded Razorpay webhook events; a fresh test checkout is the next verification step.
