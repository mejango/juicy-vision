import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore, type Chat, type ChatMessage, type ChatMember, type ChatFolder } from './chatStore'

// Helper to create a mock chat
function createMockChat(overrides: Partial<Chat> = {}): Chat {
  const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    id,
    founderAddress: '0x123',
    name: 'Test Chat',
    isPublic: true,
    aiBalanceWei: '0',
    aiTotalSpentWei: '0',
    encrypted: false,
    encryptionVersion: 1,
    isPinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// Helper to create a mock message
function createMockMessage(chatId: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    chatId,
    senderAddress: '0x123',
    role: 'user',
    content: 'Test message',
    isEncrypted: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// Helper to create a mock member
function createMockMember(overrides: Partial<ChatMember> = {}): ChatMember {
  return {
    address: `0x${Math.random().toString(16).slice(2, 42)}`,
    role: 'member',
    joinedAt: new Date().toISOString(),
    ...overrides,
  }
}

// Helper to create a mock folder
function createMockFolder(overrides: Partial<ChatFolder> = {}): ChatFolder {
  return {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    userAddress: '0x123',
    name: 'Test Folder',
    isPinned: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('chatStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useChatStore.setState({
      chats: [],
      folders: [],
      activeChatId: null,
      isLoading: false,
      isConnected: false,
      error: null,
    })
    localStorage.clear()
  })

  describe('initial state', () => {
    it('starts with empty chats array', () => {
      const { chats } = useChatStore.getState()
      expect(chats).toEqual([])
    })

    it('starts with no active chat', () => {
      const { activeChatId } = useChatStore.getState()
      expect(activeChatId).toBeNull()
    })

    it('starts not loading', () => {
      const { isLoading } = useChatStore.getState()
      expect(isLoading).toBe(false)
    })

    it('starts not connected', () => {
      const { isConnected } = useChatStore.getState()
      expect(isConnected).toBe(false)
    })

    it('starts with no error', () => {
      const { error } = useChatStore.getState()
      expect(error).toBeNull()
    })
  })

  describe('setChats', () => {
    it('sets chats array', () => {
      const chat1 = createMockChat({ name: 'Chat 1' })
      const chat2 = createMockChat({ name: 'Chat 2' })

      useChatStore.getState().setChats([chat1, chat2])

      const { chats } = useChatStore.getState()
      expect(chats).toHaveLength(2)
      expect(chats[0].name).toBe('Chat 1')
      expect(chats[1].name).toBe('Chat 2')
    })

    it('replaces existing chats', () => {
      const oldChat = createMockChat({ name: 'Old Chat' })
      const newChat = createMockChat({ name: 'New Chat' })

      useChatStore.getState().setChats([oldChat])
      useChatStore.getState().setChats([newChat])

      const { chats } = useChatStore.getState()
      expect(chats).toHaveLength(1)
      expect(chats[0].name).toBe('New Chat')
    })
  })

  describe('addChat', () => {
    it('adds a new chat', () => {
      const chat = createMockChat()

      useChatStore.getState().addChat(chat)

      const { chats } = useChatStore.getState()
      expect(chats).toHaveLength(1)
      expect(chats[0].id).toBe(chat.id)
    })

    it('adds new chat at the beginning', () => {
      const chat1 = createMockChat({ name: 'Chat 1' })
      const chat2 = createMockChat({ name: 'Chat 2' })

      useChatStore.getState().addChat(chat1)
      useChatStore.getState().addChat(chat2)

      const { chats } = useChatStore.getState()
      expect(chats[0].name).toBe('Chat 2')
      expect(chats[1].name).toBe('Chat 1')
    })

    it('deduplicates by id', () => {
      const chat = createMockChat({ name: 'Original' })
      const updated = { ...chat, name: 'Updated' }

      useChatStore.getState().addChat(chat)
      useChatStore.getState().addChat(updated)

      const { chats } = useChatStore.getState()
      expect(chats).toHaveLength(1)
      expect(chats[0].name).toBe('Updated')
    })
  })

  describe('updateChat', () => {
    it('updates chat properties', () => {
      const chat = createMockChat({ name: 'Original', isPublic: true })
      useChatStore.getState().setChats([chat])

      useChatStore.getState().updateChat(chat.id, { name: 'Updated', isPublic: false })

      const { chats } = useChatStore.getState()
      expect(chats[0].name).toBe('Updated')
      expect(chats[0].isPublic).toBe(false)
    })

    it('does not affect other chats', () => {
      const chat1 = createMockChat({ name: 'Chat 1' })
      const chat2 = createMockChat({ name: 'Chat 2' })
      useChatStore.getState().setChats([chat1, chat2])

      useChatStore.getState().updateChat(chat1.id, { name: 'Updated' })

      const { chats } = useChatStore.getState()
      expect(chats[1].name).toBe('Chat 2')
    })

    it('handles non-existent chat gracefully', () => {
      const chat = createMockChat()
      useChatStore.getState().setChats([chat])

      // Should not throw
      useChatStore.getState().updateChat('non-existent', { name: 'Updated' })

      const { chats } = useChatStore.getState()
      expect(chats[0].name).toBe(chat.name)
    })
  })

  describe('removeChat', () => {
    it('removes chat by id', () => {
      const chat = createMockChat()
      useChatStore.getState().setChats([chat])

      useChatStore.getState().removeChat(chat.id)

      const { chats } = useChatStore.getState()
      expect(chats).toHaveLength(0)
    })

    it('clears activeChatId if removing active chat', () => {
      const chat = createMockChat()
      useChatStore.getState().setChats([chat])
      useChatStore.getState().setActiveChat(chat.id)

      useChatStore.getState().removeChat(chat.id)

      const { activeChatId } = useChatStore.getState()
      expect(activeChatId).toBeNull()
    })

    it('does not clear activeChatId when removing different chat', () => {
      const chat1 = createMockChat()
      const chat2 = createMockChat()
      useChatStore.getState().setChats([chat1, chat2])
      useChatStore.getState().setActiveChat(chat1.id)

      useChatStore.getState().removeChat(chat2.id)

      const { activeChatId } = useChatStore.getState()
      expect(activeChatId).toBe(chat1.id)
    })
  })

  describe('setActiveChat / getActiveChat', () => {
    it('sets and gets active chat', () => {
      const chat = createMockChat()
      useChatStore.getState().setChats([chat])

      useChatStore.getState().setActiveChat(chat.id)

      expect(useChatStore.getState().activeChatId).toBe(chat.id)
      expect(useChatStore.getState().getActiveChat()).toEqual(chat)
    })

    it('returns undefined if no active chat', () => {
      const activeChat = useChatStore.getState().getActiveChat()
      expect(activeChat).toBeUndefined()
    })

    it('can clear active chat', () => {
      const chat = createMockChat()
      useChatStore.getState().setChats([chat])
      useChatStore.getState().setActiveChat(chat.id)

      useChatStore.getState().setActiveChat(null)

      expect(useChatStore.getState().activeChatId).toBeNull()
    })
  })

  describe('messages', () => {
    describe('addMessage', () => {
      it('adds message to chat', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const message = createMockMessage(chat.id)
        useChatStore.getState().addMessage(chat.id, message)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages).toHaveLength(1)
        expect(updatedChat?.messages?.[0].id).toBe(message.id)
      })

      it('avoids duplicate messages', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const message = createMockMessage(chat.id)
        useChatStore.getState().addMessage(chat.id, message)
        useChatStore.getState().addMessage(chat.id, message)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages).toHaveLength(1)
      })

      it('preserves message order', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const msg1 = createMockMessage(chat.id, { content: 'First' })
        const msg2 = createMockMessage(chat.id, { content: 'Second' })

        useChatStore.getState().addMessage(chat.id, msg1)
        useChatStore.getState().addMessage(chat.id, msg2)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages?.[0].content).toBe('First')
        expect(updatedChat?.messages?.[1].content).toBe('Second')
      })
    })

    describe('updateMessage', () => {
      it('updates message content', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const message = createMockMessage(chat.id, { content: 'Original' })
        useChatStore.getState().addMessage(chat.id, message)
        useChatStore.getState().updateMessage(chat.id, message.id, { content: 'Updated' })

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages?.[0].content).toBe('Updated')
      })
    })

    describe('setMessages', () => {
      it('replaces all messages', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const oldMsg = createMockMessage(chat.id, { content: 'Old' })
        useChatStore.getState().addMessage(chat.id, oldMsg)

        const newMessages = [
          createMockMessage(chat.id, { content: 'New 1' }),
          createMockMessage(chat.id, { content: 'New 2' }),
        ]
        useChatStore.getState().setMessages(chat.id, newMessages)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.messages).toHaveLength(2)
        expect(updatedChat?.messages?.[0].content).toBe('New 1')
      })
    })
  })

  describe('members', () => {
    describe('setMembers', () => {
      it('sets members for chat', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const members = [
          createMockMember({ role: 'founder' }),
          createMockMember({ role: 'member' }),
        ]
        useChatStore.getState().setMembers(chat.id, members)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(2)
      })
    })

    describe('addMember', () => {
      it('adds member to chat', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const member = createMockMember()
        useChatStore.getState().addMember(chat.id, member)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(1)
      })

      it('avoids duplicate members', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const member = createMockMember()
        useChatStore.getState().addMember(chat.id, member)
        useChatStore.getState().addMember(chat.id, member)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(1)
      })
    })

    describe('removeMember', () => {
      it('removes member from chat', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        const member = createMockMember()
        useChatStore.getState().addMember(chat.id, member)
        useChatStore.getState().removeMember(chat.id, member.address)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.members).toHaveLength(0)
      })
    })
  })

  describe('UI state', () => {
    describe('setLoading', () => {
      it('sets loading state', () => {
        useChatStore.getState().setLoading(true)
        expect(useChatStore.getState().isLoading).toBe(true)

        useChatStore.getState().setLoading(false)
        expect(useChatStore.getState().isLoading).toBe(false)
      })
    })

    describe('setConnected', () => {
      it('sets connected state', () => {
        useChatStore.getState().setConnected(true)
        expect(useChatStore.getState().isConnected).toBe(true)
      })
    })

    describe('setError', () => {
      it('sets and clears error', () => {
        useChatStore.getState().setError('Something went wrong')
        expect(useChatStore.getState().error).toBe('Something went wrong')

        useChatStore.getState().setError(null)
        expect(useChatStore.getState().error).toBeNull()
      })
    })
  })

  describe('unread count', () => {
    describe('incrementUnread', () => {
      it('increments unread count', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        useChatStore.getState().incrementUnread(chat.id)
        useChatStore.getState().incrementUnread(chat.id)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.unreadCount).toBe(2)
      })

      it('starts from 0 if undefined', () => {
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        useChatStore.getState().incrementUnread(chat.id)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.unreadCount).toBe(1)
      })
    })

    describe('clearUnread', () => {
      it('clears unread count', () => {
        const chat = createMockChat({ unreadCount: 5 })
        useChatStore.getState().setChats([chat])

        useChatStore.getState().clearUnread(chat.id)

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.unreadCount).toBe(0)
      })
    })
  })

  describe('folders', () => {
    describe('setFolders', () => {
      it('sets folders array', () => {
        const folder1 = createMockFolder({ name: 'Folder 1' })
        const folder2 = createMockFolder({ name: 'Folder 2' })

        useChatStore.getState().setFolders([folder1, folder2])

        const { folders } = useChatStore.getState()
        expect(folders).toHaveLength(2)
        expect(folders[0].name).toBe('Folder 1')
        expect(folders[1].name).toBe('Folder 2')
      })

      it('replaces existing folders', () => {
        const oldFolder = createMockFolder({ name: 'Old Folder' })
        const newFolder = createMockFolder({ name: 'New Folder' })

        useChatStore.getState().setFolders([oldFolder])
        useChatStore.getState().setFolders([newFolder])

        const { folders } = useChatStore.getState()
        expect(folders).toHaveLength(1)
        expect(folders[0].name).toBe('New Folder')
      })
    })

    describe('addFolder', () => {
      it('adds a new folder', () => {
        const folder = createMockFolder()

        useChatStore.getState().addFolder(folder)

        const { folders } = useChatStore.getState()
        expect(folders).toHaveLength(1)
        expect(folders[0].id).toBe(folder.id)
      })

      it('adds new folder at the beginning', () => {
        const folder1 = createMockFolder({ name: 'Folder 1' })
        const folder2 = createMockFolder({ name: 'Folder 2' })

        useChatStore.getState().addFolder(folder1)
        useChatStore.getState().addFolder(folder2)

        const { folders } = useChatStore.getState()
        expect(folders[0].name).toBe('Folder 2')
        expect(folders[1].name).toBe('Folder 1')
      })

      it('deduplicates by id', () => {
        const folder = createMockFolder({ name: 'Original' })
        const updated = { ...folder, name: 'Updated' }

        useChatStore.getState().addFolder(folder)
        useChatStore.getState().addFolder(updated)

        const { folders } = useChatStore.getState()
        expect(folders).toHaveLength(1)
        expect(folders[0].name).toBe('Updated')
      })
    })

    describe('updateFolder', () => {
      it('updates folder properties', () => {
        const folder = createMockFolder({ name: 'Original', isPinned: false })
        useChatStore.getState().setFolders([folder])

        useChatStore.getState().updateFolder(folder.id, { name: 'Updated', isPinned: true })

        const { folders } = useChatStore.getState()
        expect(folders[0].name).toBe('Updated')
        expect(folders[0].isPinned).toBe(true)
      })

      it('does not affect other folders', () => {
        const folder1 = createMockFolder({ name: 'Folder 1' })
        const folder2 = createMockFolder({ name: 'Folder 2' })
        useChatStore.getState().setFolders([folder1, folder2])

        useChatStore.getState().updateFolder(folder1.id, { name: 'Updated' })

        const { folders } = useChatStore.getState()
        expect(folders[1].name).toBe('Folder 2')
      })

      it('handles non-existent folder gracefully', () => {
        const folder = createMockFolder()
        useChatStore.getState().setFolders([folder])

        // Should not throw
        useChatStore.getState().updateFolder('non-existent', { name: 'Updated' })

        const { folders } = useChatStore.getState()
        expect(folders[0].name).toBe(folder.name)
      })
    })

    describe('removeFolder', () => {
      it('removes folder by id', () => {
        const folder = createMockFolder()
        useChatStore.getState().setFolders([folder])

        useChatStore.getState().removeFolder(folder.id)

        const { folders } = useChatStore.getState()
        expect(folders).toHaveLength(0)
      })

      it('does not affect other folders', () => {
        const folder1 = createMockFolder({ name: 'Folder 1' })
        const folder2 = createMockFolder({ name: 'Folder 2' })
        useChatStore.getState().setFolders([folder1, folder2])

        useChatStore.getState().removeFolder(folder1.id)

        const { folders } = useChatStore.getState()
        expect(folders).toHaveLength(1)
        expect(folders[0].name).toBe('Folder 2')
      })
    })

    describe('getPinnedFolders', () => {
      it('returns only pinned folders', () => {
        const pinnedFolder = createMockFolder({ name: 'Pinned', isPinned: true })
        const unpinnedFolder = createMockFolder({ name: 'Unpinned', isPinned: false })
        useChatStore.getState().setFolders([pinnedFolder, unpinnedFolder])

        const pinned = useChatStore.getState().getPinnedFolders()

        expect(pinned).toHaveLength(1)
        expect(pinned[0].name).toBe('Pinned')
      })

      it('sorts by pinOrder', () => {
        const folder1 = createMockFolder({ name: 'Third', isPinned: true, pinOrder: 3 })
        const folder2 = createMockFolder({ name: 'First', isPinned: true, pinOrder: 1 })
        const folder3 = createMockFolder({ name: 'Second', isPinned: true, pinOrder: 2 })
        useChatStore.getState().setFolders([folder1, folder2, folder3])

        const pinned = useChatStore.getState().getPinnedFolders()

        expect(pinned[0].name).toBe('First')
        expect(pinned[1].name).toBe('Second')
        expect(pinned[2].name).toBe('Third')
      })

      it('puts folders without pinOrder at the end', () => {
        const folder1 = createMockFolder({ name: 'No Order', isPinned: true })
        const folder2 = createMockFolder({ name: 'Has Order', isPinned: true, pinOrder: 1 })
        useChatStore.getState().setFolders([folder1, folder2])

        const pinned = useChatStore.getState().getPinnedFolders()

        expect(pinned[0].name).toBe('Has Order')
        expect(pinned[1].name).toBe('No Order')
      })
    })

    describe('getSubfolders', () => {
      it('returns subfolders of a parent folder', () => {
        const parentFolder = createMockFolder({ name: 'Parent' })
        const childFolder = createMockFolder({ name: 'Child', parentFolderId: parentFolder.id })
        const otherFolder = createMockFolder({ name: 'Other' })
        useChatStore.getState().setFolders([parentFolder, childFolder, otherFolder])

        const subfolders = useChatStore.getState().getSubfolders(parentFolder.id)

        expect(subfolders).toHaveLength(1)
        expect(subfolders[0].name).toBe('Child')
      })

      it('returns root folders when parentFolderId is undefined', () => {
        const rootFolder = createMockFolder({ name: 'Root' }) // no parentFolderId = undefined
        const childFolder = createMockFolder({ name: 'Child', parentFolderId: 'some-parent' })
        useChatStore.getState().setFolders([rootFolder, childFolder])

        // Use undefined to match folders without parentFolderId
        const rootFolders = useChatStore.getState().getSubfolders(undefined as unknown as string | null)

        expect(rootFolders).toHaveLength(1)
        expect(rootFolders[0].name).toBe('Root')
      })

      it('sorts pinned folders first', () => {
        const parent = createMockFolder({ name: 'Parent' })
        const unpinned = createMockFolder({ name: 'Unpinned', parentFolderId: parent.id, isPinned: false })
        const pinned = createMockFolder({ name: 'Pinned', parentFolderId: parent.id, isPinned: true })
        useChatStore.getState().setFolders([parent, unpinned, pinned])

        const subfolders = useChatStore.getState().getSubfolders(parent.id)

        expect(subfolders[0].name).toBe('Pinned')
        expect(subfolders[1].name).toBe('Unpinned')
      })

      it('sorts non-pinned folders by name', () => {
        const parent = createMockFolder({ name: 'Parent' })
        const folderB = createMockFolder({ name: 'BBB', parentFolderId: parent.id })
        const folderA = createMockFolder({ name: 'AAA', parentFolderId: parent.id })
        const folderC = createMockFolder({ name: 'CCC', parentFolderId: parent.id })
        useChatStore.getState().setFolders([parent, folderB, folderA, folderC])

        const subfolders = useChatStore.getState().getSubfolders(parent.id)

        expect(subfolders[0].name).toBe('AAA')
        expect(subfolders[1].name).toBe('BBB')
        expect(subfolders[2].name).toBe('CCC')
      })
    })
  })

  describe('chat organization', () => {
    describe('getPinnedChats', () => {
      it('returns only pinned chats', () => {
        const pinnedChat = createMockChat({ name: 'Pinned', isPinned: true })
        const unpinnedChat = createMockChat({ name: 'Unpinned', isPinned: false })
        useChatStore.getState().setChats([pinnedChat, unpinnedChat])

        const pinned = useChatStore.getState().getPinnedChats()

        expect(pinned).toHaveLength(1)
        expect(pinned[0].name).toBe('Pinned')
      })

      it('sorts by pinOrder', () => {
        const chat1 = createMockChat({ name: 'Third', isPinned: true, pinOrder: 3 })
        const chat2 = createMockChat({ name: 'First', isPinned: true, pinOrder: 1 })
        const chat3 = createMockChat({ name: 'Second', isPinned: true, pinOrder: 2 })
        useChatStore.getState().setChats([chat1, chat2, chat3])

        const pinned = useChatStore.getState().getPinnedChats()

        expect(pinned[0].name).toBe('First')
        expect(pinned[1].name).toBe('Second')
        expect(pinned[2].name).toBe('Third')
      })

      it('puts chats without pinOrder at the end', () => {
        const chat1 = createMockChat({ name: 'No Order', isPinned: true })
        const chat2 = createMockChat({ name: 'Has Order', isPinned: true, pinOrder: 1 })
        useChatStore.getState().setChats([chat1, chat2])

        const pinned = useChatStore.getState().getPinnedChats()

        expect(pinned[0].name).toBe('Has Order')
        expect(pinned[1].name).toBe('No Order')
      })
    })

    describe('getChatsInFolder', () => {
      it('returns chats in a specific folder', () => {
        const folderId = 'folder-123'
        const chatInFolder = createMockChat({ name: 'In Folder', folderId })
        const chatOutside = createMockChat({ name: 'Outside' })
        useChatStore.getState().setChats([chatInFolder, chatOutside])

        const folderChats = useChatStore.getState().getChatsInFolder(folderId)

        expect(folderChats).toHaveLength(1)
        expect(folderChats[0].name).toBe('In Folder')
      })

      it('returns chats without folder when folderId is undefined', () => {
        const chatNoFolder = createMockChat({ name: 'No Folder' }) // no folderId = undefined
        const chatInFolder = createMockChat({ name: 'In Folder', folderId: 'some-folder' })
        useChatStore.getState().setChats([chatNoFolder, chatInFolder])

        // Use undefined to match chats without folderId
        const rootChats = useChatStore.getState().getChatsInFolder(undefined as unknown as string | null)

        expect(rootChats).toHaveLength(1)
        expect(rootChats[0].name).toBe('No Folder')
      })

      it('sorts pinned chats first', () => {
        const folderId = 'folder-123'
        const unpinned = createMockChat({ name: 'Unpinned', folderId, isPinned: false })
        const pinned = createMockChat({ name: 'Pinned', folderId, isPinned: true })
        useChatStore.getState().setChats([unpinned, pinned])

        const folderChats = useChatStore.getState().getChatsInFolder(folderId)

        expect(folderChats[0].name).toBe('Pinned')
        expect(folderChats[1].name).toBe('Unpinned')
      })

      it('sorts non-pinned chats by updatedAt descending', () => {
        const folderId = 'folder-123'
        const older = createMockChat({
          name: 'Older',
          folderId,
          updatedAt: '2024-01-01T00:00:00Z'
        })
        const newer = createMockChat({
          name: 'Newer',
          folderId,
          updatedAt: '2024-01-15T00:00:00Z'
        })
        useChatStore.getState().setChats([older, newer])

        const folderChats = useChatStore.getState().getChatsInFolder(folderId)

        expect(folderChats[0].name).toBe('Newer')
        expect(folderChats[1].name).toBe('Older')
      })

      it('sorts pinned chats by pinOrder', () => {
        const folderId = 'folder-123'
        const pinned1 = createMockChat({ name: 'Third', folderId, isPinned: true, pinOrder: 3 })
        const pinned2 = createMockChat({ name: 'First', folderId, isPinned: true, pinOrder: 1 })
        useChatStore.getState().setChats([pinned1, pinned2])

        const folderChats = useChatStore.getState().getChatsInFolder(folderId)

        expect(folderChats[0].name).toBe('First')
        expect(folderChats[1].name).toBe('Third')
      })
    })

    describe('getRecentChats', () => {
      it('returns all chats', () => {
        const chat1 = createMockChat({ name: 'Chat 1' })
        const chat2 = createMockChat({ name: 'Chat 2' })
        useChatStore.getState().setChats([chat1, chat2])

        const recent = useChatStore.getState().getRecentChats()

        expect(recent).toHaveLength(2)
      })

      it('sorts pinned chats first', () => {
        const unpinned = createMockChat({
          name: 'Unpinned',
          isPinned: false,
          updatedAt: '2024-01-20T00:00:00Z' // newer
        })
        const pinned = createMockChat({
          name: 'Pinned',
          isPinned: true,
          updatedAt: '2024-01-01T00:00:00Z' // older
        })
        useChatStore.getState().setChats([unpinned, pinned])

        const recent = useChatStore.getState().getRecentChats()

        // Pinned comes first despite being older
        expect(recent[0].name).toBe('Pinned')
        expect(recent[1].name).toBe('Unpinned')
      })

      it('sorts non-pinned by updatedAt descending', () => {
        const older = createMockChat({
          name: 'Older',
          updatedAt: '2024-01-01T00:00:00Z'
        })
        const newer = createMockChat({
          name: 'Newer',
          updatedAt: '2024-01-15T00:00:00Z'
        })
        const newest = createMockChat({
          name: 'Newest',
          updatedAt: '2024-01-20T00:00:00Z'
        })
        useChatStore.getState().setChats([older, newer, newest])

        const recent = useChatStore.getState().getRecentChats()

        expect(recent[0].name).toBe('Newest')
        expect(recent[1].name).toBe('Newer')
        expect(recent[2].name).toBe('Older')
      })

      it('sorts pinned chats by pinOrder', () => {
        const pinned1 = createMockChat({ name: 'Third', isPinned: true, pinOrder: 3 })
        const pinned2 = createMockChat({ name: 'First', isPinned: true, pinOrder: 1 })
        const pinned3 = createMockChat({ name: 'Second', isPinned: true, pinOrder: 2 })
        useChatStore.getState().setChats([pinned1, pinned2, pinned3])

        const recent = useChatStore.getState().getRecentChats()

        expect(recent[0].name).toBe('First')
        expect(recent[1].name).toBe('Second')
        expect(recent[2].name).toBe('Third')
      })

      it('handles mixed pinned and unpinned correctly', () => {
        const unpinned1 = createMockChat({
          name: 'Recent Unpinned',
          isPinned: false,
          updatedAt: '2024-01-20T00:00:00Z'
        })
        const unpinned2 = createMockChat({
          name: 'Old Unpinned',
          isPinned: false,
          updatedAt: '2024-01-01T00:00:00Z'
        })
        const pinned1 = createMockChat({
          name: 'First Pinned',
          isPinned: true,
          pinOrder: 1
        })
        const pinned2 = createMockChat({
          name: 'Second Pinned',
          isPinned: true,
          pinOrder: 2
        })
        useChatStore.getState().setChats([unpinned1, unpinned2, pinned1, pinned2])

        const recent = useChatStore.getState().getRecentChats()

        expect(recent[0].name).toBe('First Pinned')
        expect(recent[1].name).toBe('Second Pinned')
        expect(recent[2].name).toBe('Recent Unpinned')
        expect(recent[3].name).toBe('Old Unpinned')
      })

      it('does not mutate original chats array', () => {
        const chat1 = createMockChat({ name: 'Chat 1' })
        const chat2 = createMockChat({ name: 'Chat 2' })
        useChatStore.getState().setChats([chat1, chat2])

        const originalChats = useChatStore.getState().chats
        const recent = useChatStore.getState().getRecentChats()

        // Mutating returned array should not affect store
        recent.reverse()

        expect(useChatStore.getState().chats).toBe(originalChats)
      })
    })

    describe('chat pinning via updateChat', () => {
      it('pins a chat', () => {
        const chat = createMockChat({ isPinned: false })
        useChatStore.getState().setChats([chat])

        useChatStore.getState().updateChat(chat.id, { isPinned: true, pinOrder: 1 })

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.isPinned).toBe(true)
        expect(updatedChat?.pinOrder).toBe(1)
      })

      it('unpins a chat', () => {
        const chat = createMockChat({ isPinned: true, pinOrder: 1 })
        useChatStore.getState().setChats([chat])

        useChatStore.getState().updateChat(chat.id, { isPinned: false, pinOrder: undefined })

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.isPinned).toBe(false)
      })
    })

    describe('chat folder assignment via updateChat', () => {
      it('moves chat to a folder', () => {
        const folderId = 'folder-123'
        const chat = createMockChat()
        useChatStore.getState().setChats([chat])

        useChatStore.getState().updateChat(chat.id, { folderId })

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.folderId).toBe(folderId)
      })

      it('removes chat from folder', () => {
        const chat = createMockChat({ folderId: 'folder-123' })
        useChatStore.getState().setChats([chat])

        useChatStore.getState().updateChat(chat.id, { folderId: undefined })

        const updatedChat = useChatStore.getState().chats.find(c => c.id === chat.id)
        expect(updatedChat?.folderId).toBeUndefined()
      })
    })
  })
})
