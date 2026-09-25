import { describe, it, expect } from 'vitest';
import { messageMetadata, indexMetadataByTxid, gameFromSpec } from '../messageMetadata.js';

// Shapes taken from a live /apps/permanentmessages entry (2026-09-25).
const update = {
  type: 'fluxappupdate',
  txid: '30738b07942072e13ccef4e4b6633b2d0d6c1ea4465580610a0a78578542f76e',
  appSpecifications: { name: 'minecraftbedrockserver1790300670978', instances: 2, expire: 20158, enterprise: '' }
};
const register = {
  type: 'fluxappregister',
  txid: 'aa11',
  appSpecifications: { name: 'dragonwilds1790087212677', instances: 2, expire: 88000, enterprise: 'BASE64ENCRYPTEDSPEC==' }
};

describe('messageMetadata (#262)', () => {
  it('reads an update of an open spec', () => {
    expect(messageMetadata(update)).toEqual({
      txid: update.txid, msg_type: 'update', enterprise: false, expire_blocks: 20158, instances: 2, game_name: 'Minecraft'
    });
  });

  it('reads a registration of an encrypted (enterprise) spec', () => {
    expect(messageMetadata(register)).toMatchObject({ msg_type: 'register', enterprise: true, expire_blocks: 88000 });
  });

  it('supports the legacy zelAppSpecification key and missing numbers', () => {
    expect(messageMetadata({ type: 'zelappregister', txid: 'x', zelAppSpecification: { name: 'old' } }))
      .toEqual({ txid: 'x', msg_type: 'register', enterprise: false, expire_blocks: null, instances: null, game_name: null });
  });

  it('is null for a message that names no payment', () => {
    expect(messageMetadata({ type: 'fluxappupdate', appSpecifications: {} })).toBeNull();
    expect(messageMetadata(null)).toBeNull();
  });

  it('indexes a payload by payment txid, skipping messages without one', () => {
    const index = indexMetadataByTxid([update, register, { type: 'fluxappupdate' }]);
    expect(index.size).toBe(2);
    expect(index.get('aa11').msg_type).toBe('register');
  });
});

describe('gameFromSpec (#395)', () => {
  it('prefers the game-site name, which survives encryption', () => {
    expect(gameFromSpec({ name: 'palworld1790087212677', enterprise: 'ENCRYPTED' })).toBe('Palworld');
  });

  it('recognises a hand-named server by its game image', () => {
    expect(gameFromSpec({ name: 'rustserver', compose: [{ repotag: 'didstopia/rust-server:latest' }] })).toBe('Rust');
    expect(gameFromSpec({ name: 'Minecraft', repotag: 'itzg/minecraft-server:java17' })).toBe('Minecraft');
  });

  it('is null for non-games, companion websites and private specs with no game name', () => {
    expect(gameFromSpec({ name: 'rustdesk', compose: [{ repotag: 'rustdesk/rustdesk-server:latest' }] })).toBeNull();
    expect(gameFromSpec({ name: 'mcsite', compose: [{ repotag: 'runonflux/minecraft-server-website:latest' }] })).toBeNull();
    expect(gameFromSpec({ name: 'privategameserver', enterprise: 'ENCRYPTED', compose: [] })).toBeNull();
    expect(gameFromSpec(null)).toBeNull();
  });
});
