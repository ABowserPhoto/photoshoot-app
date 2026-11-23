# Billing mailbox (invoice drafts)

Client invoice mail is drafted in **rechnung@aaronbowser-photography.com** with the display name **Monie**. Gallery delivery, preview emails, booking mail, and the supplier-invoice scanner stay on `GOOGLE_WORKSPACE_USER_EMAIL`.

The address and name are constants in `lib/billingMailbox.ts`. No new Vercel variable is required for the address. Do not point `GOOGLE_WORKSPACE_USER_EMAIL` at the Rechnung mailbox — that would also move Drive, photo drafts, and the incoming-invoice scanner.

## How Gmail auth works

The app does not use a user OAuth refresh token or a Gmail send-as alias. `lib/google.ts` builds a Google service-account JWT:

| Env var | Role |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account client email |
| `GOOGLE_PRIVATE_KEY` | Service account PEM private key |
| `GOOGLE_WORKSPACE_USER_EMAIL` | Workspace user impersonated for Drive, gallery drafts, preview drafts, and the supplier-invoice scanner |

Domain-wide delegation (`subject` on the JWT) is what makes Gmail API calls run as that user. `users.drafts.create` with `userId: "me"` writes the draft into the impersonated mailbox.

Invoice and reminder drafts use a second JWT with the same service account and the same scopes, and `subject` set to `rechnung@aaronbowser-photography.com`. `From` is `Monie <rechnung@aaronbowser-photography.com>`. `Reply-To` is `rechnung@aaronbowser-photography.com`.

There is no `GOOGLE_BILLING_*` secret. Adding one is unnecessary unless the mailbox address itself changes; in that case update `lib/billingMailbox.ts`.

## What Aaron must do before production drafts succeed

Until domain-wide delegation can impersonate the Rechnung user, invoice and reminder draft calls fail. They do not fall back to the studio mailbox.

1. In [Google Workspace Admin](https://admin.google.com) → Security → Access and data control → API controls → Domain-wide delegation, open the existing service account client ID (the numeric client ID of `GOOGLE_SERVICE_ACCOUNT_EMAIL`, from Google Cloud → the service account → Advanced settings / Domain-wide delegation).
2. Confirm these scopes are authorized for that client ID (they are the scopes in `lib/google.ts`):
   - `https://www.googleapis.com/auth/gmail.compose`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/drive`
3. No separate OAuth consent screen login as `rechnung@` is required for this app. Delegation is domain-wide, not a per-user refresh token. The Rechnung user must exist and be allowed to use Gmail (it already does).
4. In the Rechnung Gmail account (signed in as `rechnung@aaronbowser-photography.com`) → Settings → Accounts → Send mail as, set the display name to **Monie**. Gmail can replace the MIME `From` name with this account name when a draft is sent. The app still writes `Monie` into the draft.
5. In Lexware / Lexoffice, if the organization letterhead or the account’s own outgoing invoice mail still shows “Aaron Bowser Photography | Rechnung”, change that display name to **Monie** and the contact email to `rechnung@aaronbowser-photography.com`. This app downloads the Lexoffice PDF and does not call Lexware’s send-mail API. The PDF letterhead is Lexware’s, not a template in this repo.
6. Optional, and not used by Workflow: connect `rechnung@` to any assistant Gmail connector if people want that mailbox in an assistant. Workflow drafts do not go through that connector.
7. Redeploy Workflow after this branch is merged so production runs the new code. No new Vercel env var is required. Leave `GOOGLE_WORKSPACE_USER_EMAIL` on the studio mailbox.

Staff send the drafts from the Rechnung mailbox (Gmail → Drafts while signed in as `rechnung@`). Drafts no longer appear in the studio mailbox.
