import axios from 'axios';
import { getDatabase } from './db.js';

let isSyncing = false;
let syncTimer: NodeJS.Timeout | null = null;

// Parse extra headers from environment
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
    } catch (e) {
      console.error('Failed to parse ABS_EXTRA_HEADERS in sync service:', e);
    }
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

/**
 * Transform deep ABS item response to flat database columns
 */
function transformItemToDb(item: any) {
  const media = item.media || {};
  const metadata = media.metadata || item.metadata || {};
  
  // Extract and serialize arrays
  const genres = Array.isArray(metadata.genres) ? JSON.stringify(metadata.genres) : '[]';
  const tags = Array.isArray(metadata.tags) ? JSON.stringify(metadata.tags) : '[]';

  // Extract author and narrator
  const authorName = metadata.authorName || '';
  const narratorName = Array.isArray(metadata.narratorName) 
    ? metadata.narratorName.join(', ') 
    : (metadata.narratorName || '');

  return {
    id: item.id,
    library_id: item.libraryId || '',
    title: metadata.title || 'Unknown Title',
    author_name: authorName,
    narrator_name: narratorName,
    series_name: metadata.seriesName || null,
    series_sequence: metadata.seriesSequence || null,
    duration: parseFloat(media.duration || item.duration || 0),
    published_year: metadata.publishedYear || null,
    genres: genres,
    tags: tags,
    added_at: item.addedAt || Date.now(),
    updated_at: item.updatedAt || Date.now(),
    size: parseInt(item.size || 0, 10),
    num_audio_files: parseInt(media.numAudioFiles || media.numTracks || 0, 10),
    has_cover: item.hasCover ? 1 : 0,
    description: metadata.description || null,
    publisher: metadata.publisher || null,
    language: metadata.language || null,
    isbn: metadata.isbn || null,
    asin: metadata.asin || null,
    subtitle: metadata.subtitle || null,
    abridged: media.abridged ? 1 : 0,
    num_chapters: Array.isArray(media.chapters) ? media.chapters.length : 0
  };
}

/**
 * Perform a full sync of a library (fetch all items, delete removed ones)
 */
export async function syncLibraryFull(libraryId: string): Promise<void> {
  const db = getDatabase();
  console.log(`[Sync] Starting full sync for library: ${libraryId}`);
  
  const headers = getAuthHeaders();
  let page = 0;
  const limit = 100;
  let hasMore = true;
  const fetchedIds: Set<string> = new Set();

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO library_items (
      id, library_id, title, author_name, narrator_name, series_name, series_sequence,
      duration, published_year, genres, tags, added_at, updated_at, size,
      num_audio_files, has_cover, description, publisher, language, isbn, asin,
      subtitle, abridged, num_chapters
    ) VALUES (
      @id, @library_id, @title, @author_name, @narrator_name, @series_name, @series_sequence,
      @duration, @published_year, @genres, @tags, @added_at, @updated_at, @size,
      @num_audio_files, @has_cover, @description, @publisher, @language, @isbn, @asin,
      @subtitle, @abridged, @num_chapters
    )
  `);

  // Start database transaction
  const runTransaction = db.transaction((items: any[]) => {
    for (const item of items) {
      insertStmt.run(item);
    }
  });

  while (hasMore) {
    const url = getAbsUrl(`/api/libraries/${libraryId}/items`);
    console.log(`[Sync] Fetching page ${page} for library ${libraryId}...`);
    
    const response = await axios.get(url, {
      headers,
      params: {
        limit,
        page,
        expanded: 1
      }
    });

    const results = response.data?.results || [];
    if (results.length === 0) {
      hasMore = false;
      break;
    }

    const transformedItems = results.map((item: any) => {
      fetchedIds.add(item.id);
      return transformItemToDb(item);
    });

    // Run batch insert
    runTransaction(transformedItems);

    page++;
    if (results.length < limit) {
      hasMore = false;
    }
  }

  // Delete items from cache that were removed from ABS
  const allCachedItems = db.prepare('SELECT id FROM library_items WHERE library_id = ?').all(libraryId) as { id: string }[];
  const deletedIds = allCachedItems.filter(item => !fetchedIds.has(item.id)).map(item => item.id);
  
  if (deletedIds.length > 0) {
    console.log(`[Sync] Purging ${deletedIds.length} deleted items from cache for library ${libraryId}`);
    const deleteStmt = db.prepare('DELETE FROM library_items WHERE id = ?');
    const runDeleteTx = db.transaction((ids: string[]) => {
      for (const id of ids) {
        deleteStmt.run(id);
      }
    });
    runDeleteTx(deletedIds);
  }

  // Update sync state
  const totalCount = fetchedIds.size;
  db.prepare(`
    INSERT OR REPLACE INTO sync_state (library_id, last_full_sync, last_incremental_sync, total_items)
    VALUES (?, ?, ?, ?)
  `).run(libraryId, Date.now(), Date.now(), totalCount);

  console.log(`[Sync] Full sync completed for library ${libraryId}. Cached ${totalCount} items.`);
}

/**
 * Perform incremental delta sync using updatedAt descending
 */
export async function syncLibraryIncremental(libraryId: string): Promise<void> {
  const db = getDatabase();
  const state = db.prepare('SELECT last_incremental_sync FROM sync_state WHERE library_id = ?').get(libraryId) as { last_incremental_sync: number } | undefined;
  
  if (!state || !state.last_incremental_sync) {
    // If never fully synced, do a full sync instead
    return syncLibraryFull(libraryId);
  }

  console.log(`[Sync] Starting incremental sync for library: ${libraryId}`);
  const headers = getAuthHeaders();
  let page = 0;
  const limit = 50;
  let hasMore = true;
  let updatedCount = 0;

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO library_items (
      id, library_id, title, author_name, narrator_name, series_name, series_sequence,
      duration, published_year, genres, tags, added_at, updated_at, size,
      num_audio_files, has_cover, description, publisher, language, isbn, asin,
      subtitle, abridged, num_chapters
    ) VALUES (
      @id, @library_id, @title, @author_name, @narrator_name, @series_name, @series_sequence,
      @duration, @published_year, @genres, @tags, @added_at, @updated_at, @size,
      @num_audio_files, @has_cover, @description, @publisher, @language, @isbn, @asin,
      @subtitle, @abridged, @num_chapters
    )
  `);

  const runTransaction = db.transaction((items: any[]) => {
    for (const item of items) {
      insertStmt.run(item);
    }
  });

  while (hasMore) {
    const url = getAbsUrl(`/api/libraries/${libraryId}/items`);
    const response = await axios.get(url, {
      headers,
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

    const transformed: any[] = [];
    let stopIncremental = false;

    for (const item of results) {
      // Check if we already have this exact updated version in our cache
      const cached = db.prepare('SELECT updated_at FROM library_items WHERE id = ?').get(item.id) as { updated_at: number } | undefined;
      
      if (cached && cached.updated_at === item.updatedAt) {
        // Since we are sorting by updatedAt descending, as soon as we see an item 
        // that matches our cached updatedAt, we can stop the sync!
        stopIncremental = true;
        break;
      }

      transformed.push(transformItemToDb(item));
      updatedCount++;
    }

    if (transformed.length > 0) {
      runTransaction(transformed);
    }

    if (stopIncremental || results.length < limit) {
      hasMore = false;
      break;
    }

    page++;
  }

  // Update incremental sync timestamp and total count
  const countRes = db.prepare('SELECT COUNT(*) as count FROM library_items WHERE library_id = ?').get(libraryId) as { count: number };
  db.prepare(`
    UPDATE sync_state 
    SET last_incremental_sync = ?, total_items = ?
    WHERE library_id = ?
  `).run(Date.now(), countRes.count, libraryId);

  console.log(`[Sync] Incremental sync completed for library ${libraryId}. Updated ${updatedCount} items. Total: ${countRes.count}`);
}

/**
 * Delta-sync listening sessions history
 */
export async function syncSessions(forceFull = false): Promise<void> {
  const db = getDatabase();
  
  // Check if we ever completed a full sessions sync
  const fullSyncCompletedRow = db.prepare("SELECT value FROM sync_meta WHERE key = 'sessions_full_sync_completed'").get() as { value: string } | undefined;
  const isFirstSessionsSync = !fullSyncCompletedRow || fullSyncCompletedRow.value !== 'true';
  const runFull = forceFull || isFirstSessionsSync;

  console.log(`[Sync] Starting sync of listening sessions (mode: ${runFull ? 'FULL' : 'INCREMENTAL'})...`);
  
  const headers = getAuthHeaders();
  let page = 0;
  const limit = 100;
  let hasMore = true;
  let addedCount = 0;

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO sessions (
      id, user_id, username, library_id, library_item_id, duration, time_listening,
      started_at, updated_at, current_time, progress, client_name, genres, raw_data
    ) VALUES (
      $id, $user_id, $username, $library_id, $library_item_id, $duration, $time_listening,
      $started_at, $updated_at, $current_time, $progress, $client_name, $genres, $raw_data
    )
  `);

  const runTransaction = db.transaction((sessions: any[]) => {
    for (const s of sessions) {
      insertStmt.run(s);
    }
  });

  while (hasMore) {
    const url = getAbsUrl('/api/sessions');
    const response = await axios.get(url, {
      headers,
      params: {
        itemsPerPage: limit,
        page,
        sort: 'startedAt',
        desc: 1
      }
    });

    const sessionsData = response.data?.sessions || response.data || [];
    if (sessionsData.length === 0) {
      hasMore = false;
      break;
    }

    const transformed: any[] = [];
    let stopIncremental = false;

    for (const session of sessionsData) {
      // If we are doing incremental sync, check if we already have it
      if (!runFull) {
        const cached = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get(session.id) as { updated_at: number } | undefined;
        if (cached && cached.updated_at === session.updatedAt) {
          stopIncremental = true;
          break;
        }
      }

      const genres = session.mediaMetadata?.genres || [];
      transformed.push({
        id: session.id,
        user_id: session.userId,
        username: session.user?.username || session.username || 'Unknown User',
        library_id: session.libraryId || null,
        library_item_id: session.libraryItemId || null,
        duration: parseFloat(session.duration || 0),
        time_listening: parseFloat(session.timeListening || 0),
        started_at: session.startedAt,
        updated_at: session.updatedAt || session.startedAt,
        current_time: parseFloat(session.currentTime || 0),
        progress: parseFloat(session.progress || 0),
        client_name: session.deviceInfo?.clientName || 'Web Client',
        genres: JSON.stringify(genres),
        raw_data: JSON.stringify(session)
      });
      addedCount++;
    }

    if (transformed.length > 0) {
      runTransaction(transformed);
    }

    if (stopIncremental || sessionsData.length < limit) {
      hasMore = false;
      break;
    }

    page++;
  }

  // Update general metadata for last successful sessions sync
  db.prepare(`
    INSERT OR REPLACE INTO sync_meta (key, value)
    VALUES ('last_sessions_sync', ?)
  `).run(String(Date.now()));

  if (runFull) {
    db.prepare(`
      INSERT OR REPLACE INTO sync_meta (key, value)
      VALUES ('sessions_full_sync_completed', 'true')
    `).run();
  }

  console.log(`[Sync] Sessions sync completed. Upserted ${addedCount} sessions.`);
}

/**
 * Main routine that synchronizes all libraries and sessions
 */
export async function syncAll(forceFull = false): Promise<void> {
  if (isSyncing) {
    console.log('[Sync] Synchronization already in progress, skipping...');
    return;
  }

  isSyncing = true;
  console.log('[Sync] Starting full synchronization cycle...');
  
  try {
    const headers = getAuthHeaders();
    
    // 1. Fetch available libraries
    const librariesUrl = getAbsUrl('/api/libraries');
    const librariesRes = await axios.get(librariesUrl, { headers });
    const libraries = librariesRes.data?.libraries || librariesRes.data || [];
    
    console.log(`[Sync] Found ${libraries.length} libraries to synchronize.`);
    
    // 2. Sync library books
    for (const lib of libraries) {
      try {
        const db = getDatabase();
        const hasState = db.prepare('SELECT last_full_sync FROM sync_state WHERE library_id = ?').get(lib.id);
        
        if (forceFull || !hasState) {
          await syncLibraryFull(lib.id);
        } else {
          await syncLibraryIncremental(lib.id);
        }
      } catch (err: any) {
        console.error(`[Sync] Failed to sync library ${lib.id} (${lib.name}):`, err.message);
      }
    }

    // 3. Sync sessions history
    try {
      await syncSessions(forceFull);
    } catch (err: any) {
      console.error('[Sync] Failed to sync sessions:', err.message);
    }

    console.log('[Sync] Synchronization cycle completed successfully.');
  } catch (err: any) {
    console.error('[Sync] Error during synchronization cycle:', err.message);
  } finally {
    isSyncing = false;
  }
}

/**
 * Starts background sync interval daemon
 */
export function startSyncService(forceInitialFull = false): void {
  // Clear any existing timer
  if (syncTimer) {
    clearInterval(syncTimer);
  }

  const intervalSeconds = parseInt(process.env.SYNC_INTERVAL || '300', 10);
  console.log(`[Sync] Starting sync daemon. Interval: ${intervalSeconds} seconds.`);

  // Run initial sync on startup asynchronously so it doesn't block server start
  setTimeout(async () => {
    console.log('[Sync] Triggering initial startup sync...');
    await syncAll(forceInitialFull);
  }, 1000);

  // Set periodic timer
  syncTimer = setInterval(async () => {
    console.log('[Sync] Periodic sync timer triggered...');
    await syncAll(false);
  }, intervalSeconds * 1000);
}

/**
 * Stops background sync daemon
 */
export function stopSyncService(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    console.log('[Sync] Background sync service stopped.');
  }
}
