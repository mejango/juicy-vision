/**
 * Debug Dashboard Routes
 *
 * Real-time event streaming for development debugging
 * Shows WebSocket events, API calls, and system events
 */

import { Hono } from 'hono';
import { getStats, getChatConnections } from '../services/websocket.ts';
import { getConfig } from '../utils/config.ts';

export const debugRouter = new Hono();

// ============================================================================
// Event Registry
// ============================================================================

interface DebugEvent {
  id: string;
  timestamp: number;
  type: 'ws_connect' | 'ws_disconnect' | 'ws_message' | 'api_call' | 'db_query' | 'error' | 'system';
  category: 'websocket' | 'api' | 'database' | 'system';
  data: Record<string, unknown>;
}

// Keep last 1000 events in memory
const events: DebugEvent[] = [];
const MAX_EVENTS = 1000;
let eventCounter = 0;

// SSE clients for real-time streaming
const sseClients = new Set<WritableStreamDefaultWriter>();

/**
 * Log a debug event (call this from anywhere in the app)
 */
export function logDebugEvent(
  type: DebugEvent['type'],
  category: DebugEvent['category'],
  data: Record<string, unknown>
): void {
  const config = getConfig();
  if (config.env !== 'development') return;

  const event: DebugEvent = {
    id: `evt_${++eventCounter}`,
    timestamp: Date.now(),
    type,
    category,
    data,
  };

  events.push(event);
  if (events.length > MAX_EVENTS) {
    events.shift();
  }

  // Broadcast to all SSE clients
  const message = `data: ${JSON.stringify(event)}\n\n`;
  for (const writer of sseClients) {
    try {
      writer.write(new TextEncoder().encode(message));
    } catch (err) {
      // Client disconnected
      sseClients.delete(writer);
    }
  }
}

// ============================================================================
// Routes
// ============================================================================

// Check if debug mode is enabled
debugRouter.use('*', async (c, next) => {
  const config = getConfig();
  if (config.env !== 'development') {
    return c.json({ error: 'Debug endpoints only available in development' }, 403);
  }
  return next();
});

// GET /debug - Dashboard HTML
debugRouter.get('/', async (c) => {
  const html = `
<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Juicy Vision - Debug Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            'juice-orange': '#F5A623',
            'juice-cyan': '#5CEBDF',
            'juice-dark': '#1a1a1a',
            'juice-dark-lighter': '#2a2a2a',
          },
          fontFamily: {
            mono: ['JetBrains Mono', 'Menlo', 'monospace'],
          },
        }
      }
    }
  </script>
  <style>
    * { font-family: 'JetBrains Mono', monospace; }
    .event-row:hover { background: rgba(245, 166, 35, 0.08); }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #1a1a1a; }
    ::-webkit-scrollbar-thumb { background: #F5A623; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #d4911f; }
  </style>
</head>
<body class="bg-juice-dark text-white min-h-screen">
  <!-- Orange border wrapper like main app -->
  <div class="min-h-screen border-4 border-juice-orange">
    <!-- Header -->
    <header class="border-b border-juice-orange/20 px-6 py-4">
      <div class="max-w-7xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-4">
          <img src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍊</text></svg>"
               alt="Juicy" class="h-10 w-10" />
          <div>
            <h1 class="text-xl font-semibold text-white">Debug Dashboard</h1>
            <p class="text-sm text-gray-500">Real-time backend events</p>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <div id="connection-status" class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-juice-dark-lighter">
            <span class="w-2 h-2 rounded-full bg-gray-500"></span>
            <span class="text-sm text-gray-400">Connecting...</span>
          </div>
          <button onclick="clearEvents()"
                  class="px-4 py-1.5 text-sm border border-juice-orange/30 text-juice-orange hover:bg-juice-orange/10 transition-colors">
            Clear
          </button>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-6 py-6">
      <!-- Stats Grid -->
      <div class="grid grid-cols-4 gap-4 mb-6">
        <div class="bg-juice-dark-lighter border border-juice-orange/20 p-4">
          <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">WebSocket Connections</p>
          <p id="stat-ws" class="text-2xl font-bold text-juice-orange">-</p>
        </div>
        <div class="bg-juice-dark-lighter border border-juice-orange/20 p-4">
          <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Active Chats</p>
          <p id="stat-chats" class="text-2xl font-bold text-juice-cyan">-</p>
        </div>
        <div class="bg-juice-dark-lighter border border-juice-orange/20 p-4">
          <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Events Received</p>
          <p id="stat-events" class="text-2xl font-bold text-juice-orange">0</p>
        </div>
        <div class="bg-juice-dark-lighter border border-juice-orange/20 p-4">
          <p class="text-xs text-gray-500 uppercase tracking-wide mb-1">Unique Addresses</p>
          <p id="stat-addresses" class="text-2xl font-bold text-juice-cyan">-</p>
        </div>
      </div>

      <!-- Filters -->
      <div class="flex gap-2 mb-4">
        <button onclick="setFilter('all')"
                class="filter-btn px-3 py-1.5 text-sm border border-juice-orange bg-juice-orange/20 text-juice-orange"
                data-filter="all">All</button>
        <button onclick="setFilter('websocket')"
                class="filter-btn px-3 py-1.5 text-sm border border-juice-orange/30 text-gray-400 hover:text-juice-orange hover:border-juice-orange/50 transition-colors"
                data-filter="websocket">WebSocket</button>
        <button onclick="setFilter('api')"
                class="filter-btn px-3 py-1.5 text-sm border border-juice-orange/30 text-gray-400 hover:text-juice-orange hover:border-juice-orange/50 transition-colors"
                data-filter="api">API</button>
        <button onclick="setFilter('database')"
                class="filter-btn px-3 py-1.5 text-sm border border-juice-orange/30 text-gray-400 hover:text-juice-orange hover:border-juice-orange/50 transition-colors"
                data-filter="database">Database</button>
        <button onclick="setFilter('system')"
                class="filter-btn px-3 py-1.5 text-sm border border-juice-orange/30 text-gray-400 hover:text-juice-orange hover:border-juice-orange/50 transition-colors"
                data-filter="system">System</button>
      </div>

      <!-- Events Log -->
      <div class="bg-juice-dark-lighter border border-juice-orange/20">
        <div class="px-4 py-3 border-b border-juice-orange/20 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-white">Events</h2>
          <span id="event-count" class="text-xs text-gray-500">0 events</span>
        </div>
        <div id="events-container" class="max-h-[500px] overflow-y-auto">
          <div id="events-list" class="divide-y divide-juice-orange/10">
            <!-- Events will be inserted here -->
          </div>
          <div id="empty-state" class="py-16 text-center">
            <div class="text-juice-orange/50 text-4xl mb-4">📡</div>
            <p class="text-gray-500">Waiting for events...</p>
            <p class="text-sm text-gray-600 mt-1">Events will appear here in real-time</p>
          </div>
        </div>
      </div>
    </main>
  </div>

  <script>
    let events = [];
    let currentFilter = 'all';
    let eventSource = null;
    let eventCount = 0;

    function connect() {
      eventSource = new EventSource('/api/debug/stream');

      eventSource.onopen = () => {
        document.getElementById('connection-status').innerHTML =
          '<span class="w-2 h-2 rounded-full bg-juice-cyan pulse"></span><span class="text-sm text-juice-cyan">Connected</span>';
      };

      eventSource.onmessage = (e) => {
        const event = JSON.parse(e.data);
        events.unshift(event);
        eventCount++;
        document.getElementById('stat-events').textContent = eventCount;
        renderEvents();
      };

      eventSource.onerror = () => {
        document.getElementById('connection-status').innerHTML =
          '<span class="w-2 h-2 rounded-full bg-red-500"></span><span class="text-sm text-red-400">Disconnected</span>';
        setTimeout(connect, 3000);
      };
    }

    function renderEvents() {
      const filtered = currentFilter === 'all'
        ? events
        : events.filter(e => e.category === currentFilter);

      const list = document.getElementById('events-list');
      const empty = document.getElementById('empty-state');

      if (filtered.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'block';
        return;
      }

      empty.style.display = 'none';
      list.innerHTML = filtered.slice(0, 200).map(e => renderEvent(e)).join('');
      document.getElementById('event-count').textContent = filtered.length + ' events';
    }

    function renderEvent(event) {
      const typeColors = {
        ws_connect: { bg: 'bg-juice-cyan/20', text: 'text-juice-cyan', border: 'border-juice-cyan/30' },
        ws_disconnect: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
        ws_message: { bg: 'bg-juice-orange/20', text: 'text-juice-orange', border: 'border-juice-orange/30' },
        api_call: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
        system: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30' },
      };
      const style = typeColors[event.type] || typeColors.system;
      const time = new Date(event.timestamp).toLocaleTimeString();
      const dataStr = JSON.stringify(event.data);

      return \`
        <div class="event-row px-4 py-3 flex items-start gap-4 cursor-pointer transition-colors" onclick="showDetails('\${event.id}')">
          <span class="text-xs text-gray-600 font-mono mt-0.5 w-20 flex-shrink-0">\${time}</span>
          <span class="px-2 py-0.5 text-xs border \${style.bg} \${style.text} \${style.border}">\${event.type}</span>
          <div class="flex-1 text-sm text-gray-400 truncate font-mono">
            \${dataStr.length > 80 ? dataStr.slice(0, 80) + '...' : dataStr}
          </div>
        </div>
      \`;
    }

    function showDetails(id) {
      const event = events.find(e => e.id === id);
      if (event) {
        console.log('Event details:', event);
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black/70 flex items-center justify-center z-50';
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
        modal.innerHTML = \`
          <div class="bg-juice-dark-lighter border border-juice-orange/30 p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto">
            <div class="flex justify-between items-start mb-4">
              <h3 class="text-juice-orange font-semibold">Event Details</h3>
              <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-white">&times;</button>
            </div>
            <pre class="text-sm text-gray-300 whitespace-pre-wrap font-mono">\${JSON.stringify(event, null, 2)}</pre>
          </div>
        \`;
        document.body.appendChild(modal);
      }
    }

    function setFilter(filter) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        const isActive = btn.dataset.filter === filter;
        btn.className = isActive
          ? 'filter-btn px-3 py-1.5 text-sm border border-juice-orange bg-juice-orange/20 text-juice-orange'
          : 'filter-btn px-3 py-1.5 text-sm border border-juice-orange/30 text-gray-400 hover:text-juice-orange hover:border-juice-orange/50 transition-colors';
      });
      renderEvents();
    }

    function clearEvents() {
      events = [];
      eventCount = 0;
      document.getElementById('stat-events').textContent = '0';
      renderEvents();
    }

    async function fetchStats() {
      try {
        const res = await fetch('/api/debug/stats');
        const data = await res.json();
        if (data.data) {
          document.getElementById('stat-ws').textContent = data.data.totalConnections;
          document.getElementById('stat-chats').textContent = data.data.activeChats;
          document.getElementById('stat-addresses').textContent = data.data.uniqueAddresses;
        }
      } catch (err) {
        console.error('Failed to fetch stats:', err);
      }
    }

    // Initial load
    connect();
    fetchStats();
    setInterval(fetchStats, 5000);
  </script>
</body>
</html>
  `;
  return c.html(html);
});

// GET /debug/stats - Current system stats
debugRouter.get('/stats', async (c) => {
  const stats = getStats();
  return c.json({ success: true, data: stats });
});

// GET /debug/events - Get recent events
debugRouter.get('/events', async (c) => {
  const limit = parseInt(c.req.query('limit') || '100', 10);
  const category = c.req.query('category');

  let filtered = events;
  if (category) {
    filtered = events.filter((e) => e.category === category);
  }

  return c.json({
    success: true,
    data: filtered.slice(-limit).reverse(),
  });
});

// GET /debug/stream - SSE stream of events
debugRouter.get('/stream', async (c) => {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  sseClients.add(writer);

  // Send initial connection event
  const initEvent = `data: ${JSON.stringify({
    id: 'init',
    timestamp: Date.now(),
    type: 'system',
    category: 'system',
    data: { message: 'Connected to debug stream' },
  })}\n\n`;
  writer.write(new TextEncoder().encode(initEvent));

  // Cleanup on disconnect
  c.req.raw.signal.addEventListener('abort', () => {
    sseClients.delete(writer);
    writer.close();
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

// GET /debug/connections - List all WebSocket connections
debugRouter.get('/connections', async (c) => {
  const chatId = c.req.query('chatId');

  if (chatId) {
    const connections = getChatConnections(chatId);
    return c.json({
      success: true,
      data: connections.map((c) => ({
        address: c.address,
        userId: c.userId,
        connectedAt: c.connectedAt,
      })),
    });
  }

  return c.json({ success: true, data: { message: 'Provide chatId to list connections' } });
});
