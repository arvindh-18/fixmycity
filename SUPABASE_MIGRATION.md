# Supabase Authentication Migration Guide

This guide walks you through setting up Supabase Auth for FixMyCity or migrating from an existing Firebase project.

---

## 1. Supabase Dashboard Setup

1. **Create a project**:
   - Go to [supabase.com](https://supabase.com) and create a project in your preferred region.

2. **Authentication → Providers**:
   - **Email**: Enable the Email provider. Ensure **"Confirm email" is turned ON** (required: staff-role security depends on verifying email addresses).
   - **Google**: Enable Google OAuth provider.
     - Get Client ID & Client Secret from Google Cloud Console.
     - In Google Cloud Console, add `https://<your-project-ref>.supabase.co/auth/v1/callback` as an Authorized Redirect URI.
   - *Custom SMTP Note*: The built-in Supabase email sender is strictly rate-limited and intended only for testing. For production, set up custom SMTP (under Project Settings → Authentication → SMTP Settings) so verification and password-reset emails reliably reach residents.

3. **Authentication → URL Configuration**:
   - Set **Site URL** to your production URL (e.g. `https://fixmycity.onrender.com`).
   - Add **Redirect URLs**:
     - `http://localhost:5173/**`
     - `https://<your-render-domain>/**`

4. **API Keys**:
   - Go to **Project Settings → API Keys**.
   - Copy **Project URL** (`SUPABASE_URL`).
   - Copy **Anon / Publishable key** (`SUPABASE_ANON_KEY`).
   *(Never share or configure the Service Role / Secret key — FixMyCity only uses the public anon key).*

---

## 2. Do You Have Real Users in Firebase?

If this is a fresh setup or you only used demo accounts (`dev:` tokens), **skip steps 3 and 4** and jump straight to **Step 5**.

---

## 3. Keep Existing Users' History (Preserve UIDs)

To ensure returning users retain their historical reports, upvotes, and chats without altering existing database rows:

1. Export user accounts from Firebase:
   ```bash
   firebase auth:export users.json --format=json
   ```

2. Run a dry run to verify the mappings:
   ```bash
   DATABASE_URL="<your-database-url>" python backend/scripts/import_legacy_uids.py users.json --dry-run
   ```

3. Import the mappings into the database:
   ```bash
   DATABASE_URL="<your-database-url>" python backend/scripts/import_legacy_uids.py users.json
   ```
   *This script is idempotent and safe to re-run at any time.*

---

## 4. Let Existing Email/Password Users Keep Passwords (Optional)

Supabase natively supports Firebase's scrypt password hashes.
- Use Supabase's official migration utility: [supabase-community/firebase-to-supabase](https://github.com/supabase-community/firebase-to-supabase) (`auth` folder).
- If you skip this tool, existing email/password users can simply click **"Forgot password?"** once to set their password in Supabase.
- Google sign-in users simply click **"Continue with Google"** with the same email.

In all cases, their existing issues, upvotes, and messages remain associated with their account via the legacy UID mapping table.

---

## 5. Cutover Order

1. On Render (or Cloud Run / host):
   - Set `SUPABASE_URL` to your project URL.
   - Set `SUPABASE_ANON_KEY` to your project anon key.
   - Remove all old `FIREBASE_*` environment variables.
2. Deploy the latest `chore/supabase-auth` branch or release.
3. Smoke test:
   - **Resident**: Test Google sign-in and email sign-up/sign-in.
   - **Worker**: Verify field worker tab opens `/worker`.
   - **Admin**: Verify city admin tab opens `/admin` and team management functions.
4. Note to users: Existing sessions are invalidated during cutover, so users will be prompted to sign in once.

---

## 6. Rollback Plan

If you need to revert:
- Redeploy the `pre-supabase` git tag.
- Restore the `FIREBASE_*` environment variables.
- The only database change introduced was one standalone `legacy_uids` table, which is ignored by earlier code. Rollback is safe and does not modify or delete civic data.
