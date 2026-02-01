/**
 * Linked Addresses Service
 *
 * Enables account merging by linking multiple addresses to a single JuicyID.
 * When a user has both a connected wallet and a passkey (Touch ID) account,
 * they can link them together to share the same identity.
 *
 * Design:
 * - Primary address: Has the JuicyID, other addresses inherit it
 * - Linked address: Secondary address that resolves to primary's identity
 * - No circular links: An address can't be both primary and linked
 * - Case-insensitive: All address comparisons are case-insensitive
 */

import { query, queryOne, execute, transaction } from '../db/index.ts';
import { getIdentityByAddress } from './identity.ts';

// ============================================================================
// Types
// ============================================================================

export interface LinkedAddress {
  id: string;
  primaryAddress: string;
  linkedAddress: string;
  linkType: 'manual' | 'smart_account' | 'passkey' | 'wallet';
  userId?: string;
  createdAt: Date;
}

export interface LinkResult {
  success: boolean;
  link?: LinkedAddress;
  error?: string;
}

interface DbLinkedAddress {
  id: string;
  primary_address: string;
  linked_address: string;
  link_type: 'manual' | 'smart_account' | 'passkey' | 'wallet';
  user_id: string | null;
  created_at: Date;
}

// ============================================================================
// Database Helpers
// ============================================================================

function dbToLinkedAddress(db: DbLinkedAddress): LinkedAddress {
  return {
    id: db.id,
    primaryAddress: db.primary_address,
    linkedAddress: db.linked_address,
    linkType: db.link_type,
    userId: db.user_id ?? undefined,
    createdAt: db.created_at,
  };
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Link an address to a primary address for shared identity.
 *
 * Requirements:
 * - Primary address must have a JuicyID
 * - Linked address must not already be linked
 * - Linked address must not be a primary for other links
 * - No self-links
 * - If linked address has its own identity, it must be deleted first
 */
export async function linkAddress(
  primaryAddress: string,
  linkedAddress: string,
  linkType: 'manual' | 'smart_account' | 'passkey' | 'wallet' = 'manual',
  performedBy?: string,
  userId?: string
): Promise<LinkResult> {
  const primaryLower = primaryAddress.toLowerCase();
  const linkedLower = linkedAddress.toLowerCase();

  // Validation: Can't link to self
  if (primaryLower === linkedLower) {
    return { success: false, error: 'Cannot link an address to itself' };
  }

  // Validation: Primary must have an identity
  const primaryIdentity = await getIdentityByAddress(primaryAddress);
  if (!primaryIdentity) {
    return { success: false, error: 'Primary address must have a JuicyID before linking' };
  }

  // Validation: Linked address must not already be linked to another primary
  const existingLink = await queryOne<DbLinkedAddress>(
    `SELECT * FROM linked_addresses WHERE LOWER(linked_address) = LOWER($1)`,
    [linkedAddress]
  );
  if (existingLink) {
    return { success: false, error: 'Address is already linked to another account' };
  }

  // Validation: Linked address must not be a primary for other links
  const isExistingPrimary = await queryOne<{ id: string }>(
    `SELECT id FROM linked_addresses WHERE LOWER(primary_address) = LOWER($1) LIMIT 1`,
    [linkedAddress]
  );
  if (isExistingPrimary) {
    return { success: false, error: 'Address is a primary for other linked addresses' };
  }

  // Validation: Primary can't be someone else's linked address (prevent circular)
  const primaryIsLinked = await queryOne<DbLinkedAddress>(
    `SELECT * FROM linked_addresses WHERE LOWER(linked_address) = LOWER($1)`,
    [primaryAddress]
  );
  if (primaryIsLinked) {
    return { success: false, error: 'Primary address is already linked to another account' };
  }

  // Validation: If linked address has its own identity, require it to be deleted first
  const linkedIdentity = await getIdentityByAddress(linkedAddress);
  if (linkedIdentity) {
    return {
      success: false,
      error: 'Linked address already has a JuicyID. Must delete it before linking.',
    };
  }

  // Create the link and record history in a transaction
  try {
    const link = await transaction(async (client) => {
      // Insert the link
      const result = await client.queryObject<DbLinkedAddress>(
        `INSERT INTO linked_addresses (primary_address, linked_address, link_type, user_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [primaryAddress, linkedAddress, linkType, userId ?? null]
      );

      if (!result.rows[0]) {
        throw new Error('Failed to create link');
      }

      // Record in history
      await client.queryObject(
        `INSERT INTO linked_address_history (primary_address, linked_address, link_type, action, performed_by_address)
         VALUES ($1, $2, $3, 'linked', $4)`,
        [primaryAddress, linkedAddress, linkType, performedBy ?? primaryAddress]
      );

      return result.rows[0];
    });

    return { success: true, link: dbToLinkedAddress(link) };
  } catch (error) {
    // Handle unique constraint violation (race condition)
    if (error instanceof Error && error.message.includes('unique')) {
      return { success: false, error: 'Address is already linked to another account' };
    }
    throw error;
  }
}

/**
 * Get the primary address for a linked address.
 * Returns null if the address is not linked (is either a primary or unlinked).
 */
export async function getPrimaryAddress(address: string): Promise<string | null> {
  const link = await queryOne<DbLinkedAddress>(
    `SELECT * FROM linked_addresses WHERE LOWER(linked_address) = LOWER($1)`,
    [address]
  );
  return link?.primary_address ?? null;
}

/**
 * Get all addresses linked to a primary address.
 */
export async function getLinkedAddresses(primaryAddress: string): Promise<LinkedAddress[]> {
  const links = await query<DbLinkedAddress>(
    `SELECT * FROM linked_addresses WHERE LOWER(primary_address) = LOWER($1) ORDER BY created_at ASC`,
    [primaryAddress]
  );
  return links.map(dbToLinkedAddress);
}

/**
 * Unlink an address from its primary.
 * Can only be performed by the primary address owner or the linked address owner.
 */
export async function unlinkAddress(linkedAddress: string, performedBy: string): Promise<boolean> {
  const link = await queryOne<DbLinkedAddress>(
    `SELECT * FROM linked_addresses WHERE LOWER(linked_address) = LOWER($1)`,
    [linkedAddress]
  );

  if (!link) {
    return false;
  }

  // Authorization: Only primary or linked address can unlink
  const performedByLower = performedBy.toLowerCase();
  if (
    performedByLower !== link.primary_address.toLowerCase() &&
    performedByLower !== link.linked_address.toLowerCase()
  ) {
    return false;
  }

  // Delete and record history in transaction
  await transaction(async (client) => {
    // Record in history first
    await client.queryObject(
      `INSERT INTO linked_address_history (primary_address, linked_address, link_type, action, performed_by_address)
       VALUES ($1, $2, $3, 'unlinked', $4)`,
      [link.primary_address, link.linked_address, link.link_type, performedBy]
    );

    // Delete the link
    await client.queryObject(
      `DELETE FROM linked_addresses WHERE id = $1`,
      [link.id]
    );
  });

  return true;
}

/**
 * Resolve an address to the identity-owning address.
 * If the address is linked, returns the primary address.
 * Otherwise, returns the original address.
 */
export async function resolveIdentityAddress(address: string): Promise<string> {
  const primary = await getPrimaryAddress(address);
  return primary || address;
}

/**
 * Check if an address can be linked (not already linked or a primary).
 */
export async function canBeLinkTarget(address: string): Promise<{
  canLink: boolean;
  reason?: string;
}> {
  // Check if already linked
  const existingLink = await queryOne<DbLinkedAddress>(
    `SELECT * FROM linked_addresses WHERE LOWER(linked_address) = LOWER($1)`,
    [address]
  );
  if (existingLink) {
    return { canLink: false, reason: 'Already linked to another account' };
  }

  // Check if this is a primary for other links
  const isPrimary = await queryOne<{ id: string }>(
    `SELECT id FROM linked_addresses WHERE LOWER(primary_address) = LOWER($1) LIMIT 1`,
    [address]
  );
  if (isPrimary) {
    return { canLink: false, reason: 'This address has linked accounts' };
  }

  // Check if has its own identity
  const identity = await getIdentityByAddress(address);
  if (identity) {
    return { canLink: false, reason: 'Has existing JuicyID - must delete to link' };
  }

  return { canLink: true };
}

/**
 * Check if an address can be a primary (has identity, not linked to someone else).
 */
export async function canBePrimary(address: string): Promise<{
  canBePrimary: boolean;
  reason?: string;
}> {
  // Must have an identity
  const identity = await getIdentityByAddress(address);
  if (!identity) {
    return { canBePrimary: false, reason: 'Must have a JuicyID to be primary' };
  }

  // Can't be linked to someone else
  const isLinked = await queryOne<DbLinkedAddress>(
    `SELECT * FROM linked_addresses WHERE LOWER(linked_address) = LOWER($1)`,
    [address]
  );
  if (isLinked) {
    return { canBePrimary: false, reason: 'Already linked to another account' };
  }

  return { canBePrimary: true };
}

/**
 * Get the link history for an address (either as primary or linked).
 */
export async function getLinkHistory(address: string): Promise<
  Array<{
    id: string;
    primaryAddress: string;
    linkedAddress: string;
    linkType: string;
    action: 'linked' | 'unlinked';
    performedAt: Date;
    performedBy: string;
  }>
> {
  const history = await query<{
    id: string;
    primary_address: string;
    linked_address: string;
    link_type: string;
    action: 'linked' | 'unlinked';
    performed_at: Date;
    performed_by_address: string;
  }>(
    `SELECT * FROM linked_address_history
     WHERE LOWER(primary_address) = LOWER($1) OR LOWER(linked_address) = LOWER($1)
     ORDER BY performed_at DESC`,
    [address]
  );

  return history.map((h) => ({
    id: h.id,
    primaryAddress: h.primary_address,
    linkedAddress: h.linked_address,
    linkType: h.link_type,
    action: h.action,
    performedAt: h.performed_at,
    performedBy: h.performed_by_address,
  }));
}

/**
 * Get all linked addresses for a user (both primary and linked).
 * Useful for showing "Your linked accounts" in the UI.
 */
export async function getAllUserAddresses(address: string): Promise<{
  primaryAddress: string;
  linkedAddresses: LinkedAddress[];
}> {
  // First check if this address is linked to someone else
  const primary = await getPrimaryAddress(address);

  if (primary) {
    // This address is linked, get all addresses from the primary
    const linked = await getLinkedAddresses(primary);
    return { primaryAddress: primary, linkedAddresses: linked };
  }

  // This address is either a primary or standalone
  const linked = await getLinkedAddresses(address);
  return { primaryAddress: address, linkedAddresses: linked };
}
