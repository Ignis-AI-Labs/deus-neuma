Fixed
- The API reference now shows sign-in and local-desk checks accurately, and marks URL-token login only where it is supported.
- An email whose server acknowledgement is lost is marked as possibly sent so it is not blindly sent again.
- Legal review now stops when a source, recency feed, or second reader cannot be verified, and refuses source links carrying secret material.
- The security watch now detects bare wallet private keys in more file types and in git history.
- Setup no longer exposes credentials embedded in saved provider addresses.
