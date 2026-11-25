# Email

No email delivery is implemented. `EMAIL_PROVIDER=console` (development) prints the password-reset link to the **server log**; `none` discards it. The forgot-password page says so and never claims an email was sent. Responses are identical whether or not the address exists. To add real delivery, implement a provider in `backend/src/email/provider.js` (interface: `send({ to, subject, text })`) and select it with `EMAIL_PROVIDER`. Email verification is out of scope.
