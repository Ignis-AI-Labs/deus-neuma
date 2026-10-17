# LinkedIn setup

This integration adds text posts to a personal LinkedIn profile through the
existing channel binding, approval and queue controls. It does not add feed
reading, comments, messages or media uploads.

## Connect an account

1. Create or select your app in the [LinkedIn developer portal](https://www.linkedin.com/developers/).
2. Add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**.
   Request `w_member_social`, `openid` and `profile` when authorizing the member.
3. Keep the token's actual issue time and expiry from the authorization response
   or developer portal. Tokens are normally valid for 60 days; an account lookup
   does not reveal how much of that time remains.
4. Run `node scripts/linkedin-verify.mjs` with `LINKEDIN_ACCESS_TOKEN` configured
   to identify the member and obtain the Person URN. The script's suggested
   expiry assumes a newly issued token; replace it with the actual expiry.
5. In **Settings → API → Channel Keys**, enter all three fields:

   | Field | Value |
   | ----- | ----- |
   | Person URN | `urn:li:person:…` returned for the intended member |
   | Access Token | The member's token |
   | Token Expiry | The actual expiry as an ISO date/time |

6. Run `node scripts/linkedin-verify.mjs` again to check the configured account.
   Bind LinkedIn to the intended neuma in the LinkedIn window. The channel has
   one holder at a time.

The request shape and permission come from LinkedIn's
[Share on LinkedIn guide](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin).
Account discovery uses its [OpenID Connect userinfo endpoint](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2).

## Posting and renewal

`social/post` uses the existing intent approval policy. Review the target
account and text before approving. Approved scheduled posts require the backend
to be running; LinkedIn receives the publish request when the scheduler sends it.

The account check displays the recorded expiry warning within seven days and
a renewal notice after that date. A successful account lookup proves that
lookup only; it does not prove that a post was accepted. Renew the token through
the authorized app flow and update its expiry together. Programmatic refresh
is available to approved partners; this integration does not assume access to
it. See [LinkedIn's token documentation](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens).

A successful publish receipt includes the returned post ID. If a request is
interrupted after dispatch, publication may already have happened: check
LinkedIn before retrying. A client interrupt cannot retract remote publication.

A deliberate live acceptance post can be sent with:

```bash
node scripts/linkedin-verify.mjs --post "Your approved text"
```

That command publishes publicly. Local protocol tests use a loopback endpoint;
they do not prove live account permissions or LinkedIn acceptance. The verify
scripts refuse the loopback override so a fixture cannot be reported as a live
account check. Live acceptance remains separate from this draft implementation.
