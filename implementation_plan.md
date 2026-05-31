# Persistent Cache Layer for ShelfLife

## Goal Description

Build a high-performance, persistent cache layer for ShelfLife (an Audiobookshelf analytics dashboard) to handle libraries with **>10k items** and provide sub-second load times. The current server is a stateless CORS gateway proxy, causing clients to trigger hundreds of paginated HTTP requests to Audiobookshelf (ABS) on every page load. 

This implementation will introduce:
1. A server-side SQLite cache with background delta-sync.
2. A client-side `DataProvider` abstraction supporting both ShelfLife Server mode and Direct ABS mode.
3. Android/Capacitor-side client caching of library items using IndexedDB to maintain high performance in direct-connection mode without requiring native compiler updates.

---

## Resolved Architectural Decisions

Based on user review and feedback, the following architectural choices are finalized:

### 1. Database for Server Cache: SQLite in Docker
* **Choice**: SQLite via `better-sqlite3`.
* **Details**: Zero-dependency, single-file database that runs inside the Docker container.
* **Persistence**: A host-mounted Docker volume (`/app/data`) will persist the database file (`shelflife.db`) across container updates and restarts.

### 2. Sync Frequency
* **Choice**: 5-minute periodic incremental sync.
* **Details**: A full sync runs once on server startup. Subsequently, a background service runs every 5 minutes (configurable via `SYNC_INTERVAL` in `.env`) to fetch items sorted by `updatedAt desc` and merge changes. A manual rescan trigger is also supported.

### 3. Server-Side Session Caching & Statistics Aggregation
* **Choice**: Server-side caching of *all* sessions in structured SQL tables.
* **Details**: 
  - Instead of standard pass-through, the background sync service will fetch and persist all user sessions in SQLite.
  - The SQLite table will have structured columns (not just JSON blobs) for fields like `user_id`, `duration`, `time_listening`, `started_at`, `client_name`, and `genres`.
  - The server will expose a `/api/users/stats` endpoint. All the heavy stats aggregation logic (previously in the client's `useMemo`) will run on the server in fast SQL queries.
  - **Benefits**: Offloads CPU-intensive operations from mobile/client web apps, speeds up initial dashboard rendering, and lays a perfect foundation for future webhook/notification integrations.

### 4. Android Client Cache Strategy
* **Choice**: Cache **only library items**, use **IndexedDB** for storage.
* **Details**:
  - In direct-connection mode (Android → ABS directly), only library items are cached. Listening sessions remain pass-through to ensure real-time accuracy and keep the database lightweight.
  - **IndexedDB** is chosen over `@capacitor-community/sqlite` (native SQLite) or `@capacitor/preferences` (key-value store). IndexedDB is standard, transactional, natively supported in WebView/browsers, requires **zero native Gradle setup/plugin installation**, and easily queries 10k+ records in sub-milliseconds. This avoids requiring developers/users to rebuild native Android binaries to get cache support.

---

## Proposed Changes

### Component 1: Server-Side Cache Layer

```
┌─────────────────────────────────────────────────────────────┐
│                    Client (Web / Android)                     │
│                                                               │
│  DataProvider abstraction:                                    │
│    ├─ ServerDataProvider  → talks to ShelfLife API            │
│    └─ DirectDataProvider  → talks to ABS directly + local DB │
└──────────────┬──────────────────────────────┬────────────────┘
               │                              │
     Web (→ ShelfLife Server)         Android (→ ABS Direct)
               │                              │
               ▼                              ▼
┌──────────────────────────────┐       ┌──────────────────────┐
│   ShelfLife Express Server   │       │  ABS Instance        │
│                              │       │  (direct connection)  │
│  ┌────────────────────────┐  │       └──────────────────────┘
│  │  SQLite Cache Layer    │  │
│  │  (better-sqlite3)      │  │
│  │                        │  │
│  │  • library_items       │  │
│  │  • sessions            │  │
│  │  • sync_state          │  │
│  │  • user_stats          │  │
│  │  (pre-aggregated stats)│  │
│  └────────┬───────────────┘  │
│           │                  │
│  ┌────────▼───────────────┐  │
│  │  ABS Sync Service      │  │
│  │  (background sync)     │  │
│  └────────────────────────┘  │
│                              │
│  Gateway proxy (unchanged)   │
└──────────────────────────────┘
```

#### [NEW] `server/db.ts` — SQLite Database Setup
Initializes the SQLite database with `better-sqlite3` and defines the schema:

```sql
-- Core item cache
CREATE TABLE IF NOT EXISTS library_items (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  title TEXT,
  author_name TEXT,
  narrator_name TEXT,
  series_name TEXT,
  series_sequence TEXT,
  duration REAL DEFAULT 0,
  published_year TEXT,
  genres TEXT,           -- JSON array string
  tags TEXT,             -- JSON array string
  added_at INTEGER,
  updated_at INTEGER,
  size INTEGER DEFAULT 0,
  num_audio_files INTEGER DEFAULT 0,
  has_cover INTEGER DEFAULT 0,
  description TEXT,
  publisher TEXT,
  language TEXT,
  isbn TEXT,
  asin TEXT,
  subtitle TEXT,
  abridged INTEGER DEFAULT 0,
  num_chapters INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_items_library ON library_items(library_id);
CREATE INDEX IF NOT EXISTS idx_items_updated ON library_items(updated_at);
CREATE INDEX IF NOT EXISTS idx_items_added ON library_items(added_at);
CREATE INDEX IF NOT EXISTS idx_items_title ON library_items(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_items_author ON library_items(author_name COLLATE NOCASE);

-- Sessions cache
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  library_id TEXT,
  library_item_id TEXT,
  duration REAL DEFAULT 0,
  time_listening REAL DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER,
  current_time REAL DEFAULT 0,
  progress REAL DEFAULT 0,
  client_name TEXT,
  genres TEXT,           -- JSON array string of genres
  raw_data TEXT          -- Full JSON blob fallback
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

-- Sync state tracking
CREATE TABLE IF NOT EXISTS sync_state (
  library_id TEXT PRIMARY KEY,
  last_full_sync INTEGER,
  last_incremental_sync INTEGER,
  total_items INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

#### [NEW] `server/sync.ts` — ABS Sync Service
Background service that performs startup full-syncs and periodic incremental-syncs:
* **`fullSync(libraryId)`**: Fetches all books from ABS, upserts into `library_items`, and purges stale items.
* **`incrementalSync(libraryId)`**: Fetches items sorted by `updatedAt desc` until it encounters cached records.
* **`syncSessions()`**: Paginates through all sessions from ABS and caches them. Compares with latest cached session to perform delta-sync.
* **Startup**: Initiates full sync of configured libraries and sessions on boot.
* **Periodic**: Triggers incremental syncs every 5 minutes.

#### [NEW] `server/api-routes.ts` — ShelfLife REST API
Exposes endpoints to query the SQLite cache:

| Endpoint | Description | Cache Strategy |
|---|---|---|
| `GET /api/libraries` | List libraries | Passthrough to ABS |
| `GET /api/libraries/:id/items` | Search, sort, page library items | SQLite SQL query (handles 10k+ in milliseconds) |
| `GET /api/libraries/:id/stats` | Aggregated stats for a specific library | SQL `SELECT COUNT(*), SUM(duration)` etc. |
| `GET /api/libraries/:id/items/recent` | Recent additions | SQL sorted by `added_at DESC` |
| `GET /api/users/stats` | Pre-calculated listener metrics (joinedAt, totalTime, avgDaily, activity heatmap, preferred hour, completionRate, topGenre, deviceUsage) | SQL aggregation on `sessions` |
| `GET /api/sessions` | List sessions with pagination | SQLite SQL query |
| `POST /api/sync` | Trigger manual sync | Calls sync service and returns status |
| `GET /api/sync/status` | Last sync time and cached items | SQLite query on `sync_state` |

* `/gateway` continues to handle covers, stream playback, manual matches, and editing.

#### [MODIFY] [server.ts](file:///home/heinrich/code/shelflife/server.ts)
* Mount `/api` routes before `/gateway` and static files.
* Initialize database and background sync service on startup.

---

### Component 2: Client-Side DataProvider Abstraction

#### [NEW] `src/lib/data-provider.ts` — DataProvider Interface
A clean data abstraction layer allowing the client app to run transparently in both modes:

```typescript
export interface LibraryItemsQuery {
  libraryId: string;
  search?: string;
  sort?: 'title' | 'author' | 'addedAt';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface LibraryItemsResponse {
  items: Book[];
  total: number;
  page: number;
  totalPages: number;
}

export interface DataProvider {
  getLibraries(): Promise<Library[]>;
  getLibraryItems(query: LibraryItemsQuery): Promise<LibraryItemsResponse>;
  getLibraryStats(libraryId: string): Promise<any>;
  getRecentItems(limit?: number): Promise<{ results: Book[]; totalBooks: number }>;
  getSessions(params: any): Promise<any>;
  getOnlineUsers(): Promise<any>;
  getUsers(): Promise<User[]>;
  getUserStats(users: User[], sessions: Session[]): Promise<UserStats[]>; // Fallback calculation on client if needed
  getSyncStatus(): Promise<{ lastSync: number; itemsCached: number } | null>;
  
  // Direct pass-through controls
  getItemDetails(itemId: string): Promise<any>;
  matchLibraryItem(itemId: string, matchData?: any): Promise<any>;
  searchMatches(itemId: string, provider: string, title: string, author?: string): Promise<any>;
  scanLibrary(libraryId: string): Promise<any>;
}
```

#### [NEW] `src/lib/server-data-provider.ts` — Server Mode
Used by Web clients and Android apps connected to a ShelfLife Server.
* `getLibraryItems` forwards queries with `?search=&sort=&page=&limit=` to the ShelfLife cache server.
* `getUserStats` directly queries `/api/users/stats` which returns pre-computed SQL aggregations (sub-second performance).

#### [NEW] `src/lib/direct-data-provider.ts` — Direct ABS Mode (IndexedDB Caching)
Used by Android clients connecting directly to ABS.
* Stores library items in a local **IndexedDB** store (using the standard browser/WebView API).
* On startup, fires a background delta-sync to update IndexedDB from ABS.
* Queries are run locally using IndexedDB indexes or in-memory arrays.
* Sessions remain pass-through to ABS (no database caching) to keep client operations simple.
* Aggregations (`getUserStats`) are computed on-device in a background thread or optimized JS function from fetched sessions.

#### [MODIFY] [api.ts](file:///home/heinrich/code/shelflife/src/lib/api.ts)
* Adapt `ApiClient` to delegate all data queries to the active `DataProvider`.
* Connection state will initialize either `ServerDataProvider` or `DirectDataProvider` dynamically.

---

### Component 3: Client View Updates

#### [MODIFY] [LibraryView.tsx](file:///home/heinrich/code/shelflife/src/components/LibraryView.tsx)
* Convert to **server-side paginated queries** via the DataProvider.
* Search bar will debounce input and query the provider.
* Sort and page changes will trigger fresh provider fetches, completely eliminating the client-side `useMemo` that crashes on >10k items.

#### [MODIFY] [App.tsx](file:///home/heinrich/code/shelflife/src/App.tsx)
* Replace direct API calls with provider methods.
* Fetch `userStats` directly from `dataProvider.getUserStats` instead of running CPU-heavy calculations in local React state.
* Add a sleek "Sync Status" badge to the header showing when the database was last updated.

---

### Component 4: Docker & Infrastructure

#### [MODIFY] [docker-compose.yml](file:///home/heinrich/code/shelflife/docker-compose.yml)
* Add environment variables `DB_PATH=/app/data/shelflife.db` and `SYNC_INTERVAL=300`.
* Add `volumes` mapping local `./data` folder to `/app/data` to persist the SQLite cache.

#### [MODIFY] [Dockerfile](file:///home/heinrich/code/shelflife/Dockerfile)
* Install SQLite runtimes inside the container.
* Add `/app/data` folder creation and permissions.

#### [MODIFY] [package.json](file:///home/heinrich/code/shelflife/package.json)
* Add `better-sqlite3` to server dependencies.
* Add developer types for `better-sqlite3`.

---

## Verification Plan

### Automated Tests
1. **Database Schema & Integration Tests**: Verify SQLite creates tables correctly and queries perform correctly under heavy pagination.
2. **Background Sync Tests**: Mock ABS responses to test full and incremental sync routines (including deltas and deleted items).
3. **Build Integrity**: Ensure `npm run build` runs with zero TypeScript/Vite compilation errors.

### Manual Verification
1. **Large Library Simulation**: Validate search, sort, and pagination load times under simulated 10k+ libraries (target response < 200ms).
2. **Persistence Test**: Run ShelfLife server, allow it to sync, restart the container, and verify the cache is instantly available.
3. **Dual Connection Toggle**: Test the Android connection toggle (ShelfLife Server connection vs Direct ABS connection) and verify IndexedDB properly caches library items in Direct ABS mode.
