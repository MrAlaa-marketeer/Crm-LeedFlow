# Password reset setup

The app sends recovery emails with the configured Supabase client and redirects recipients to `${window.location.origin}/reset-password`. The reset page accepts a password change only after Supabase reports a `PASSWORD_RECOVERY` event for that browser session. No database migration or additional environment variable is required.

## Supabase dashboard

These settings must be checked or added in the Supabase dashboard for the project that serves this app. They are not changed by this code:

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to the production app origin (scheme and host, without a path), for example `https://crm.example.com`.
3. Add each deployed app's exact recovery URL to **Redirect URLs**, for example `https://crm.example.com/reset-password` and any staging equivalent.
4. For local development, add the actual local URL, commonly `http://localhost:5173/reset-password` when using Vite's default port. If the port differs, add that exact URL instead.
5. In **Authentication → Email Templates → Reset Password**, ensure the email action uses Supabase's confirmation URL (the default `{{ .ConfirmationURL }}` link) so the requested `redirectTo` is honored. If the project uses a custom template, verify the link preserves the recovery type and confirmation URL rather than sending users to an unrelated fixed route.
6. Confirm email sending is configured. Supabase's default mail service is rate-limited and best-effort; configure custom SMTP for production delivery.

Only add origins and paths controlled by the project. Do not use an unrestricted wildcard redirect in production. The app does not verify or claim that these dashboard settings are already present.

## Manual QA

1. Open `/auth`, choose **Forgot password?**, and submit malformed email input. The page should show a localized validation message and send no request.
2. Submit an email with an account and one without an account. Both should show the same generic success text; only the known account receives mail.
3. Open the message on the same browser, follow its link, and verify `/reset-password` shows the new-password form.
4. Try a password shorter than eight characters and a mismatched confirmation; each should show the relevant localized error.
5. Submit a valid matching password. Verify the success state, use **Back to sign in**, and sign in with the new password.
6. Open an expired, malformed, or already-used recovery link and verify the page explains that a new link is needed, with a route back to sign in.
7. Repeat the UI checks in Arabic and English. Confirm Arabic uses RTL layout and English uses LTR layout.
