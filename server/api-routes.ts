import express, { Router } from 'express';
import axios from 'axios';
import { getDatabase } from './db.js';
import { syncAll, syncLibraryFull, syncLibraryIncremental } from './sync.js';

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = process.env.ABS_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (process.env.ABS_EXTRA_HEADERS) {
    try {
      const extra = JSON.parse(process.env.ABS_EXTRA_HEADERS);
      Object.assign(headers, extra);
    } catch {}
  }
  return headers;
}

function getAbsUrl(endpoint: string): string {
  let absUrl = process.env.ABS_URL || '';
  if (absUrl.endsWith('/')) {
    absUrl = absUrl.slice(0, -1);
  }
  return `${absUrl}${endpoint}`;
}

export function apiRouter(): Router {
  const router = Router();
  router.use(express.json());

  // GET /api/ping - Simple health check endpoint for ShelfLife client connections
  router.get('/ping', (req, res) => {
    res.json({ ok: true });
  });

  // GET /api/libraries - Passthrough to ABS
  router.get('/libraries', async (req, res) => {
    try {
      const url = getAbsUrl('/api/libraries');
      const response = await axios.get(url, { headers: getAuthHeaders() });
      res.json(response.data);
    } catch (err: any) {
      console.error('Failed to proxy libraries list:', err.message);
      res.status(500).json({ error: 'Failed to fetch libraries list from Audiobookshelf' });
    }
  });

  // GET /api/libraries/:id/items - Paginated search and sort
  router.get('/libraries/:id/items', (req, res) => {
    try {
      const db = getDatabase();
      const libraryId = req.params.id;
      
      const search = typeof req.query.search === 'string' ? req.query.search : '';
      const sortBy = typeof req.query.sort === 'string' ? req.query.sort : 'addedAt';
      const order = typeof req.query.order === 'string' && req.query.order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      const page = parseInt(req.query.page as string, 10) || 0;
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const offset = page * limit;

      // Map API sort names to SQLite columns
      let sortColumn = 'added_at';
      if (sortBy === 'title') {
        sortColumn = 'title';
      } else if (sortBy === 'author') {
        sortColumn = 'author_name';
      } else if (sortBy === 'addedAt') {
        sortColumn = 'added_at';
      }

      let query = `
        SELECT * FROM library_items 
        WHERE library_id = ?
      `;
      const params: any[] = [libraryId];

      if (search) {
        query += ` AND (title LIKE ? OR author_name LIKE ? OR id LIKE ?)`;
        const searchWildcard = `%${search}%`;
        params.push(searchWildcard, searchWildcard, searchWildcard);
      }

      // First get total count for pagination headers/meta
      const countQuery = `SELECT COUNT(*) as count FROM (${query})`;
      const totalCountRes = db.prepare(countQuery).get(...params) as { count: number };
      const total = totalCountRes.count;

      // Add sorting, pagination
      query += ` ORDER BY ${sortColumn} COLLATE NOCASE ${order} LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const items = db.prepare(query).all(...params) as any[];

      // Format to match client EXPECTED structure (Book type)
      const formattedItems = items.map((item) => ({
        id: item.id,
        libraryId: item.library_id,
        metadata: {
          title: item.title,
          authorName: item.author_name,
          narratorName: item.narrator_name,
          seriesName: item.series_name,
          seriesSequence: item.series_sequence,
          publishedYear: item.published_year,
          genres: JSON.parse(item.genres || '[]'),
          tags: JSON.parse(item.tags || '[]'),
          description: item.description,
          publisher: item.publisher,
          language: item.language,
          isbn: item.isbn,
          asin: item.asin,
          subtitle: item.subtitle,
          abridged: item.abridged === 1,
          numChapters: item.num_chapters,
          coverPath: `/gateway/api/items/${item.id}/cover`
        },
        addedAt: item.added_at,
        duration: item.duration,
        size: item.size,
        numAudioFiles: item.num_audio_files
      }));

      res.json({
        results: formattedItems,
        totalBooks: total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      });
    } catch (err: any) {
      console.error('Failed to fetch library items from cache:', err.message);
      res.status(500).json({ error: 'Failed to query library items cache' });
    }
  });

  // GET /api/libraries/:id/stats - Pre-calculated library metrics
  router.get('/libraries/:id/stats', (req, res) => {
    try {
      const db = getDatabase();
      const libraryId = req.params.id;

      // 1. Total items count
      const countRes = db.prepare('SELECT COUNT(*) as count FROM library_items WHERE library_id = ?').get(libraryId) as { count: number };
      const totalBooks = countRes ? countRes.count : 0;

      if (totalBooks === 0) {
        return res.json({
          totalSize: 0,
          totalDuration: 0,
          totalAuthors: 0,
          totalBooks: 0
        });
      }

      // 2. Sum of duration, sum of size, distinct authors
      const sumsRes = db.prepare(`
        SELECT 
          SUM(duration) as totalDuration,
          SUM(size) as totalSize,
          COUNT(DISTINCT author_name) as totalAuthors
        FROM library_items 
        WHERE library_id = ?
      `).get(libraryId) as { totalDuration: number; totalSize: number; totalAuthors: number };

      res.json({
        totalSize: sumsRes.totalSize || 0,
        totalDuration: sumsRes.totalDuration || 0,
        totalAuthors: sumsRes.totalAuthors || 0,
        totalBooks
      });
    } catch (err: any) {
      console.error('Failed to calculate library stats:', err.message);
      res.status(500).json({ error: 'Failed to query library stats cache' });
    }
  });

  // GET /api/libraries/:id/items/recent - Fetch 10 most recent items from SQLite
  router.get('/libraries/:id/items/recent', (req, res) => {
    try {
      const db = getDatabase();
      const libraryId = req.params.id;
      const limit = parseInt(req.query.limit as string, 10) || 10;

      const items = db.prepare(`
        SELECT * FROM library_items 
        WHERE library_id = ? 
        ORDER BY added_at DESC 
        LIMIT ?
      `).all(libraryId, limit) as any[];

      const formatted = items.map((item) => ({
        id: item.id,
        libraryId: item.library_id,
        metadata: {
          title: item.title,
          authorName: item.author_name,
          coverPath: `/gateway/api/items/${item.id}/cover`
        },
        addedAt: item.added_at,
        duration: item.duration
      }));

      res.json({
        results: formatted,
        totalBooks: items.length
      });
    } catch (err: any) {
      console.error('Failed to get recent library items:', err.message);
      res.status(500).json({ error: 'Failed to query recent items' });
    }
  });

  // GET /api/items/recent - Fetch 10 most recent items across all libraries from SQLite
  router.get('/items/recent', (req, res) => {
    try {
      const db = getDatabase();
      const limit = parseInt(req.query.limit as string, 10) || 10;

      const items = db.prepare(`
        SELECT * FROM library_items 
        ORDER BY added_at DESC 
        LIMIT ?
      `).all(limit) as any[];

      const formatted = items.map((item) => ({
        id: item.id,
        libraryId: item.library_id,
        metadata: {
          title: item.title,
          authorName: item.author_name,
          coverPath: `/gateway/api/items/${item.id}/cover`
        },
        addedAt: item.added_at,
        duration: item.duration
      }));

      const countRes = db.prepare('SELECT COUNT(*) as count FROM library_items').get() as { count: number };
      const totalBooks = countRes ? countRes.count : 0;

      res.json({
        results: formatted,
        totalBooks
      });
    } catch (err: any) {
      console.error('Failed to get global recent items:', err.message);
      res.status(500).json({ error: 'Failed to query global recent items' });
    }
  });

  // GET /api/sessions - Cached listening sessions history
  router.get('/sessions', (req, res) => {
    try {
      const db = getDatabase();
      const page = parseInt(req.query.page as string, 10) || 0;
      const limit = parseInt(req.query.limit as string, 10) || parseInt(req.query.itemsPerPage as string, 10) || 100;
      const offset = page * limit;

      const libraryItemId = req.query.libraryItemId as string | undefined;
      const userId = req.query.userId as string | undefined;

      let query = `SELECT raw_data FROM sessions`;
      const conditions: string[] = [];
      const queryParams: any[] = [];

      if (libraryItemId) {
        conditions.push(`library_item_id = ?`);
        queryParams.push(libraryItemId);
      }
      if (userId) {
        conditions.push(`user_id = ?`);
        queryParams.push(userId);
      }

      if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
      }
      
      query += ` ORDER BY started_at DESC LIMIT ? OFFSET ?`;
      queryParams.push(limit, offset);

      const rows = db.prepare(query).all(...queryParams) as { raw_data: string }[];

      const sessions = rows.map(r => JSON.parse(r.raw_data));

      res.json({
        sessions,
        page,
        limit
      });
    } catch (err: any) {
      console.error('Failed to get sessions from cache:', err.message);
      res.status(500).json({ error: 'Failed to query sessions cache' });
    }
  });

  // GET /api/stats/dashboard - Aggregate dashboard statistics accurately from database
  router.get('/stats/dashboard', (req, res) => {
    try {
      const db = getDatabase();
      const timeframe = req.query.timeframe as string || '30';
      
      let cutoffTime = 0;
      if (timeframe !== 'all') {
        const days = parseInt(timeframe, 10) || 30;
        cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
      }

      const cutoff14Days = Date.now() - (14 * 24 * 60 * 60 * 1000);
      const queryCutoff = timeframe === 'all' ? 0 : Math.min(cutoffTime, cutoff14Days);

      // Fetch all required sessions in a single database request
      const rows = db.prepare(`
        SELECT raw_data FROM sessions 
        WHERE started_at >= ?
        ORDER BY started_at ASC
      `).all(queryCutoff) as { raw_data: string }[];

      const sessions = rows.map(r => JSON.parse(r.raw_data));

      // Filter sessions matching active timeframe for timeframe-specific metrics
      const filteredSessions = timeframe === 'all' 
        ? sessions 
        : sessions.filter(s => s.startedAt >= cutoffTime);

      // 1. Top Authors
      const authorTimeMap: Record<string, number> = {};
      filteredSessions.forEach(session => {
        const author = session.mediaMetadata?.authorName || 
                       session.mediaMetadata?.author || 
                       session.displayAuthor ||
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
        const genres = session.mediaMetadata?.genres || 
                       session.mediaMetadata?.genre || 
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
      const activity: Record<string, { hours: number; users: Set<string> }> = {};
      filteredSessions.forEach(session => {
        const date = new Date(session.startedAt);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${month}/${day}`;
        
        const listeningTime = (session.timeListening || session.duration || 0) / 3600;
        
        if (!activity[dateStr]) {
          activity[dateStr] = { hours: 0, users: new Set() };
        }
        activity[dateStr].hours += listeningTime;
        if (session.userId) {
          activity[dateStr].users.add(session.userId);
        }
      });

      const lineChartData = Object.entries(activity)
        .map(([date, data]) => ({ 
          date, 
          hours: parseFloat(data.hours.toFixed(1)),
          activeUsers: data.users.size
        }))
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
          const uId = session.userId || 'deleted_user';
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

      res.json({
        topAuthors,
        topGenres,
        lineChartData,
        hourlyActivityData,
        recentActivity1d,
        recentActivity7d
      });
    } catch (err: any) {
      console.error('Failed to aggregate dashboard stats:', err.message);
      res.status(500).json({ error: 'Failed to compile dashboard statistics' });
    }
  });

  // GET /api/users/stats - Server-side high-performance stats aggregation
  router.get('/users/stats', (req, res) => {
    try {
      const db = getDatabase();

      // Fetch all sessions to calculate aggregates cleanly in Javascript
      const rows = db.prepare(`
        SELECT user_id, username, duration, time_listening, started_at, client_name, genres 
        FROM sessions 
        ORDER BY started_at ASC
      `).all() as any[];

      if (rows.length === 0) {
        return res.json([]);
      }

      const statsMap: Record<string, any> = {};
      const hourDistribution: Record<string, number[]> = {};
      const completionData: Record<string, { listened: number; total: number }> = {};
      const firstSession: Record<string, number> = {};
      const genreCounts: Record<string, Record<string, number>> = {};
      const deviceCounts: Record<string, Record<string, number>> = {};

      for (const row of rows) {
        const userId = row.user_id;
        
        if (!statsMap[userId]) {
          statsMap[userId] = {
            userId,
            username: row.username,
            totalTime: 0,
            avgDaily: 0,
            activity: {},
            joinedAt: row.started_at,
            preferredTime: '',
            completionRate: 0,
            deviceUsage: 'Web Client',
            topGenre: 'Mixed'
          };
          hourDistribution[userId] = new Array(24).fill(0);
          completionData[userId] = { listened: 0, total: 0 };
          firstSession[userId] = row.started_at;
          genreCounts[userId] = {};
          deviceCounts[userId] = {};
        }

        // Track earliest session as join date proxy
        if (row.started_at < firstSession[userId]) {
          firstSession[userId] = row.started_at;
        }

        // Parse date string (YYYY-MM-DD) relative to starts timestamp
        // Storing dates in UTC to avoid server timezone offset shifts
        const dateStr = new Date(row.started_at).toISOString().split('T')[0];
        const listeningTime = row.time_listening || row.duration || 0;
        statsMap[userId].totalTime += listeningTime;
        statsMap[userId].activity[dateStr] = (statsMap[userId].activity[dateStr] || 0) + listeningTime;

        // Track hour distribution
        const hour = new Date(row.started_at).getHours();
        hourDistribution[userId][hour]++;

        // Track completion rate
        if (row.duration && row.duration > 0) {
          completionData[userId].listened += row.time_listening || 0;
          completionData[userId].total += row.duration;
        }

        // Track genres
        try {
          const genres = JSON.parse(row.genres || '[]');
          if (Array.isArray(genres)) {
            for (const g of genres) {
              if (g) {
                genreCounts[userId][g] = (genreCounts[userId][g] || 0) + 1;
              }
            }
          }
        } catch {}

        // Track client device usage
        const client = row.client_name;
        if (client) {
          deviceCounts[userId][client] = (deviceCounts[userId][client] || 0) + 1;
        }
      }

      // Process aggregates for each user
      const usersStats = Object.values(statsMap).map(user => {
        const userId = user.userId;
        const activeDays = Object.keys(user.activity).length;
        user.avgDaily = activeDays > 0 ? user.totalTime / activeDays : 0;
        user.joinedAt = firstSession[userId];

        // Preferred time
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

        // Completion rate
        const comp = completionData[userId];
        if (comp && comp.total > 0) {
          user.completionRate = Math.round((comp.listened / comp.total) * 100);
        }

        // Top genre
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

        // Device usage
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

      res.json(usersStats);
    } catch (err: any) {
      console.error('Failed to aggregate user stats on server:', err.message);
      res.status(500).json({ error: 'Failed to compile listener statistics' });
    }
  });

  // POST /api/sync - Trigger manual scan/sync
  router.post('/sync', async (req, res) => {
    try {
      const { libraryId, forceFull, awaitSync } = req.body || {};
      
      if (libraryId) {
        console.log(`[Sync API] Targeted awaited sync triggered for library: ${libraryId} (forceFull: ${!!forceFull})`);
        if (forceFull) {
          await syncLibraryFull(libraryId);
        } else {
          await syncLibraryIncremental(libraryId);
        }
        res.json({ success: true, message: `Sync completed for library ${libraryId}` });
      } else {
        console.log('[Sync API] Manual sync triggered via endpoint.');
        if (awaitSync) {
          await syncAll(!!forceFull);
          res.json({ success: true, message: 'Synchronization cycle completed' });
        } else {
          syncAll(!!forceFull).catch(err => {
            console.error('[Sync API] Background sync failed:', err);
          });
          res.json({ success: true, message: 'Synchronization cycle triggered in background' });
        }
      }
    } catch (err: any) {
      console.error('[Sync API] Synchronous sync failed:', err.message);
      res.status(500).json({ error: 'Failed to initiate synchronization' });
    }
  });

  // GET /api/sync/status - Returns last sync information
  router.get('/sync/status', (req, res) => {
    try {
      const db = getDatabase();
      
      // Get last sync state per library
      const libStates = db.prepare('SELECT * FROM sync_state').all() as any[];
      
      // Get last sessions sync metadata
      const metaRow = db.prepare("SELECT value FROM sync_meta WHERE key = 'last_sessions_sync'").get() as { value: string } | undefined;
      const lastSessionsSync = metaRow ? parseInt(metaRow.value, 10) : null;

      let lastSync = 0;

      for (const state of libStates) {
        const stateSync = Math.max(state.last_full_sync || 0, state.last_incremental_sync || 0);
        if (stateSync > lastSync) {
          lastSync = stateSync;
        }
      }

      if (lastSessionsSync && lastSessionsSync > lastSync) {
        lastSync = lastSessionsSync;
      }

      // Count actual cached items
      const itemsCachedRes = db.prepare('SELECT COUNT(*) as count FROM library_items').get() as { count: number };
      const itemsCached = itemsCachedRes ? itemsCachedRes.count : 0;

      const sessionsCachedRes = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
      const sessionsCached = sessionsCachedRes ? sessionsCachedRes.count : 0;

      res.json({
        lastSync,
        itemsCached,
        sessionsCached,
        libraries: libStates.map(s => ({
          libraryId: s.library_id,
          lastSync: Math.max(s.last_full_sync || 0, s.last_incremental_sync || 0),
          totalItems: s.total_items
        })),
        lastSessionsSync
      });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch sync status' });
    }
  });

  return router;
}
