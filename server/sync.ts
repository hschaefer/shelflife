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
 * Compare an incoming transformed library item with its cached version to detect changes.
 */
function checkItemChanges(db: any, transformed: any) {
  const existing = db.prepare('SELECT * FROM library_items WHERE id = ?').get(transformed.id) as any;
  if (!existing) {
    return { isNew: true, detailUpdated: false, chaptersUpdated: false, changedFields: [] };
  }

  const changedFields: string[] = [];
  
  if (existing.title !== transformed.title) changedFields.push(`title ("${existing.title}" -> "${transformed.title}")`);
  if (existing.author_name !== transformed.author_name) changedFields.push(`author ("${existing.author_name}" -> "${transformed.author_name}")`);
  if (existing.narrator_name !== transformed.narrator_name) changedFields.push(`narrator ("${existing.narrator_name}" -> "${transformed.narrator_name}")`);
  if (existing.series_name !== transformed.series_name) changedFields.push(`series ("${existing.series_name}" -> "${transformed.series_name}")`);
  if (existing.series_sequence !== transformed.series_sequence) changedFields.push(`series_sequence ("${existing.series_sequence}" -> "${transformed.series_sequence}")`);
  if (existing.published_year !== transformed.published_year) changedFields.push(`published_year ("${existing.published_year}" -> "${transformed.published_year}")`);
  if (existing.genres !== transformed.genres) changedFields.push(`genres (${existing.genres} -> ${transformed.genres})`);
  if (existing.tags !== transformed.tags) changedFields.push(`tags (${existing.tags} -> ${transformed.tags})`);
  if (existing.description !== transformed.description) changedFields.push(`description updated`);
  if (existing.publisher !== transformed.publisher) changedFields.push(`publisher ("${existing.publisher}" -> "${transformed.publisher}")`);
  if (existing.language !== transformed.language) changedFields.push(`language ("${existing.language}" -> "${transformed.language}")`);
  if (existing.isbn !== transformed.isbn) changedFields.push(`isbn ("${existing.isbn}" -> "${transformed.isbn}")`);
  if (existing.asin !== transformed.asin) changedFields.push(`asin ("${existing.asin}" -> "${transformed.asin}")`);
  if (existing.subtitle !== transformed.subtitle) changedFields.push(`subtitle ("${existing.subtitle}" -> "${transformed.subtitle}")`);
  if (existing.abridged !== transformed.abridged) changedFields.push(`abridged (${existing.abridged} -> ${transformed.abridged})`);

  const chaptersUpdated = existing.num_chapters !== transformed.num_chapters;
  const detailUpdated = changedFields.length > 0;

  return {
    isNew: false,
    detailUpdated,
    chaptersUpdated,
    changedFields
  };
}

/**
 * Perform a full sync of a library (fetch all items, delete removed ones)
 */
export async function syncLibraryFull(libraryId: string): Promise<void> {
  const db = getDatabase();
  console.log(`[Sync] Library rescan triggered for library: ${libraryId} (FULL)`);
  
  const headers = getAuthHeaders();
  let page = 0;
  const limit = 100;
  let hasMore = true;
  const fetchedIds: Set<string> = new Set();
  
  let addedCount = 0;
  let actualUpdatedCount = 0;

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
      const transformed = transformItemToDb(item);
      
      const change = checkItemChanges(db, transformed);
      if (change.isNew) {
        addedCount++;
      } else if (change.detailUpdated || change.chaptersUpdated) {
        actualUpdatedCount++;
        if (change.detailUpdated) {
          console.log(`[Sync] Book detail updated for "${transformed.title}" (ID: ${transformed.id}): ${change.changedFields.join(', ')}`);
        }
        if (change.chaptersUpdated) {
          const existing = db.prepare('SELECT num_chapters FROM library_items WHERE id = ?').get(transformed.id) as any;
          console.log(`[Sync] Chapters updated for "${transformed.title}" (ID: ${transformed.id}) (num_chapters: ${existing?.num_chapters ?? 0} -> ${transformed.num_chapters})`);
        }
      }
      
      return transformed;
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
  const deletedCount = deletedIds.length;
  
  if (deletedCount > 0) {
    console.log(`[Sync] Purging ${deletedCount} deleted items from cache for library ${libraryId}`);
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

  const totalChanged = addedCount + actualUpdatedCount + deletedCount;
  console.log(`[Sync] Library rescan finished for library: ${libraryId} (FULL). Total books changed: ${totalChanged} (Added: ${addedCount}, Updated: ${actualUpdatedCount}, Deleted: ${deletedCount}).`);
}

/**
 * Perform incremental delta sync by checking for changes and falling back to full sync if needed
 */
export async function syncLibraryIncremental(libraryId: string): Promise<void> {
  const db = getDatabase();
  const state = db.prepare('SELECT last_incremental_sync FROM sync_state WHERE library_id = ?').get(libraryId) as { last_incremental_sync: number } | undefined;
  
  if (!state || !state.last_incremental_sync) {
    // If never fully synced, do a full sync instead
    return syncLibraryFull(libraryId);
  }

  console.log(`[Sync] Library rescan triggered for library: ${libraryId} (INCREMENTAL SMART)`);
  const headers = getAuthHeaders();
  
  // 1. Fetch all item IDs and updatedAt with a lightweight request
  const url = getAbsUrl(`/api/libraries/${libraryId}/items`);
  const response = await axios.get(url, {
    headers,
    params: { limit: 0, expanded: 0 }
  });
  
  const results = response.data?.results || [];
  const fetchedIds = new Set<string>();
  const changedIds = new Set<string>();
  
  for (const item of results) {
    fetchedIds.add(item.id);
    const cached = db.prepare('SELECT updated_at FROM library_items WHERE id = ?').get(item.id) as { updated_at: number } | undefined;
    
    // If not in cache, or updatedAt is different, we have a change
    if (!cached || cached.updated_at !== item.updatedAt) {
      changedIds.add(item.id);
    }
  }
  
  // Check for deleted items
  const allCachedItems = db.prepare('SELECT id FROM library_items WHERE library_id = ?').all(libraryId) as { id: string }[];
  const deletedIds = allCachedItems.filter(item => !fetchedIds.has(item.id)).map(item => item.id);
  
  if (changedIds.size === 0 && deletedIds.length === 0) {
     // Just update the sync timestamp
     db.prepare(`UPDATE sync_state SET last_incremental_sync = ?, total_items = ? WHERE library_id = ?`)
       .run(Date.now(), fetchedIds.size, libraryId);
     console.log(`[Sync] Library rescan finished for library: ${libraryId} (INCREMENTAL SMART). Total books changed: 0`);
     return;
  }
  
  // If there are any changes, fallback to robust full sync pagination to fetch all expanded data
  console.log(`[Sync] Detected ${changedIds.size} changed items and ${deletedIds.length} deleted items. Falling back to full sync for data retrieval.`);
  return syncLibraryFull(libraryId);
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

      // Ensure fallbacks for deleted or missing users
      const resolvedUserId = session.userId || 'deleted_user';
      const resolvedUsername = session.user?.username || session.username || 'Unknown User';

      // Update session object before stringifying so client/frontend is consistent
      if (!session.userId) {
        session.userId = resolvedUserId;
      }
      if (!session.username) {
        session.username = resolvedUsername;
      }
      if (!session.user) {
        session.user = { id: resolvedUserId, username: resolvedUsername };
      } else {
        if (!session.user.id) session.user.id = resolvedUserId;
        if (!session.user.username) session.user.username = resolvedUsername;
      }

      const genres = session.mediaMetadata?.genres || [];
      transformed.push({
        id: session.id,
        user_id: resolvedUserId,
        username: resolvedUsername,
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
