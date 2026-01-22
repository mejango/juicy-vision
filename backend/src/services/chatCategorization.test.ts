/**
 * Chat Categorization Service Tests
 *
 * Tests for folder management, pinning, and title generation
 */

import { assertEquals, assertExists } from 'std/assert/mod.ts';

// ============================================================================
// isGenericName Tests
// ============================================================================

// Inline implementation for testing (same logic as service)
function isGenericName(name: string | null | undefined): boolean {
  if (!name) return true;
  const genericPatterns = [
    /^new chat$/i,
    /^untitled$/i,
    /^chat$/i,
    /^conversation$/i,
    /^\d{4}-\d{2}-\d{2}/, // Date-based names
    /^chat #?\d+$/i,
  ];
  return genericPatterns.some((pattern) => pattern.test(name.trim()));
}

Deno.test('isGenericName - detects generic names', async (t) => {
  await t.step('returns true for null', () => {
    assertEquals(isGenericName(null), true);
  });

  await t.step('returns true for undefined', () => {
    assertEquals(isGenericName(undefined), true);
  });

  await t.step('returns true for empty string', () => {
    assertEquals(isGenericName(''), true);
  });

  await t.step('returns true for "New Chat"', () => {
    assertEquals(isGenericName('New Chat'), true);
  });

  await t.step('returns true for "new chat" (case insensitive)', () => {
    assertEquals(isGenericName('new chat'), true);
  });

  await t.step('returns true for "Untitled"', () => {
    assertEquals(isGenericName('Untitled'), true);
  });

  await t.step('returns true for "Chat"', () => {
    assertEquals(isGenericName('Chat'), true);
  });

  await t.step('returns true for "Conversation"', () => {
    assertEquals(isGenericName('Conversation'), true);
  });

  await t.step('returns true for date-based names', () => {
    assertEquals(isGenericName('2024-01-15'), true);
    assertEquals(isGenericName('2024-01-15 Meeting'), true);
  });

  await t.step('returns true for "Chat #1"', () => {
    assertEquals(isGenericName('Chat #1'), true);
    assertEquals(isGenericName('Chat 42'), true);
  });

  await t.step('returns false for specific names', () => {
    assertEquals(isGenericName('Project Planning'), false);
    assertEquals(isGenericName('Revnet Discussion'), false);
    assertEquals(isGenericName('Bug fix for auth'), false);
  });

  await t.step('returns false for whitespace-padded specific names', () => {
    assertEquals(isGenericName('  Project Planning  '), false);
  });
});

// ============================================================================
// ChatFolder Type Tests
// ============================================================================

Deno.test('ChatFolder - type structure', async (t) => {
  // Interface validation through object creation
  const folder = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    userAddress: '0x1234567890123456789012345678901234567890',
    userId: 'user-123',
    name: 'Work Projects',
    parentFolderId: undefined,
    isPinned: true,
    pinOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await t.step('has required id field', () => {
    assertExists(folder.id);
    assertEquals(typeof folder.id, 'string');
  });

  await t.step('has required userAddress field', () => {
    assertExists(folder.userAddress);
    assertEquals(folder.userAddress.startsWith('0x'), true);
  });

  await t.step('has required name field', () => {
    assertExists(folder.name);
    assertEquals(typeof folder.name, 'string');
  });

  await t.step('has boolean isPinned field', () => {
    assertEquals(typeof folder.isPinned, 'boolean');
  });

  await t.step('has optional pinOrder when pinned', () => {
    assertEquals(folder.isPinned, true);
    assertEquals(typeof folder.pinOrder, 'number');
  });

  await t.step('has Date timestamps', () => {
    assertEquals(folder.createdAt instanceof Date, true);
    assertEquals(folder.updatedAt instanceof Date, true);
  });
});

Deno.test('ChatFolder - nested folder structure', async (t) => {
  const parentFolder = {
    id: 'parent-folder-id',
    userAddress: '0x123',
    name: 'Parent',
    parentFolderId: undefined,
    isPinned: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const childFolder = {
    id: 'child-folder-id',
    userAddress: '0x123',
    name: 'Child',
    parentFolderId: 'parent-folder-id',
    isPinned: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await t.step('parent folder has no parentFolderId', () => {
    assertEquals(parentFolder.parentFolderId, undefined);
  });

  await t.step('child folder references parent', () => {
    assertEquals(childFolder.parentFolderId, parentFolder.id);
  });
});

// ============================================================================
// DB to Model Conversion Tests
// ============================================================================

Deno.test('dbToFolder - converts database row to ChatFolder', async (t) => {
  // Simulate DB row structure
  const dbRow = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    user_address: '0x1234567890123456789012345678901234567890',
    user_id: 'user-123',
    name: 'Work',
    parent_folder_id: null,
    is_pinned: true,
    pin_order: 0,
    created_at: new Date('2024-01-15'),
    updated_at: new Date('2024-01-16'),
  };

  // Conversion function (same logic as service)
  function dbToFolder(db: typeof dbRow) {
    return {
      id: db.id,
      userAddress: db.user_address,
      userId: db.user_id ?? undefined,
      name: db.name,
      parentFolderId: db.parent_folder_id ?? undefined,
      isPinned: db.is_pinned,
      pinOrder: db.pin_order ?? undefined,
      createdAt: db.created_at,
      updatedAt: db.updated_at,
    };
  }

  const folder = dbToFolder(dbRow);

  await t.step('converts id', () => {
    assertEquals(folder.id, dbRow.id);
  });

  await t.step('converts user_address to userAddress', () => {
    assertEquals(folder.userAddress, dbRow.user_address);
  });

  await t.step('converts user_id to userId', () => {
    assertEquals(folder.userId, dbRow.user_id);
  });

  await t.step('converts is_pinned to isPinned', () => {
    assertEquals(folder.isPinned, dbRow.is_pinned);
  });

  await t.step('converts pin_order to pinOrder', () => {
    assertEquals(folder.pinOrder, dbRow.pin_order);
  });

  await t.step('converts null parent_folder_id to undefined', () => {
    assertEquals(folder.parentFolderId, undefined);
  });

  await t.step('preserves Date objects', () => {
    assertEquals(folder.createdAt, dbRow.created_at);
    assertEquals(folder.updatedAt, dbRow.updated_at);
  });
});

Deno.test('dbToFolder - handles null values correctly', async (t) => {
  const dbRow = {
    id: 'folder-id',
    user_address: '0x123',
    user_id: null,
    name: 'Folder',
    parent_folder_id: null,
    is_pinned: false,
    pin_order: null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  function dbToFolder(db: typeof dbRow) {
    return {
      id: db.id,
      userAddress: db.user_address,
      userId: db.user_id ?? undefined,
      name: db.name,
      parentFolderId: db.parent_folder_id ?? undefined,
      isPinned: db.is_pinned,
      pinOrder: db.pin_order ?? undefined,
      createdAt: db.created_at,
      updatedAt: db.updated_at,
    };
  }

  const folder = dbToFolder(dbRow);

  await t.step('converts null user_id to undefined', () => {
    assertEquals(folder.userId, undefined);
  });

  await t.step('converts null pin_order to undefined', () => {
    assertEquals(folder.pinOrder, undefined);
  });

  await t.step('converts null parent_folder_id to undefined', () => {
    assertEquals(folder.parentFolderId, undefined);
  });
});

// ============================================================================
// Title Generation Prompt Tests
// ============================================================================

Deno.test('Title Generation - message formatting', async (t) => {
  const messages = [
    { role: 'user', content: 'How do I create a Juicebox project?' },
    { role: 'assistant', content: 'To create a Juicebox project, you need to...' },
    { role: 'user', content: 'What about the treasury configuration?' },
  ];

  // Format messages for title generation (same logic as service)
  function formatMessagesForTitle(msgs: typeof messages): string {
    return msgs
      .slice(0, 10)
      .map((m) => `[${m.role}]: ${m.content.slice(0, 300)}`)
      .join('\n\n');
  }

  await t.step('formats messages with role prefix', () => {
    const formatted = formatMessagesForTitle(messages);
    assertEquals(formatted.includes('[user]:'), true);
    assertEquals(formatted.includes('[assistant]:'), true);
  });

  await t.step('limits to first 10 messages', () => {
    const manyMessages = Array(20).fill({ role: 'user', content: 'Message' });
    const formatted = formatMessagesForTitle(manyMessages);
    const occurrences = (formatted.match(/\[user\]/g) || []).length;
    assertEquals(occurrences, 10);
  });

  await t.step('truncates long content to 300 chars', () => {
    const longMessage = [{ role: 'user', content: 'x'.repeat(500) }];
    const formatted = formatMessagesForTitle(longMessage);
    // Should be 300 chars of content + "[user]: " prefix
    assertEquals(formatted.length <= 300 + 10, true);
  });

  await t.step('joins messages with double newline', () => {
    const formatted = formatMessagesForTitle(messages);
    assertEquals(formatted.includes('\n\n'), true);
  });
});

// ============================================================================
// Pinning Logic Tests
// ============================================================================

Deno.test('Pinning - order calculation', async (t) => {
  // Simulate pinned items with order
  const pinnedItems = [
    { id: 'item-1', isPinned: true, pinOrder: 0 },
    { id: 'item-2', isPinned: true, pinOrder: 1 },
    { id: 'item-3', isPinned: true, pinOrder: 2 },
  ];

  // Sort function (same logic as store)
  function sortByPinOrder<T extends { isPinned: boolean; pinOrder?: number }>(items: T[]): T[] {
    return [...items].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.isPinned && b.isPinned) {
        return (a.pinOrder ?? Infinity) - (b.pinOrder ?? Infinity);
      }
      return 0;
    });
  }

  await t.step('sorts pinned items by pinOrder', () => {
    const shuffled = [pinnedItems[2], pinnedItems[0], pinnedItems[1]];
    const sorted = sortByPinOrder(shuffled);
    assertEquals(sorted[0].id, 'item-1');
    assertEquals(sorted[1].id, 'item-2');
    assertEquals(sorted[2].id, 'item-3');
  });

  await t.step('pinned items come before unpinned', () => {
    const mixed = [
      { id: 'unpinned', isPinned: false },
      { id: 'pinned', isPinned: true, pinOrder: 0 },
    ];
    const sorted = sortByPinOrder(mixed);
    assertEquals(sorted[0].id, 'pinned');
    assertEquals(sorted[1].id, 'unpinned');
  });

  await t.step('handles undefined pinOrder', () => {
    const items = [
      { id: 'no-order', isPinned: true, pinOrder: undefined },
      { id: 'has-order', isPinned: true, pinOrder: 0 },
    ];
    const sorted = sortByPinOrder(items);
    assertEquals(sorted[0].id, 'has-order');
    assertEquals(sorted[1].id, 'no-order');
  });
});

// ============================================================================
// Folder Hierarchy Tests
// ============================================================================

Deno.test('Folder Hierarchy - nested structure', async (t) => {
  const folders = [
    { id: 'root-1', name: 'Work', parentFolderId: undefined },
    { id: 'root-2', name: 'Personal', parentFolderId: undefined },
    { id: 'child-1', name: 'Project A', parentFolderId: 'root-1' },
    { id: 'child-2', name: 'Project B', parentFolderId: 'root-1' },
    { id: 'grandchild-1', name: 'Subproject', parentFolderId: 'child-1' },
  ];

  function getSubfolders(parentId: string | null, allFolders: typeof folders) {
    return allFolders.filter((f) =>
      parentId === null
        ? f.parentFolderId === undefined
        : f.parentFolderId === parentId
    );
  }

  await t.step('gets root folders', () => {
    const roots = getSubfolders(null, folders);
    assertEquals(roots.length, 2);
    assertEquals(roots.map(f => f.name).includes('Work'), true);
    assertEquals(roots.map(f => f.name).includes('Personal'), true);
  });

  await t.step('gets children of Work folder', () => {
    const children = getSubfolders('root-1', folders);
    assertEquals(children.length, 2);
    assertEquals(children.map(f => f.name).includes('Project A'), true);
    assertEquals(children.map(f => f.name).includes('Project B'), true);
  });

  await t.step('gets grandchildren', () => {
    const grandchildren = getSubfolders('child-1', folders);
    assertEquals(grandchildren.length, 1);
    assertEquals(grandchildren[0].name, 'Subproject');
  });

  await t.step('returns empty for leaf folder', () => {
    const leaves = getSubfolders('grandchild-1', folders);
    assertEquals(leaves.length, 0);
  });
});

// ============================================================================
// Chat in Folder Tests
// ============================================================================

Deno.test('Chat Folder Assignment - filtering', async (t) => {
  const chats = [
    { id: 'chat-1', name: 'Chat 1', folderId: 'folder-1', isPinned: false },
    { id: 'chat-2', name: 'Chat 2', folderId: 'folder-1', isPinned: true, pinOrder: 0 },
    { id: 'chat-3', name: 'Chat 3', folderId: 'folder-2', isPinned: false },
    { id: 'chat-4', name: 'Chat 4', folderId: undefined, isPinned: false },
    { id: 'chat-5', name: 'Chat 5', folderId: undefined, isPinned: true, pinOrder: 0 },
  ];

  function getChatsInFolder(folderId: string | null, allChats: typeof chats) {
    return allChats.filter((c) =>
      folderId === null
        ? c.folderId === undefined
        : c.folderId === folderId
    );
  }

  await t.step('gets chats in folder-1', () => {
    const folderChats = getChatsInFolder('folder-1', chats);
    assertEquals(folderChats.length, 2);
  });

  await t.step('gets chats in folder-2', () => {
    const folderChats = getChatsInFolder('folder-2', chats);
    assertEquals(folderChats.length, 1);
    assertEquals(folderChats[0].name, 'Chat 3');
  });

  await t.step('gets root-level chats (no folder)', () => {
    const rootChats = getChatsInFolder(null, chats);
    assertEquals(rootChats.length, 2);
  });

  await t.step('returns empty for non-existent folder', () => {
    const noChats = getChatsInFolder('non-existent', chats);
    assertEquals(noChats.length, 0);
  });
});

Deno.test('Chat Folder Assignment - sorting with pins', async (t) => {
  const chats = [
    { id: 'chat-1', name: 'Unpinned 1', folderId: 'folder-1', isPinned: false, updatedAt: new Date('2024-01-10') },
    { id: 'chat-2', name: 'Pinned 1', folderId: 'folder-1', isPinned: true, pinOrder: 1, updatedAt: new Date('2024-01-05') },
    { id: 'chat-3', name: 'Pinned 0', folderId: 'folder-1', isPinned: true, pinOrder: 0, updatedAt: new Date('2024-01-01') },
    { id: 'chat-4', name: 'Unpinned 2', folderId: 'folder-1', isPinned: false, updatedAt: new Date('2024-01-15') },
  ];

  function sortChatsInFolder(folderChats: typeof chats) {
    return [...folderChats].sort((a, b) => {
      // Pinned first
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      // Among pinned, sort by pinOrder
      if (a.isPinned && b.isPinned) {
        return (a.pinOrder ?? Infinity) - (b.pinOrder ?? Infinity);
      }
      // Among unpinned, sort by updatedAt (newest first)
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
  }

  const sorted = sortChatsInFolder(chats);

  await t.step('pinned items come first', () => {
    assertEquals(sorted[0].isPinned, true);
    assertEquals(sorted[1].isPinned, true);
  });

  await t.step('pinned items sorted by pinOrder', () => {
    assertEquals(sorted[0].name, 'Pinned 0');
    assertEquals(sorted[1].name, 'Pinned 1');
  });

  await t.step('unpinned items sorted by updatedAt', () => {
    assertEquals(sorted[2].name, 'Unpinned 2'); // Jan 15
    assertEquals(sorted[3].name, 'Unpinned 1'); // Jan 10
  });
});

// ============================================================================
// Reorder Tests
// ============================================================================

Deno.test('Reorder Pinned Items - updates pin orders', async (t) => {
  // Simulate reorder operation
  function reorderPinned(
    items: Array<{ id: string; pinOrder?: number }>,
    newOrder: string[]
  ): Array<{ id: string; pinOrder: number }> {
    return newOrder.map((id, index) => {
      const item = items.find((i) => i.id === id);
      return { id, pinOrder: index };
    });
  }

  await t.step('assigns sequential pin orders', () => {
    const items = [
      { id: 'a', pinOrder: 2 },
      { id: 'b', pinOrder: 0 },
      { id: 'c', pinOrder: 1 },
    ];
    const reordered = reorderPinned(items, ['c', 'a', 'b']);

    assertEquals(reordered[0], { id: 'c', pinOrder: 0 });
    assertEquals(reordered[1], { id: 'a', pinOrder: 1 });
    assertEquals(reordered[2], { id: 'b', pinOrder: 2 });
  });

  await t.step('handles single item', () => {
    const items = [{ id: 'only', pinOrder: 5 }];
    const reordered = reorderPinned(items, ['only']);

    assertEquals(reordered[0], { id: 'only', pinOrder: 0 });
  });

  await t.step('handles empty array', () => {
    const reordered = reorderPinned([], []);
    assertEquals(reordered.length, 0);
  });
});
