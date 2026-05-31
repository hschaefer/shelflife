import { Router } from 'express';
import axios from 'axios';
import { getDatabase } from './db.js';
import { syncAll } from './sync.js';

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

      const rows = db.prepare(`
        SELECT raw_data FROM sessions 
        ORDER BY started_at DESC 
        LIMIT ? OFFSET ?
      `).all(limit, offset) as { raw_data: string }[];

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
      console.log('[Sync API] Manual sync triggered via endpoint.');
      
      // Fire background sync without awaiting so response is instant
      syncAll(true).catch(err => {
        console.error('[Sync API] Background sync failed:', err);
      });

      res.json({ success: true, message: 'Synchronization cycle triggered in background' });
    } catch (err: any) {
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
      let totalCachedItems = 0;

      for (const state of libStates) {
        totalCachedItems += state.total_items || 0;
        const stateSync = Math.max(state.last_full_sync || 0, state.last_incremental_sync || 0);
        if (stateSync > lastSync) {
          lastSync = stateSync;
        }
      }

      if (lastSessionsSync && lastSessionsSync > lastSync) {
        lastSync = lastSessionsSync;
      }

      res.json({
        lastSync,
        itemsCached: totalCachedItems,
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
