// OPT-OUT FOOTER — the lines under a sales email: how to make it stop, and who sends it from where (sales/opt-out.js
// decides who gets them). These people never signed up for anything, so nothing here says "unsubscribe": they reply
// "stop" (Design note, 2026-11-23, and the mail watch closes them on that one word (sales/reply-rules.js asksToStop; a reply
// carries the id of the email it answers, so it is proof, audit P6-70). CAN-SPAM asks a commercial email for a way out
// and the sender's postal address; PECR for who sends it and a way out. PURE.

/** The lines under a sales email. */
export const optOutFooter = ({ name, postal }) => [
  '-- ',
  'Reply "stop" and we will not write again.',
  [name, postal].filter(Boolean).join(' · '),
].filter(Boolean).join('\n');

/** The email's text with the footer under it, once. */
export const withFooter = (text, footer) => (!footer || String(text).trimEnd().endsWith(footer.split('\n').at(-1))
  ? String(text) : `${String(text).trimEnd()}\n\n${footer}`);
