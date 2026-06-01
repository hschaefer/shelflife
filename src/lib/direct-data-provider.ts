import axios, { AxiosInstance } from 'axios';
import { DataProvider, LibraryItemsQuery, LibraryItemsResponse } from './data-provider';
import { Library, Book, User, Session, UserStats } from '../types';

// Zero-dependency IndexedDB wrapper
class IndexedDbWrapper {
  private dbName = 'shelflife_client_db';
  private dbVersion = 1;

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('library_items')) {
          const store = db.createObjectStore('library_items', { keyPath: 'id' });
          store.createIndex('library_id', 'libraryId', { unique: false });
          store.createIndex('added_at', 'addedAt', { unique: false });
        }
      };
    });
  }

  public async putItems(items: Book[]): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('library_items', 'readwrite');
      const store = transaction.objectStore('library_items');

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const item of items) {
        store.put(item);
      }
    });
  }

  public async getItemsByLibrary(libraryId: string): Promise<Book[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('library_items', 'readonly');
      const store = transaction.objectStore('library_items');
      const index = store.index('library_id');
      const request = index.getAll(libraryId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  public async getAllItems(): Promise<Book[]> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('library_items', 'readonly');
      const store = transaction.objectStore('library_items');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  public async deleteItemsByLibrary(libraryId: string, keepIds: Set<string>): Promise<void> {
    const db = await this.openDb();
    const items = await this.getItemsByLibrary(libraryId);
    const toDelete = items.filter(item => !keepIds.has(item.id));

    if (toDelete.length === 0) return;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction('library_items', 'readwrite');
      const store = transaction.objectStore('library_items');

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);

      for (const item of toDelete) {
        store.delete(item.id);
      }
    });
  }
}

export class DirectDataProvider implements DataProvider {
  private client: AxiosInstance;
  private db: IndexedDbWrapper;
  private syncState: Record<string, { isSyncing: boolean; lastSync: number }> = {};

  constructor(absUrl: string, token: string, extraHeaders?: Record<string, string>, isNative = false) {
    const baseURL = isNative ? `${absUrl}/api` : '/gateway/api';
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`
    };

    if (!isNative) {
      // Browser direct mode: route via /gateway with target headers
      headers['X-Target-URL'] = absUrl;
      if (extraHeaders && Object.keys(extraHeaders).length > 0) {
        headers['X-ABS-Extra-Headers'] = JSON.stringify(extraHeaders);
      }
    } else {
      // Android direct mode
      if (extraHeaders) {
        Object.assign(headers, extraHeaders);
      }
    }

    this.client = axios.create({
      baseURL,
      headers
    });
    this.db = new IndexedDbWrapper();
  }

  public async getLibraries(): Promise<Library[]> {
    const response = await this.client.get('/libraries');
    return response.data?.libraries || response.data || [];
  }

  /**
   * Return items from Local IndexedDB Cache, and trigger background delta-sync.
   * If IndexedDB is completely empty, wait for the first full fetch.
   */
  public async getLibraryItems(query: LibraryItemsQuery): Promise<LibraryItemsResponse> {
    const libraryId = query.libraryId;
    let localBooks = await this.db.getItemsByLibrary(libraryId);

    // If local cache is empty, trigger and await full sync
    if (localBooks.length === 0) {
      console.log(`[DirectCache] Empty cache for library ${libraryId}. Running initial full fetch...`);
      await this.runFullSync(libraryId);
      localBooks = await this.db.getItemsByLibrary(libraryId);
    } else {
      // Trigger lazy background incremental sync
      this.triggerIncrementalSync(libraryId);
    }

    // Perform searching locally
    let filtered = [...localBooks];
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      filtered = filtered.filter(b => {
        const title = (b.metadata?.title || '').toLowerCase();
        const author = (b.metadata?.authorName || '').toLowerCase();
        const id = (b.id || '').toLowerCase();
        return title.includes(searchLower) || author.includes(searchLower) || id.includes(searchLower);
      });
    }

    // Perform sorting locally
    const sortBy = query.sort || 'addedAt';
    const order = query.order || 'desc';
    
    filtered.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'title') {
        const titleA = a.metadata?.title || '';
        const titleB = b.metadata?.title || '';
        comparison = titleA.localeCompare(titleB, undefined, { sensitivity: 'base', numeric: true });
      } else if (sortBy === 'author') {
        const authorA = a.metadata?.authorName || '';
        const authorB = b.metadata?.authorName || '';
        comparison = authorA.localeCompare(authorB, undefined, { sensitivity: 'base', numeric: true });
      } else if (sortBy === 'addedAt') {
        comparison = (a.addedAt || 0) - (b.addedAt || 0);
      }
      return order === 'asc' ? comparison : -comparison;
    });

    // Perform pagination locally
    const page = query.page || 0;
    const limit = query.limit || 20;
    const offset = page * limit;
    const paginated = filtered.slice(offset, offset + limit);

    return {
      results: paginated,
      totalBooks: filtered.length,
      page,
      limit,
      totalPages: Math.ceil(filtered.length / limit)
    };
  }

  public async getLibraryStats(libraryId: string): Promise<any> {
    // Stats remain real-time passthrough for direct mode
    const response = await this.client.get(`/libraries/${libraryId}/stats`);
    return response.data;
  }

  /**
   * Get 10 recent items across all libraries from local IndexedDB cache
   */
  public async getRecentItems(limit = 10): Promise<{ results: Book[]; totalBooks: number }> {
    const allItems = await this.db.getAllItems();
    allItems.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    
    return {
      results: allItems.slice(0, limit),
      totalBooks: allItems.length
    };
  }

  public async getSessions(params: any): Promise<{ sessions: Session[]; total?: number }> {
    // Sessions remain pass-through in Direct Mode
    // Audiobookshelf's API uses 'itemsPerPage' instead of 'limit' for session pagination.
    const requestParams = { ...params };
    if (requestParams.limit !== undefined && requestParams.itemsPerPage === undefined) {
      requestParams.itemsPerPage = requestParams.limit;
    }
    const response = await this.client.get('/sessions', { params: requestParams });
    return response.data;
  }

  public async getOnlineUsers(): Promise<any> {
    const response = await this.client.get('/users/online');
    return response.data;
  }

  public async getUsers(): Promise<User[]> {
    const response = await this.client.get('/users');
    return response.data?.users || response.data || [];
  }

  /**
   * Run local stats calculation in Javascript from sessions array
   */
  public async getUserStats(): Promise<UserStats[]> {
    // In direct mode, we fetch sessions directly from ABS first (limit 500)
    const sessionsRes = await this.getSessions({ limit: 500, sort: 'startedAt', desc: '1' });
    const sessions = sessionsRes.sessions || [];

    const users = await this.getUsers();

    const statsMap: Record<string, UserStats> = {};
    const userMap: Record<string, string> = {};
    users.forEach(u => { userMap[u.id] = u.username; });

    const hourDistribution: Record<string, number[]> = {};
    const completionData: Record<string, { listened: number; total: number }> = {};
    const firstSession: Record<string, number> = {};
    const genreCounts: Record<string, Record<string, number>> = {};
    const deviceCounts: Record<string, Record<string, number>> = {};

    sessions.forEach(session => {
      const userId = session.userId;
      if (!statsMap[userId]) {
        statsMap[userId] = {
          userId,
          username: userMap[userId] || session.user?.username || session.username || userId,
          totalTime: 0,
          avgDaily: 0,
          activity: {},
          joinedAt: session.startedAt,
          preferredTime: '',
          completionRate: 0,
          deviceUsage: 'Web Client',
          topGenre: 'Mixed'
        };
        hourDistribution[userId] = new Array(24).fill(0);
        completionData[userId] = { listened: 0, total: 0 };
        firstSession[userId] = session.startedAt;
        genreCounts[userId] = {};
        deviceCounts[userId] = {};
      }

      if (session.startedAt < firstSession[userId]) {
        firstSession[userId] = session.startedAt;
      }

      // Simple YYYY-MM-DD local format
      const dateStr = new Date(session.startedAt).toISOString().split('T')[0];
      const listeningTime = session.timeListening || session.duration || 0;
      statsMap[userId].totalTime += listeningTime;
      statsMap[userId].activity[dateStr] = (statsMap[userId].activity[dateStr] || 0) + listeningTime;

      const hour = new Date(session.startedAt).getHours();
      hourDistribution[userId][hour]++;

      if (session.duration && session.duration > 0) {
        completionData[userId].listened += session.timeListening || 0;
        completionData[userId].total += session.duration;
      }

      const genres = (session as any).mediaMetadata?.genres || [];
      if (Array.isArray(genres)) {
        genres.forEach((g: string) => {
          if (g) genreCounts[userId][g] = (genreCounts[userId][g] || 0) + 1;
        });
      }

      const client = (session as any).deviceInfo?.clientName;
      if (client) {
        deviceCounts[userId][client] = (deviceCounts[userId][client] || 0) + 1;
      }
    });

    return Object.values(statsMap).map(user => {
      const userId = user.userId;
      const activeDays = Object.keys(user.activity).length;
      user.avgDaily = activeDays > 0 ? user.totalTime / activeDays : 0;
      user.joinedAt = firstSession[userId];

      const hours = hourDistribution[userId];
      const maxCount = Math.max(...hours);
      const peakHour = hours.indexOf(maxCount);
      if (maxCount > 0) {
        let label = 'Night';
        if (peakHour >= 5 && peakHour < 12) label = 'Morning';
        else if (peakHour >= 12 && peakHour < 17) label = 'Afternoon';
        else if (peakHour >= 17 && peakHour < 21) label = 'Evening';
        user.preferredTime = `${label} (${peakHour}:00-${peakHour + 1}:00)`;
      } else {
        user.preferredTime = 'Varies';
      }

      const comp = completionData[userId];
      if (comp && comp.total > 0) {
        user.completionRate = Math.round((comp.listened / comp.total) * 100);
      }

      const userGenres = genreCounts[userId];
      if (userGenres && Object.keys(userGenres).length > 0) {
        let topG = 'Mixed';
        let maxG = 0;
        for (const [genre, count] of Object.entries(userGenres)) {
          if (count > maxG) {
            maxG = count;
            topG = genre;
          }
        }
        user.topGenre = topG;
      }

      const userDevices = deviceCounts[userId];
      if (userDevices && Object.keys(userDevices).length > 0) {
        let topD = 'Web Client';
        let maxD = 0;
        for (const [device, count] of Object.entries(userDevices)) {
          if (count > maxD) {
            maxD = count;
            topD = device;
          }
        }
        user.deviceUsage = topD;
      }

      return user;
    }).sort((a, b) => b.totalTime - a.totalTime);
  }

  public async getDashboardStats(timeframe?: string): Promise<any> {
    const tf = timeframe || '30';
    
    // Fetch sessions directly from ABS first (limit 500)
    const sessionsRes = await this.getSessions({ limit: 500, sort: 'startedAt', desc: '1' });
    const sessions = sessionsRes.sessions || [];

    let cutoffTime = 0;
    if (tf !== 'all') {
      const days = parseInt(tf, 10) || 30;
      cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
    }

    const cutoff14Days = Date.now() - (14 * 24 * 60 * 60 * 1000);

    // Filter sessions matching active timeframe for timeframe-specific metrics
    const filteredSessions = tf === 'all' 
      ? sessions 
      : sessions.filter(s => s.startedAt >= cutoffTime);

    // 1. Top Authors
    const authorTimeMap: Record<string, number> = {};
    filteredSessions.forEach(session => {
      const author = (session as any).mediaMetadata?.authorName || 
                     (session as any).mediaMetadata?.author || 
                     (session as any).displayAuthor ||
                     "Unknown Author";
      const listeningTime = session.timeListening || session.duration || 0;
      authorTimeMap[author] = (authorTimeMap[author] || 0) + listeningTime;
    });

    const topAuthors = Object.entries(authorTimeMap)
      .map(([name, time]) => ({ name, time }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 5);

    // 2. Top Genres
    const genreTimeMap: Record<string, number> = {};
    filteredSessions.forEach(session => {
      const genres = (session as any).mediaMetadata?.genres || 
                     (session as any).mediaMetadata?.genre || 
                     [];
      const listeningTime = session.timeListening || session.duration || 0;
      
      if (Array.isArray(genres)) {
        genres.forEach((g: string) => {
          if (g) {
            genreTimeMap[g] = (genreTimeMap[g] || 0) + listeningTime;
          }
        });
      } else if (typeof genres === "string" && genres) {
        genreTimeMap[genres] = (genreTimeMap[genres] || 0) + listeningTime;
      }
    });

    const topGenres = Object.entries(genreTimeMap)
      .map(([name, time]) => ({ name, time }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 5);

    // 3. Listening History Chart Data (grouped by MM/dd)
    const activity: Record<string, number> = {};
    filteredSessions.forEach(session => {
      const date = new Date(session.startedAt);
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${month}/${day}`;
      
      const listeningTime = (session.timeListening || session.duration || 0) / 3600;
      activity[dateStr] = (activity[dateStr] || 0) + listeningTime;
    });

    const lineChartData = Object.entries(activity)
      .map(([date, hours]) => ({ date, hours: parseFloat(hours.toFixed(1)) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 4. Hourly Activity (Peak Hours) Chart Data (last 14 days)
    const activityHours: Record<number, number> = {};
    for (let h = 0; h < 24; h++) {
      activityHours[h] = 0;
    }

    const recent14dSessions = sessions.filter(s => s.startedAt >= cutoff14Days);
    recent14dSessions.forEach(session => {
      const date = new Date(session.startedAt);
      const hour = date.getHours();
      const listeningTime = (session.timeListening || session.duration || 0) / 3600;
      activityHours[hour] += listeningTime;
    });

    const hourlyActivityData = Object.entries(activityHours).map(([hStr, hours]) => {
      const h = parseInt(hStr, 10);
      const label = `${h.toString().padStart(2, '0')}:00`;
      return { hour: h, label, hours: parseFloat(hours.toFixed(1)) };
    }).sort((a, b) => a.hour - b.hour);

    // 5. Recent Activity Grouping Helper (24H & 7D)
    const getGroupedActivity = (days: number) => {
      const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
      const recentSessions = sessions.filter(s => s.startedAt >= cutoff);

      const groups: Record<string, { 
        userId: string; 
        username: string; 
        mostRecentActiveTime: number; 
        totalTime: number;
        uniqueBooks: { 
          title: string; 
          lastSession: any; 
        }[];
      }> = {};

      recentSessions.forEach(session => {
        const uId = session.userId;
        const title = session.displayTitle || session.mediaItemTitle || "Unknown Book";
        const time = session.timeListening || session.duration || 0;

        if (!groups[uId]) {
          groups[uId] = {
            userId: uId,
            username: session.user?.username || session.username || "Unknown",
            mostRecentActiveTime: session.startedAt,
            totalTime: 0,
            uniqueBooks: []
          };
        }

        groups[uId].totalTime += time;
        if (session.startedAt > groups[uId].mostRecentActiveTime) {
          groups[uId].mostRecentActiveTime = session.startedAt;
        }

        const existingBook = groups[uId].uniqueBooks.find(b => b.title.toLowerCase() === title.toLowerCase());
        if (!existingBook) {
          groups[uId].uniqueBooks.push({
            title,
            lastSession: session
          });
        } else {
          if (session.startedAt > existingBook.lastSession.startedAt) {
            existingBook.lastSession = session;
          }
        }
      });

      const groupedList = Object.values(groups).map(g => {
        g.uniqueBooks.sort((a, b) => b.lastSession.startedAt - a.lastSession.startedAt);
        return {
          ...g,
          uniqueBooks: g.uniqueBooks.slice(0, 3)
        };
      });

      groupedList.sort((a, b) => b.mostRecentActiveTime - a.mostRecentActiveTime);
      return groupedList;
    };

    const recentActivity1d = getGroupedActivity(1);
    const recentActivity7d = getGroupedActivity(7);

    return {
      topAuthors,
      topGenres,
      lineChartData,
      hourlyActivityData,
      recentActivity1d,
      recentActivity7d
    };
  }

  public async getSyncStatus(): Promise<any> {
    return {
      lastSync: this.syncState['global']?.lastSync || Date.now(),
      itemsCached: (await this.db.getAllItems()).length,
      sessionsCached: 0,
      libraries: []
    };
  }

  public async triggerSync(libraryId?: string, forceFull = false, awaitSync = true): Promise<any> {
    if (libraryId) {
      if (forceFull) {
        await this.runFullSync(libraryId);
      } else {
        await this.runIncrementalSync(libraryId);
      }
    } else {
      // Run full sync locally for all libraries in direct mode
      const libraries = await this.getLibraries();
      for (const lib of libraries) {
        await this.runFullSync(lib.id);
      }
    }
    return { success: true };
  }

  // Delta sync functions
  private triggerIncrementalSync(libraryId: string) {
    const state = this.syncState[libraryId];
    const now = Date.now();
    const FIVE_MINUTES = 5 * 60 * 1000;

    if (state && (now - state.lastSync < FIVE_MINUTES)) {
      return; // Already synced recently
    }

    if (state?.isSyncing) return;

    this.syncState[libraryId] = { isSyncing: true, lastSync: state?.lastSync || 0 };

    this.runIncrementalSync(libraryId)
      .then(() => {
        this.syncState[libraryId] = { isSyncing: false, lastSync: Date.now() };
        this.syncState['global'] = { isSyncing: false, lastSync: Date.now() };
        console.log(`[DirectCache] Incremental sync complete for ${libraryId}`);
      })
      .catch(err => {
        this.syncState[libraryId] = { isSyncing: false, lastSync: state?.lastSync || 0 };
        console.error(`[DirectCache] Incremental sync failed for ${libraryId}:`, err);
      });
  }

  private async runFullSync(libraryId: string): Promise<void> {
    let page = 0;
    const limit = 100;
    let hasMore = true;
    const fetchedIds: Set<string> = new Set();

    while (hasMore) {
      const response = await this.client.get(`/libraries/${libraryId}/items`, {
        params: { limit, page, expanded: 1 }
      });

      const results = response.data?.results || [];
      if (results.length === 0) {
        hasMore = false;
        break;
      }

      const books: Book[] = results.map((item: any) => {
        fetchedIds.add(item.id);
        const mediaMeta = item.media?.metadata || item.metadata || {};
        return {
          id: item.id,
          libraryId: item.libraryId || libraryId,
          metadata: {
            title: mediaMeta.title || 'Unknown Title',
            authorName: mediaMeta.authorName || 'Unknown Author',
            coverPath: `/gateway/api/items/${item.id}/cover`
          },
          addedAt: item.addedAt || Date.now(),
          duration: item.media?.duration || 0
        };
      });

      await this.db.putItems(books);

      page++;
      if (results.length < limit) {
        hasMore = false;
      }
    }

    // Delete items no longer present
    await this.db.deleteItemsByLibrary(libraryId, fetchedIds);
    this.syncState[libraryId] = { isSyncing: false, lastSync: Date.now() };
  }

  private async runIncrementalSync(libraryId: string): Promise<void> {
    let page = 0;
    const limit = 50;
    let hasMore = true;

    while (hasMore) {
      const response = await this.client.get(`/libraries/${libraryId}/items`, {
        params: {
          limit,
          page,
          sort: 'updatedAt',
          desc: 1,
          expanded: 1
        }
      });

      const results = response.data?.results || [];
      if (results.length === 0) {
        hasMore = false;
        break;
      }

      const books: Book[] = [];
      let stopIncremental = false;

      // Get current local items in library to check updated times
      const localItems = await this.db.getItemsByLibrary(libraryId);
      const localMap = new Map(localItems.map(item => [item.id, item]));

      for (const item of results) {
        const cached = localMap.get(item.id);
        
        // If we have it and it has same updated time, we are fully delta synced
        if (cached && (item.updatedAt && cached.addedAt === item.addedAt)) {
          stopIncremental = true;
          break;
        }

        const mediaMeta = item.media?.metadata || item.metadata || {};
        books.push({
          id: item.id,
          libraryId: item.libraryId || libraryId,
          metadata: {
            title: mediaMeta.title || 'Unknown Title',
            authorName: mediaMeta.authorName || 'Unknown Author',
            coverPath: `/gateway/api/items/${item.id}/cover`
          },
          addedAt: item.addedAt || Date.now(),
          duration: item.media?.duration || 0
        });
      }

      if (books.length > 0) {
        await this.db.putItems(books);
      }

      if (stopIncremental || results.length < limit) {
        hasMore = false;
        break;
      }

      page++;
    }
  }

  // Pass-through Direct ABS operations
  public async getItemDetails(itemId: string): Promise<any> {
    const response = await this.client.get(`/items/${itemId}`);
    return response.data;
  }

  public async matchLibraryItem(itemId: string, matchData?: any): Promise<any> {
    const response = await this.client.post(`/items/${itemId}/match`, matchData);
    return response.data;
  }

  public async searchMatches(itemId: string, provider: string, title: string, author?: string): Promise<any> {
    const response = await this.client.get('/search/books', {
      params: { provider, title, author }
    });
    const candidates = response.data || [];
    return candidates.map((c: any) => ({
      title: c.title,
      author: c.author,
      coverUrl: c.cover || (c.covers && c.covers[0]) || undefined,
      asin: c.asin || undefined,
      isbn: c.isbn || undefined,
      subtitle: c.subtitle || undefined,
      publisher: c.publisher || undefined,
      publishDate: c.publishDate || c.publishedYear || undefined,
      description: c.description || undefined,
      provider: provider,
      id: c.id || c.key || c.edition || ""
    }));
  }

  public async scanLibrary(libraryId: string): Promise<any> {
    const response = await this.client.post(`/libraries/${libraryId}/scan?force=1`);
    return response.data;
  }
}
