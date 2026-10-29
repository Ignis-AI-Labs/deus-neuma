/**
 * The pure law of approving a TikTok Direct Post (frontend/utils/tiktok-consent.js),
 * called with real inputs — no mocks, nothing to fake. Each rule is one of
 * TikTok's Content Sharing Guidelines ([…], read 2026-10-23): privacy chosen with no default from the account's
 * own options, interactions off until turned on and refused when the account
 * turned them off, the commercial disclosure (at least one kind, branded
 * content never private), the declaration's exact words, and a send that
 * refuses a changed world instead of adjusting the post.
 */
import { describe, expect, test } from 'vitest';
import {
  EMPTY_CHOICE, TIKTOK_WORDS, creatorView, readChoice, choiceBlockers, commercialLabel, consentDeclaration,
  consentRecord, sendRefusal,
} from '../../frontend/utils/tiktok-consent.js';

const CREATOR = creatorView({
  creator_username: 'deusneuma', creator_nickname: 'Deus Neuma',
  privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY', 'SOMETHING_NEW'],
  comment_disabled: false, duet_disabled: false, stitch_disabled: true, max_video_post_duration_sec: 300,
});
const choose = (patch) => readChoice({ ...EMPTY_CHOICE, ...patch });

describe('the account as creator info names it', () => {
  test('nickname, handle, only the privacy levels TikTok documents, the interaction switches, the longest video', () => {
    expect(CREATOR).toEqual({
      nickname: 'Deus Neuma', username: 'deusneuma',
      privacyOptions: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
      commentDisabled: false, duetDisabled: false, stitchDisabled: true, maxVideoSec: 300,
    });
    expect(creatorView(null)).toMatchObject({ nickname: '', privacyOptions: [], commentDisabled: false, maxVideoSec: null });
  });
});

describe('no default: nothing is chosen for the person', () => {
  test('the starting choice has no privacy, every interaction off, the disclosure off — and cannot be approved', () => {
    expect(readChoice(EMPTY_CHOICE)).toEqual(EMPTY_CHOICE);
    expect(choiceBlockers(readChoice(EMPTY_CHOICE), CREATOR)).toEqual([TIKTOK_WORDS.choosePrivacy]);
  });

  test('off the wire only `true` turns anything on, and an unknown privacy is no privacy', () => {
    expect(readChoice({ privacyLevel: 'EVERYONE_PLUS', allow: { comment: 'yes', duet: 1, stitch: true } })).toEqual({
      privacyLevel: '', allow: { comment: false, duet: false, stitch: true }, commercial: { on: false, yourBrand: false, branded: false },
    });
    expect(readChoice({ privacyLevel: 'constructor' }).privacyLevel).toBe('');
    // Kinds under a closed disclosure never count.
    expect(readChoice({ commercial: { on: false, branded: true, yourBrand: true } }).commercial).toEqual({ on: false, yourBrand: false, branded: false });
    expect(readChoice(undefined)).toEqual(EMPTY_CHOICE);
  });

  test('without creator info nothing can be approved', () => {
    expect(choiceBlockers(choose({ privacyLevel: 'SELF_ONLY' }), null)).toEqual(['TikTok has not said yet what this account allows']);
  });
});

describe('the choice judged against the account', () => {
  test('a privacy the account offers stands; one it does not is refused by name', () => {
    expect(choiceBlockers(choose({ privacyLevel: 'MUTUAL_FOLLOW_FRIENDS' }), CREATOR)).toEqual([]);
    expect(choiceBlockers(choose({ privacyLevel: 'FOLLOWER_OF_CREATOR' }), CREATOR))
      .toEqual(['This TikTok account does not offer "Followers" right now']);
  });

  test('an interaction the account turned off cannot be turned on', () => {
    expect(choiceBlockers(choose({ privacyLevel: 'SELF_ONLY', allow: { comment: true, duet: true, stitch: false } }), CREATOR)).toEqual([]);
    expect(choiceBlockers(choose({ privacyLevel: 'SELF_ONLY', allow: { comment: true, duet: false, stitch: true } }), CREATOR))
      .toEqual(['This TikTok account has stitch turned off']);
  });

  test('a disclosure turned on must name at least one kind', () => {
    expect(choiceBlockers(choose({ privacyLevel: 'PUBLIC_TO_EVERYONE', commercial: { on: true } }), CREATOR))
      .toEqual(['You need to indicate if your content promotes yourself, a third party, or both.']);
    expect(choiceBlockers(choose({ privacyLevel: 'PUBLIC_TO_EVERYONE', commercial: { on: true, yourBrand: true } }), CREATOR)).toEqual([]);
  });

  test('branded content is never private (only me); your brand may be', () => {
    expect(choiceBlockers(choose({ privacyLevel: 'SELF_ONLY', commercial: { on: true, branded: true } }), CREATOR))
      .toEqual(['Branded content visibility cannot be set to private.']);
    expect(choiceBlockers(choose({ privacyLevel: 'MUTUAL_FOLLOW_FRIENDS', commercial: { on: true, branded: true } }), CREATOR)).toEqual([]);
    expect(choiceBlockers(choose({ privacyLevel: 'SELF_ONLY', commercial: { on: true, yourBrand: true } }), CREATOR)).toEqual([]);
  });

  test('every reason is listed, in the card\'s order', () => {
    expect(choiceBlockers(choose({ allow: { stitch: true }, commercial: { on: true } }), CREATOR)).toEqual([
      TIKTOK_WORDS.choosePrivacy, 'This TikTok account has stitch turned off', TIKTOK_WORDS.pickCommercial,
    ]);
  });
});

describe('TikTok\'s words', () => {
  test('the label a disclosed video carries', () => {
    expect(commercialLabel({ on: false, yourBrand: true, branded: true })).toBeNull();
    expect(commercialLabel({ on: true, yourBrand: false, branded: false })).toBeNull();
    expect(commercialLabel({ on: true, yourBrand: true, branded: false })).toBe('Your video will be labeled as \'Promotional content\'');
    expect(commercialLabel({ on: true, yourBrand: false, branded: true })).toBe('Your video will be labeled as \'Paid partnership\'');
    expect(commercialLabel({ on: true, yourBrand: true, branded: true })).toBe('Your video will be labeled as \'Paid partnership\'');
  });

  test('the declaration: Music Usage Confirmation always, the Branded Content Policy once branded content is chosen', () => {
    const music = { text: 'By posting, you agree to TikTok\'s Music Usage Confirmation.', policies: ['music'] };
    const both = { text: 'By posting, you agree to TikTok\'s Branded Content Policy and Music Usage Confirmation.', policies: ['branded', 'music'] };
    expect(consentDeclaration({ on: false, branded: false })).toEqual(music);
    expect(consentDeclaration({ on: true, yourBrand: true, branded: false })).toEqual(music);
    expect(consentDeclaration({ on: true, branded: true })).toEqual(both);
    expect(consentDeclaration({ on: true, yourBrand: true, branded: true })).toEqual(both);
  });
});

describe('the approval record, and the send that honours it exactly', () => {
  const at = new Date('2026-10-23T12:00:00Z');
  const choice = choose({ privacyLevel: 'MUTUAL_FOLLOW_FRIENDS', allow: { comment: true }, commercial: { on: true, branded: true } });
  const consent = consentRecord(choice, CREATOR, at);

  test('the record holds the choices, the account the card named, and the declaration read', () => {
    expect(consent).toEqual({
      privacyLevel: 'MUTUAL_FOLLOW_FRIENDS',
      allow: { comment: true, duet: false, stitch: false },
      commercial: { on: true, yourBrand: false, branded: true },
      account: { username: 'deusneuma', nickname: 'Deus Neuma' },
      declaration: 'By posting, you agree to TikTok\'s Branded Content Policy and Music Usage Confirmation.',
      consentedAt: '2026-10-23T12:00:00.000Z',
    });
    // A JSON round trip (the queue store) keeps it whole.
    expect(sendRefusal(JSON.parse(JSON.stringify(consent)), CREATOR)).toBeNull();
  });

  test('no approval, another account, or an account that no longer allows the choice: refused, never adjusted', () => {
    expect(sendRefusal(null, CREATOR)).toMatch(/carries no approval of who can watch it.*Nothing was published$/);
    expect(sendRefusal(consent, { ...CREATOR, username: 'someone-else' }))
      .toMatch(/now posts as @someone-else; this post was approved for @deusneuma\. Approve it again from its card/);
    expect(sendRefusal(consent, { ...CREATOR, privacyOptions: ['SELF_ONLY'] }))
      .toMatch(/^This TikTok account does not offer "Friends" right now, so the post cannot go out as approved/);
    expect(sendRefusal(consent, { ...CREATOR, commentDisabled: true })).toMatch(/has comments turned off, so the post cannot go out as approved/);
  });
});
