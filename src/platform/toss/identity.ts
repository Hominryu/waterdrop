import { getUserKeyForGame } from '@apps-in-toss/web-framework';

export async function getTossGameIdentity(): Promise<string> {
  const result: unknown = await getUserKeyForGame();
  if (!result) throw new Error('IDENTITY_UNSUPPORTED');
  if (result === 'INVALID_CATEGORY') throw new Error('IDENTITY_INVALID_CATEGORY');
  if (result === 'ERROR' || typeof result !== 'object') throw new Error('IDENTITY_UNAVAILABLE');

  const response = result as { type?: string; hash?: string };
  if (response.type !== 'HASH' || !response.hash || response.hash.length < 8) {
    throw new Error('IDENTITY_UNAVAILABLE');
  }
  return response.hash;
}
