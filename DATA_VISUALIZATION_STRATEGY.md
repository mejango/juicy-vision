# Juicy Bot Data Visualization Strategy

## Executive Summary

This document outlines a strategy for building deep data visualization capabilities into the juicy bot, based on analysis of:
- **Current juicy-vision codebase** - existing infrastructure and patterns
- **revnet-app** - production visualizations for issuance, cash-out, and cross-chain owners
- **juice-interface** - timeline charts and multi-chain balance tracking

---

## 1. Current State Analysis

### What Juicy-Vision Already Has

| Component | Location | Status |
|-----------|----------|--------|
| **PriceChart** | `src/components/dynamic/PriceChart.tsx` | ✅ Working - SVG-based line chart with dual lines |
| **TopProjects** | `src/components/dynamic/TopProjects.tsx` | ✅ Working - ranked list with multi-chain grouping |
| **ActivityFeed** | `src/components/dynamic/ActivityFeed.tsx` | ⚠️ Mock data - needs bendystraw integration |
| **RulesetSchedule** | `src/components/dynamic/RulesetSchedule.tsx` | ⚠️ Mock data - timeline visualization |
| **Bendystraw Client** | `src/services/bendystraw/` | ✅ Comprehensive - 13+ queries ready |

### Bendystraw Queries Already Available

```typescript
// Projects
fetchProject(), fetchProjects(), searchProjects(), fetchProjectWithRuleset()

// Participants/Token Holders
fetchParticipants(), fetchUserTokenBalance(), fetchOwnersCount(), fetchSuckerGroupParticipants()

// Activity
fetchActivityEvents() // discriminated union: pay, cashout, projectCreate, mintTokens, sendPayouts, etc.

// Cross-Chain
fetchConnectedChains(), fetchSuckerGroupBalance(), fetchIssuanceRate()

// Utility
fetchEthPrice()
```

---

## 2. Recommended Charting Library: Recharts

Both revnet-app and juice-interface use **Recharts**. Recommendation: **Adopt Recharts** for consistency and proven patterns.

```bash
npm install recharts
```

### Why Recharts?

1. **React-native** - Components compose naturally with React
2. **Battle-tested** - Both production apps use it successfully
3. **Rich feature set** - Area, Line, Pie, Bar, custom tooltips, responsive containers
4. **Lightweight** - ~165KB minified (vs Chart.js ~180KB, D3 ~240KB)
5. **TypeScript support** - Full type definitions available

### Alternative: Keep SVG-Based Approach

The current PriceChart uses vanilla SVG. This is fine for simple charts but becomes complex for:
- Interactive tooltips with hover states
- Animated transitions
- Complex multi-line charts with legends
- Responsive scaling across devices

**Recommendation:** Migrate to Recharts for new visualizations, optionally refactor PriceChart later.

---

## 3. Visualization Catalog to Implement

### Tier 1: High Value, Can Build Now

| Visualization | Data Source | User Query Example |
|---------------|-------------|-------------------|
| **Issuance Price Over Time** | Rulesets (calculated) | "Show me how the token price changes" |
| **Cash-Out Value Over Time** | Bendystraw moments + tax snapshots | "What's the floor price history?" |
| **Token Holder Distribution** | `fetchParticipants()` | "Who owns the most tokens?" |
| **Balance Over Time** | `SuckerGroupMoments` | "How has the treasury grown?" |
| **Activity Timeline** | `fetchActivityEvents()` | "Show me recent activity" |

### Tier 2: Medium Complexity

| Visualization | Data Source | User Query Example |
|---------------|-------------|-------------------|
| **Owners Across Chains** | `fetchSuckerGroupParticipants()` | "Show ownership by chain" |
| **Volume Over Time** | Pay events aggregated | "How much has been paid in?" |
| **Payout Distribution** | Payout events | "Where do funds go?" |
| **Ruleset Timeline** | Rulesets with stages | "Show the funding cycles" |

### Tier 3: Advanced

| Visualization | Data Source | User Query Example |
|---------------|-------------|-------------------|
| **AMM Pool Price** | Uniswap subgraph | "What's the market price vs floor?" |
| **Comparative Projects** | Multiple project queries | "Compare these two projects" |
| **Protocol-Wide Trends** | Aggregate queries | "What's trending across all projects?" |

---

## 4. Data Architecture Patterns

### Pattern 1: Server-Side Aggregation (From revnet-app)

```typescript
// Heavy computation on server, send clean data to client
"use server"

export async function getTokenPriceChartData({
  projectId,
  chainId,
  range,
}: ChartParams): Promise<ChartData> {
  // 1. Fetch rulesets from blockchain
  const rulesets = await getRulesets(projectId, chainId);

  // 2. Calculate issuance prices at intervals
  const issuanceData = calculateIssuancePriceHistory(rulesets, range);

  // 3. Fetch floor price from Bendystraw
  const floorData = await getFloorPriceHistory(projectId, range);

  // 4. Merge data sources
  return mergeDataPoints(issuanceData, floorData);
}
```

### Pattern 2: React Query with Caching

```typescript
const { data, isLoading } = useQuery({
  queryKey: ['chartData', projectId, chainId, range],
  queryFn: () => fetchChartData({ projectId, chainId, range }),
  placeholderData: keepPreviousData, // Smooth transitions
  staleTime: 5 * 60 * 1000, // 5 minutes
});
```

### Pattern 3: Forward-Fill Sparse Data

```typescript
function forwardFillData(points: DataPoint[]): DataPoint[] {
  let lastKnownValue: number | undefined;

  return points.map(point => {
    if (point.value !== undefined) {
      lastKnownValue = point.value;
      return point;
    }
    return { ...point, value: lastKnownValue };
  });
}
```

### Pattern 4: Cross-Chain Aggregation

```typescript
// Aggregate participants across chains (from revnet-app)
const aggregated = participants.reduce((acc, p) => {
  const existing = acc[p.address] ?? { balance: 0n, chains: [] };
  return {
    ...acc,
    [p.address]: {
      address: p.address,
      balance: existing.balance + BigInt(p.balance),
      chains: [...existing.chains, p.chainId],
    },
  };
}, {});
```

---

## 5. Bendystraw Queries to Add

Based on revnet-app's data needs, add these queries to your bendystraw client:

```graphql
# Cash-Out Tax History (for floor price calculation)
query CashOutTaxSnapshots($suckerGroupId: String!, $after: String) {
  cashOutTaxSnapshots(
    where: { suckerGroupId: $suckerGroupId }
    orderBy: "start"
    orderDirection: "asc"
    limit: 1000
    after: $after
  ) {
    items {
      cashOutTax
      start
      duration
      rulesetId
      suckerGroupId
    }
    pageInfo { hasNextPage, endCursor }
  }
}

# Treasury Balance Snapshots
query SuckerGroupMoments($suckerGroupId: String!, $after: String) {
  suckerGroupMoments(
    where: { suckerGroupId: $suckerGroupId }
    orderBy: "timestamp"
    orderDirection: "asc"
    limit: 1000
    after: $after
  ) {
    items {
      timestamp
      balance
      tokenSupply
      suckerGroupId
    }
    pageInfo { hasNextPage, endCursor }
  }
}
```

---

## 6. Floor Price Calculation Formula

From revnet-app's `getFloorPriceHistory.ts`:

```
y = (o * x / s) * ((1 - r) + (r * x / s))

Where:
- r = cash out tax rate (0 to 1, e.g., 0.05 for 5%)
- o = surplus (treasury balance in wei)
- s = total token supply
- x = tokens to cash out (use 1 token = 1e18 for per-token price)
- y = base tokens returned (floor price per token)
```

TypeScript implementation:

```typescript
function calculateFloorPrice(
  balance: bigint,      // Treasury balance in wei
  totalSupply: bigint,  // Total token supply
  cashOutTaxRate: number // 0-10000 (basis points)
): number {
  if (totalSupply === 0n) return 0;

  const r = cashOutTaxRate / 10000; // Convert to decimal
  const oneToken = 10n ** 18n;

  // y = (o * x / s) * ((1 - r) + (r * x / s))
  const x = Number(oneToken) / 1e18; // 1 token
  const s = Number(totalSupply) / 1e18;
  const o = Number(balance) / 1e18;

  const floorPrice = (o * x / s) * ((1 - r) + (r * x / s));
  return floorPrice;
}
```

---

## 7. Component Architecture

### Reusable Chart Components

```
src/components/charts/
├── ChartContainer.tsx      # Responsive wrapper with loading/error states
├── TimelineChart.tsx       # Generic time-series line/area chart
├── PieChart.tsx            # Token distribution / ownership
├── BarChart.tsx            # Volume comparisons
├── RangeSelector.tsx       # 7d, 30d, 90d, 1y, all buttons
├── ChartTooltip.tsx        # Reusable tooltip with consistent styling
└── hooks/
    ├── useChartData.ts     # Generic data fetching hook
    ├── useTimeRange.ts     # Range selection state
    └── useAxisDomain.ts    # Smart Y-axis scaling
```

### Chart Configuration System (from revnet-app)

```typescript
type ChartConfig = {
  [key: string]: {
    label: string;
    color: string;
  };
};

const priceChartConfig: ChartConfig = {
  issuancePrice: { label: "Issuance Price", color: "var(--juice-orange)" },
  floorPrice: { label: "Floor Price", color: "var(--juice-cyan)" },
  ammPrice: { label: "Market Price", color: "var(--chart-3)" },
};
```

---

## 8. On-Demand Visualization Strategy

### How Claude Should Generate Charts

When a user asks about data, Claude should:

1. **Identify the visualization type** from the query
2. **Determine data requirements** (which bendystraw queries needed)
3. **Select appropriate time range** (default to 30d, ask if unclear)
4. **Render the component** with proper props

### Query Pattern Matching

| User Intent | Visualization | Component |
|-------------|---------------|-----------|
| "price", "cost", "how much" | Price chart | `<price-chart>` |
| "owners", "holders", "who owns" | Pie chart | `<holders-chart>` |
| "balance", "treasury", "funds" | Area chart | `<balance-chart>` |
| "activity", "recent", "what happened" | Timeline | `<activity-feed>` |
| "volume", "payments", "how much paid" | Bar/Line | `<volume-chart>` |
| "compare", "vs", "difference" | Multi-line | `<comparison-chart>` |

### Example System Prompt Addition

```markdown
## Data Visualization Components

When users ask about project data, use the appropriate visualization:

### <balance-chart projectId="X" chainId="Y" range="30d" />
Shows treasury balance over time. Use when user asks about:
- "How much is in the treasury?"
- "Show me the balance history"
- "How has funding grown?"

### <holders-chart projectId="X" chainId="Y" />
Shows token holder distribution as a pie chart. Use when user asks about:
- "Who owns the tokens?"
- "Show me the ownership breakdown"
- "Top token holders?"

### <floor-chart projectId="X" chainId="Y" range="30d" />
Shows floor/cash-out price over time. Use when user asks about:
- "What can I cash out for?"
- "Floor price history"
- "Redemption value over time"
```

---

## 9. Implementation Roadmap

### Phase 1: Foundation (Week 1)

1. Install Recharts
2. Create `ChartContainer` wrapper component
3. Create `RangeSelector` component
4. Add `CashOutTaxSnapshots` and `SuckerGroupMoments` queries to bendystraw

### Phase 2: Core Charts (Week 2)

1. Implement `BalanceChart` - treasury over time
2. Implement `HoldersChart` - pie chart of token distribution
3. Implement `FloorPriceChart` - cash-out value over time
4. Refactor existing `PriceChart` to use Recharts (optional)

### Phase 3: Advanced Features (Week 3)

1. Implement cross-chain aggregation views
2. Add AMM price overlay (requires Uniswap subgraph integration)
3. Create comparison charts for multiple projects
4. Add export capabilities (PNG, CSV)

### Phase 4: AI Integration (Week 4)

1. Update system prompt with new components
2. Add visualization intent detection
3. Test with various user queries
4. Fine-tune default time ranges and formatting

---

## 10. Code Examples

### Basic Timeline Chart with Recharts

```tsx
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';

interface BalanceChartProps {
  data: Array<{ timestamp: number; balance: number }>;
  range: '7d' | '30d' | '90d' | '1y' | 'all';
}

export function BalanceChart({ data, range }: BalanceChartProps) {
  const formatXAxis = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    if (range === '7d') return format(date, 'EEE');
    if (range === '30d') return format(date, 'MMM d');
    return format(date, 'MMM yyyy');
  };

  const formatYAxis = (value: number) => {
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return value.toFixed(2);
  };

  return (
    <div className="w-full h-64">
      <ResponsiveContainer>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F5A623" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#F5A623" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatXAxis}
            stroke="#666"
            fontSize={12}
          />
          <YAxis
            tickFormatter={formatYAxis}
            stroke="#666"
            fontSize={12}
          />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const { timestamp, balance } = payload[0].payload;
              return (
                <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 text-sm">
                  <div className="text-zinc-400">
                    {format(new Date(timestamp * 1000), 'MMM d, yyyy')}
                  </div>
                  <div className="text-white font-mono">
                    {balance.toFixed(4)} ETH
                  </div>
                </div>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="balance"
            stroke="#F5A623"
            fill="url(#balanceGradient)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

### Token Holders Pie Chart

```tsx
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

const COLORS = [
  '#F5A623', '#5CEBDF', '#FF6B6B', '#4ECDC4', '#45B7D1',
  '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
];

interface HoldersChartProps {
  data: Array<{
    address: string;
    balance: bigint;
    percentage: number;
  }>;
}

export function HoldersChart({ data }: HoldersChartProps) {
  const chartData = data.slice(0, 10).map((holder, i) => ({
    name: `${holder.address.slice(0, 6)}...${holder.address.slice(-4)}`,
    value: holder.percentage,
    address: holder.address,
  }));

  return (
    <div className="w-full h-64">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius="50%"
            outerRadius="80%"
            dataKey="value"
            label={({ name, value }) => `${name} (${value.toFixed(1)}%)`}
          >
            {chartData.map((_, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const { name, value, address } = payload[0].payload;
              return (
                <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3">
                  <div className="font-mono text-sm text-white">{address}</div>
                  <div className="text-zinc-400">{value.toFixed(2)}% ownership</div>
                </div>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
```

---

## 11. Key Learnings from Production Apps

### From revnet-app:

1. **Visual scale transformation** - Tiny stages get minimum 12% width to remain visible
2. **Forward-fill sparse data** - Fill gaps with last known values
3. **Server-side aggregation** - Heavy computation on backend, clean data to frontend
4. **Multi-source merging** - Combine blockchain, subgraph, and indexed data elegantly
5. **Responsive aspect ratios** - `aspect-[4/3] sm:aspect-[2/1] lg:aspect-[5/2]`

### From juice-interface:

1. **Block number interpolation** - Use EthDater to query historical states
2. **Protocol-aware queries** - Different strategies for v1-v3 vs v4
3. **Smart Y-axis domains** - 5% padding with minimum handling
4. **Time-adjusted fetching** - 10-minute buffer for blockchain confirmation
5. **Separate hooks per concern** - `useTimelineRange`, `useTicks`, `useTimelineYDomain`

---

## 12. Success Metrics

Track these to measure visualization effectiveness:

1. **User engagement** - Do users interact with charts (hover, change ranges)?
2. **Query patterns** - What visualizations are most requested?
3. **Completion rates** - Do users get the data they need?
4. **Performance** - Chart render time < 500ms
5. **Error rates** - Failed data fetches < 1%

---

## Appendix: Resources

- [Recharts Documentation](https://recharts.org/)
- [revnet-app GitHub](https://github.com/rev-net/revnet-app)
- [juice-interface GitHub](https://github.com/jbx-protocol/juice-interface)
- [Bendystraw GraphQL Endpoint](https://bendystraw.up.railway.app/graphql)
- [Juicebox Docs - Subgraph](https://docs.juicebox.money/v4/build/subgraph/)
