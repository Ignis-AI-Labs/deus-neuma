// What sales-mail.test.js stands in on (RULE 0: real stand-ins, nothing mocked in the path): the house's model
// answering the claims reader from the email it is shown (local-provider.js), and a desk connection that keeps every
// frame it is sent.

/** The claims reader's answers, by what the email says. */
export const claimsAnswer = (body) => {
  if (!String(body.messages?.[0]?.content ?? '').startsWith('You are the CLAIMS READER')) return null;
  const shown = String(body.messages[1].content);
  if (shown.includes('yield ladder')) return '1 | one-to-one sessions\nNONE | a Base yield ladder that earns on your balances';
  if (shown.includes('GARBLED')) return 'Looks fine to me.';
  if (shown.includes('250 dollars')) return '2 | a session costs 250 dollars an hour';
  return 'NO CLAIMS';
};

/** A connection for the seat `lane` of `house`, and the frames it was sent. */
export const rigFor = (lane, house) => {
  const sent = [];
  const ws = { readyState: 1, OPEN: 1, send: (s) => sent.push(JSON.parse(s)) };
  return { sent, connection: { ws, companion: { name: 'Mercator', neumaId: lane }, walletAddress: house, activeTurn: null } };
};
