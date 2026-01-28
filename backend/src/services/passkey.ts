/**
 * Passkey/WebAuthn Service
 * Handles biometric and hardware key authentication
 */

import { query, execute, transaction } from '../db/index.ts';
import { randomBytes } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

interface PasskeyCredential {
  id: string;
  userId: string;
  credentialId: Uint8Array;
  credentialIdB64: string;
  publicKey: Uint8Array;
  counter: number;
  deviceType: string | null;
  transports: string[] | null;
  backupEligible: boolean;
  backupState: boolean;
  displayName: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

interface PasskeyChallenge {
  id: string;
  challenge: Uint8Array;
  challengeB64: string;
  type: 'registration' | 'authentication';
  userId: string | null;
  email: string | null;
  expiresAt: Date;
}

// Relying Party info
const RP_NAME = 'Juicy Vision';
const RP_ID = Deno.env.get('PASSKEY_RP_ID') || 'localhost';
const ORIGIN = Deno.env.get('PASSKEY_ORIGIN') || 'http://localhost:3000';

// ============================================================================
// Utilities
// ============================================================================

function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return new Uint8Array([...binary].map(c => c.charCodeAt(0)));
}

function generateChallenge(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

function generateUserId(): Uint8Array {
  return new Uint8Array(randomBytes(16));
}

// ============================================================================
// Challenge Management
// ============================================================================

/**
 * Create a registration challenge for a user
 */
export async function createRegistrationChallenge(userId: string): Promise<{
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
  timeout: number;
  attestation: string;
  authenticatorSelection: {
    authenticatorAttachment?: string;
    residentKey: string;
    userVerification: string;
  };
}> {
  // Get user info
  const users = await query<{ email: string }>(
    'SELECT email FROM users WHERE id = $1',
    [userId]
  );

  if (users.length === 0) {
    throw new Error('User not found');
  }

  const userEmail = users[0].email;

  // Generate challenge
  const challenge = generateChallenge();
  const challengeB64 = base64UrlEncode(challenge);

  // Store challenge
  await execute(
    `INSERT INTO passkey_challenges (challenge, challenge_b64, type, user_id)
     VALUES ($1, $2, 'registration', $3)`,
    [challenge, challengeB64, userId]
  );

  // Generate user handle (stored with credential)
  const userHandle = base64UrlEncode(generateUserId());

  return {
    challenge: challengeB64,
    rp: {
      name: RP_NAME,
      id: RP_ID,
    },
    user: {
      id: userHandle,
      name: userEmail,
      displayName: userEmail.split('@')[0],
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256 (P-256)
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout: 300000, // 5 minutes
    attestation: 'none', // Don't need attestation for consumer use
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  };
}

/**
 * Create an authentication challenge
 */
export async function createAuthenticationChallenge(email?: string): Promise<{
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: string;
  allowCredentials?: Array<{ type: 'public-key'; id: string; transports?: string[] }>;
}> {
  const challenge = generateChallenge();
  const challengeB64 = base64UrlEncode(challenge);

  // Store challenge
  await execute(
    `INSERT INTO passkey_challenges (challenge, challenge_b64, type, email)
     VALUES ($1, $2, 'authentication', $3)`,
    [challenge, challengeB64, email || null]
  );

  // If email provided, get their credentials for allowCredentials
  let allowCredentials: Array<{ type: 'public-key'; id: string; transports?: string[] }> | undefined;

  if (email) {
    const credentials = await query<{ credential_id_b64: string; transports: string[] | null }>(
      `SELECT pc.credential_id_b64, pc.transports
       FROM passkey_credentials pc
       JOIN users u ON pc.user_id = u.id
       WHERE u.email = $1`,
      [email]
    );

    if (credentials.length > 0) {
      allowCredentials = credentials.map(c => ({
        type: 'public-key' as const,
        id: c.credential_id_b64,
        transports: c.transports || undefined,
      }));
    }
  }

  return {
    challenge: challengeB64,
    rpId: RP_ID,
    timeout: 300000,
    userVerification: 'preferred',
    allowCredentials,
  };
}

/**
 * Verify and consume a challenge
 */
async function consumeChallenge(
  challengeB64: string,
  type: 'registration' | 'authentication'
): Promise<PasskeyChallenge | null> {
  const results = await query<{
    id: string;
    challenge: Uint8Array;
    challenge_b64: string;
    type: 'registration' | 'authentication';
    user_id: string | null;
    email: string | null;
    expires_at: Date;
  }>(
    `DELETE FROM passkey_challenges
     WHERE challenge_b64 = $1 AND type = $2 AND expires_at > NOW()
     RETURNING *`,
    [challengeB64, type]
  );

  if (results.length === 0) return null;

  const row = results[0];
  return {
    id: row.id,
    challenge: row.challenge,
    challengeB64: row.challenge_b64,
    type: row.type,
    userId: row.user_id,
    email: row.email,
    expiresAt: row.expires_at,
  };
}

// ============================================================================
// Registration
// ============================================================================

export interface RegistrationResponse {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
  authenticatorAttachment?: string;
  type: 'public-key';
}

/**
 * Verify registration and store credential
 */
export async function verifyRegistration(
  userId: string,
  response: RegistrationResponse,
  displayName?: string
): Promise<PasskeyCredential> {
  // Decode client data
  const clientDataJSON = base64UrlDecode(response.response.clientDataJSON);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

  // Verify challenge
  const challenge = await consumeChallenge(clientData.challenge, 'registration');
  if (!challenge || challenge.userId !== userId) {
    throw new Error('Invalid or expired challenge');
  }

  // Verify origin
  if (clientData.origin !== ORIGIN) {
    throw new Error('Invalid origin');
  }

  // Verify type
  if (clientData.type !== 'webauthn.create') {
    throw new Error('Invalid type');
  }

  // Decode attestation object
  const attestationObject = base64UrlDecode(response.response.attestationObject);

  // Parse CBOR attestation object (simplified - in production use proper CBOR library)
  // For now, we'll extract the public key from the raw response
  const credentialId = base64UrlDecode(response.rawId);
  const credentialIdB64 = response.rawId;

  // Extract public key from attestation (simplified)
  // In production, properly parse CBOR and validate
  const publicKey = attestationObject; // Store full attestation for now

  // Store credential
  await execute(
    `INSERT INTO passkey_credentials (
       user_id, credential_id, credential_id_b64, public_key, counter,
       device_type, transports, display_name
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      credentialId,
      credentialIdB64,
      publicKey,
      0,
      response.authenticatorAttachment || null,
      response.response.transports || null,
      displayName || null,
    ]
  );

  // Enable passkey for user
  await execute(
    'UPDATE users SET passkey_enabled = TRUE WHERE id = $1',
    [userId]
  );

  // Return credential
  const credentials = await query<any>(
    'SELECT * FROM passkey_credentials WHERE credential_id_b64 = $1',
    [credentialIdB64]
  );

  return dbToCredential(credentials[0]);
}

// ============================================================================
// Authentication
// ============================================================================

export interface AuthenticationResponse {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
  authenticatorAttachment?: string;
  type: 'public-key';
}

/**
 * Verify authentication and return user
 */
export async function verifyAuthentication(
  response: AuthenticationResponse
): Promise<{ userId: string; credentialId: string }> {
  // Decode client data
  const clientDataJSON = base64UrlDecode(response.response.clientDataJSON);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

  // Verify challenge
  const challenge = await consumeChallenge(clientData.challenge, 'authentication');
  if (!challenge) {
    throw new Error('Invalid or expired challenge');
  }

  // Verify origin
  if (clientData.origin !== ORIGIN) {
    throw new Error('Invalid origin');
  }

  // Verify type
  if (clientData.type !== 'webauthn.get') {
    throw new Error('Invalid type');
  }

  // Find credential
  const credentialIdB64 = response.rawId;
  const credentials = await query<{
    id: string;
    user_id: string;
    public_key: Uint8Array;
    counter: number;
  }>(
    'SELECT id, user_id, public_key, counter FROM passkey_credentials WHERE credential_id_b64 = $1',
    [credentialIdB64]
  );

  if (credentials.length === 0) {
    throw new Error('Credential not found');
  }

  const credential = credentials[0];

  // Decode authenticator data
  const authenticatorData = base64UrlDecode(response.response.authenticatorData);

  // Extract counter from authenticator data (bytes 33-36, big-endian)
  const newCounter = new DataView(authenticatorData.buffer).getUint32(33, false);

  // SECURITY: Counter verification to prevent replay attacks
  // The counter must be strictly greater than the stored counter to ensure each
  // authentication response is unique.
  //
  // Special case: Some authenticators (especially older platform authenticators)
  // always return counter=0. We allow this ONLY if:
  // 1. Both stored AND new counter are 0 (authenticator doesn't support counters)
  // 2. Stored is 0 but new is non-zero (authenticator started using counters)
  //
  // We REJECT if:
  // - Stored counter is non-zero but new counter is <= stored (replay or rollback)
  // - New counter is 0 but stored counter was non-zero (suspicious regression)
  if (credential.counter > 0) {
    // Once we've seen a non-zero counter, we require strictly increasing counters
    if (newCounter <= credential.counter) {
      console.error('Passkey counter validation failed', {
        credentialId: credential.id,
        storedCounter: credential.counter,
        newCounter,
      });
      throw new Error('Invalid counter - possible replay attack');
    }
  } else if (newCounter === 0 && credential.counter === 0) {
    // Both are zero - authenticator doesn't support counters, allow
    console.warn('Passkey authenticator does not support counters', {
      credentialId: credential.id,
    });
  }
  // Otherwise: stored is 0 but new is > 0, which is fine (first real use)

  // In production: verify signature using stored public key
  // This requires proper COSE key parsing and crypto verification
  // For now, we trust the WebAuthn response structure

  // Update counter and last used
  await execute(
    `UPDATE passkey_credentials
     SET counter = $1, last_used_at = NOW()
     WHERE credential_id_b64 = $2`,
    [newCounter, credentialIdB64]
  );

  return {
    userId: credential.user_id,
    credentialId: credential.id,
  };
}

// ============================================================================
// Credential Management
// ============================================================================

/**
 * Get all passkeys for a user
 */
export async function getUserPasskeys(userId: string): Promise<PasskeyCredential[]> {
  const results = await query<any>(
    `SELECT * FROM passkey_credentials
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  return results.map(dbToCredential);
}

/**
 * Delete a passkey
 */
export async function deletePasskey(userId: string, credentialId: string): Promise<void> {
  const result = await execute(
    'DELETE FROM passkey_credentials WHERE id = $1 AND user_id = $2',
    [credentialId, userId]
  );

  // Check if user has any remaining passkeys
  const remaining = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM passkey_credentials WHERE user_id = $1',
    [userId]
  );

  if (parseInt(remaining[0].count) === 0) {
    // Disable passkey flag
    await execute(
      'UPDATE users SET passkey_enabled = FALSE WHERE id = $1',
      [userId]
    );
  }
}

/**
 * Rename a passkey
 */
export async function renamePasskey(
  userId: string,
  credentialId: string,
  displayName: string
): Promise<void> {
  await execute(
    `UPDATE passkey_credentials
     SET display_name = $1
     WHERE id = $2 AND user_id = $3`,
    [displayName, credentialId, userId]
  );
}

// ============================================================================
// Helpers
// ============================================================================

function dbToCredential(row: any): PasskeyCredential {
  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    credentialIdB64: row.credential_id_b64,
    publicKey: row.public_key,
    counter: row.counter,
    deviceType: row.device_type,
    transports: row.transports,
    backupEligible: row.backup_eligible,
    backupState: row.backup_state,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

// Cleanup expired challenges periodically
export async function cleanupExpiredChallenges(): Promise<void> {
  await execute(
    'DELETE FROM passkey_challenges WHERE expires_at < NOW()'
  );
}

// ============================================================================
// Passkey-based Signup (no prior auth required)
// ============================================================================

/**
 * Create a registration challenge for a new user signup
 * This is used when the user wants to sign up using only a passkey
 */
export async function createSignupChallenge(): Promise<{
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
  timeout: number;
  attestation: string;
  authenticatorSelection: {
    authenticatorAttachment?: string;
    residentKey: string;
    userVerification: string;
  };
  tempUserId: string;
}> {
  // Generate a temporary user ID that will be used to create the actual user
  const tempUserId = crypto.randomUUID();
  const userIdBytes = generateUserId();
  const userIdB64 = base64UrlEncode(userIdBytes);

  // Generate challenge
  const challenge = generateChallenge();
  const challengeB64 = base64UrlEncode(challenge);

  // Store challenge with temp user ID (no real user yet)
  await execute(
    `INSERT INTO passkey_challenges (challenge, challenge_b64, type, email, expires_at)
     VALUES ($1, $2, 'registration', $3, NOW() + INTERVAL '5 minutes')`,
    [challenge, challengeB64, `signup:${tempUserId}`]
  );

  return {
    challenge: challengeB64,
    rp: { name: RP_NAME, id: RP_ID },
    user: {
      id: userIdB64,
      name: `passkey-user-${tempUserId.slice(0, 8)}`,
      displayName: 'Passkey User',
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout: 300000,
    attestation: 'none',
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
    tempUserId,
  };
}

/**
 * Verify signup registration - creates user and stores credential
 */
export async function verifySignupRegistration(
  response: RegistrationResponse,
  displayName?: string
): Promise<{ userId: string; credential: PasskeyCredential }> {
  // Decode client data
  const clientDataJSON = base64UrlDecode(response.response.clientDataJSON);
  const clientData = JSON.parse(new TextDecoder().decode(clientDataJSON));

  // Find and consume challenge (stored with signup:tempUserId in email field)
  const results = await query<{
    id: string;
    challenge: Uint8Array;
    challenge_b64: string;
    type: 'registration' | 'authentication';
    user_id: string | null;
    email: string | null;
    expires_at: Date;
  }>(
    `DELETE FROM passkey_challenges
     WHERE challenge_b64 = $1 AND type = 'registration' AND expires_at > NOW()
     RETURNING *`,
    [clientData.challenge]
  );

  if (results.length === 0) {
    throw new Error('Invalid or expired challenge');
  }

  const challenge = results[0];

  // Verify this is a signup challenge (email field starts with 'signup:')
  if (!challenge.email?.startsWith('signup:')) {
    throw new Error('Invalid challenge type');
  }

  // Verify origin
  if (clientData.origin !== ORIGIN) {
    throw new Error('Invalid origin');
  }

  // Verify type
  if (clientData.type !== 'webauthn.create') {
    throw new Error('Invalid type');
  }

  // Decode attestation object to extract public key
  const attestationObject = base64UrlDecode(response.response.attestationObject);

  // Parse CBOR attestation object (simplified - just extract authData)
  // The attestation object is CBOR encoded with format:
  // { fmt: string, attStmt: object, authData: bytes }
  // For now, we'll do a simple extraction
  const authDataStart = attestationObject.indexOf(0x58) + 2; // 0x58 = CBOR byte string marker
  const authDataLength = attestationObject[authDataStart - 1];
  const authData = attestationObject.slice(authDataStart, authDataStart + authDataLength);

  // Extract flags and counter from authData
  // authData structure: rpIdHash (32) + flags (1) + counter (4) + attestedCredentialData
  const flags = authData[32];
  const counter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0, false);

  // Extract attested credential data
  // aaguid (16) + credIdLen (2) + credId (credIdLen) + publicKey (COSE)
  const credIdLen = new DataView(authData.buffer, authData.byteOffset + 53, 2).getUint16(0, false);
  const credentialId = authData.slice(55, 55 + credIdLen);
  const publicKey = authData.slice(55 + credIdLen);

  const credentialIdB64 = base64UrlEncode(credentialId);

  // Check backup flags
  const backupEligible = (flags & 0x08) !== 0;
  const backupState = (flags & 0x10) !== 0;

  // Create new user with auto-generated email
  const tempUserId = challenge.email.replace('signup:', '');
  const userEmail = `passkey-${tempUserId.slice(0, 8)}@passkey.local`;

  // Get next custodial address index
  const maxIndexResult = await query<{ max: number | null }>(
    'SELECT MAX(custodial_address_index) as max FROM users'
  );
  const nextIndex = (maxIndexResult[0]?.max ?? -1) + 1;

  // Create user
  const userResult = await query<{ id: string; email: string; privacy_mode: string; email_verified: boolean }>(
    `INSERT INTO users (email, custodial_address_index, passkey_enabled)
     VALUES ($1, $2, TRUE)
     RETURNING id, email, privacy_mode, email_verified`,
    [userEmail, nextIndex]
  );

  const user = userResult[0];

  // Determine device type from authenticatorAttachment
  let deviceType: string | null = null;
  if (response.authenticatorAttachment === 'platform') {
    deviceType = 'platform';
  } else if (response.authenticatorAttachment === 'cross-platform') {
    deviceType = 'security_key';
  }

  // Store credential
  const credResult = await query<any>(
    `INSERT INTO passkey_credentials
     (user_id, credential_id, credential_id_b64, public_key, counter, device_type, transports, backup_eligible, backup_state, display_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      user.id,
      credentialId,
      credentialIdB64,
      publicKey,
      counter,
      deviceType,
      response.response.transports || null,
      backupEligible,
      backupState,
      displayName || null,
    ]
  );

  // Update user to indicate passkey is enabled
  await execute(
    'UPDATE users SET passkey_enabled = TRUE WHERE id = $1',
    [user.id]
  );

  return {
    userId: user.id,
    credential: dbToCredential(credResult[0]),
  };
}
