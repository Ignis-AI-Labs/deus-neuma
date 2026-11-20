Fixed
- A provider's stored "verified" no longer outranks a live check. An address Apollo handed over marked verified from its own records, but which Apollo's live check couldn't confirm, was sent on the stored flag and hard-bounced ("550 5.1.1: the address does not exist"). Now a stored "verified" counts only while no live check has answered, and an address with only a stored flag is checked live before an email is written to it or sent.

Changed
- Another layer before a first email leaves. Every send from the outbox now checks the address again, instead of relying on the check from when the email was staged. A first email to someone the house has never written to goes only to an address a database confirmed live. Any other first email stops at send with the reason, unless you open it and press SEND ANYWAY — NOT CONFIRMED (twice). Your sales agent can't override this. Replies and follow-ups aren't affected.
- A bounce is recorded as a check from the recipient's mail server, so that address reads WILL BOUNCE everywhere. Addresses that stand only on a provider's stored flag show as VALID ON A PROVIDER'S RECORD — NOT CHECKED LIVE, and CHECK ADDRESSES checks them.
