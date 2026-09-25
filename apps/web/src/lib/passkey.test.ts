import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { passkeyMessage } from './passkey';

const err = (name: string, code?: string) => Object.assign(new Error('x'), { name, code });

describe('passkeyMessage', () => {
  it('passes the server’s own words through', () => {
    expect(passkeyMessage(new ApiError(401, 'UNAUTHORIZED', 'Link already used'), 'No.')).toBe(
      'Link already used',
    );
  });
  it('tells a device that already has a passkey to use it', () => {
    expect(passkeyMessage(err('InvalidStateError'), 'No.')).toMatch(/already has a Rise passkey/);
    expect(
      passkeyMessage(err('Error', 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'), 'No.'),
    ).toMatch(/already has/);
  });
  it('names a domain the browser refuses', () => {
    expect(passkeyMessage(err('SecurityError'), 'No.')).toMatch(/this address/);
    expect(passkeyMessage(err('Error', 'ERROR_INVALID_RP_ID'), 'No.')).toMatch(/this address/);
  });
  it('says cancelled only when it was', () => {
    expect(passkeyMessage(err('NotAllowedError'), 'Not added.')).toBe(
      'Not added. It was cancelled or timed out.',
    );
    expect(passkeyMessage(err('NotSupportedError'), 'Not added.')).toMatch(/can't make/);
  });
  it('falls back for anything else', () => {
    expect(passkeyMessage(new TypeError('boom'), 'Not added.')).toBe('Not added.');
    expect(passkeyMessage(undefined, 'Not added.')).toBe('Not added.');
  });
});
