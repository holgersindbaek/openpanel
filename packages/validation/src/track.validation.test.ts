import { describe, expect, it } from 'vitest';
import { zTrackHandlerPayload } from './track.validation';

describe('zTrackHandlerPayload', () => {
  it('accepts null optional identify fields as missing values', () => {
    const parsed = zTrackHandlerPayload.parse({
      type: 'identify',
      payload: {
        profileId: 'profile-1',
        firstName: null,
        lastName: null,
        email: null,
        avatar: null,
      },
    });

    expect(parsed).toEqual({
      type: 'identify',
      payload: {
        profileId: 'profile-1',
        firstName: undefined,
        lastName: undefined,
        email: undefined,
        avatar: undefined,
      },
    });
  });
});
