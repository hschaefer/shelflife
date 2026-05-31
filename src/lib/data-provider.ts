import { Library, Book, User, Session, UserStats } from '../types';

export interface LibraryItemsQuery {
  libraryId: string;
  search?: string;
  sort?: 'title' | 'author' | 'addedAt';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface LibraryItemsResponse {
  results: Book[];
  totalBooks: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SyncStatus {
  lastSync: number;
  itemsCached: number;
  libraries: Array<{
    libraryId: string;
    lastSync: number;
    totalItems: number;
  }>;
  lastSessionsSync: number | null;
}

export interface DataProvider {
  getLibraries(): Promise<Library[]>;
  getLibraryItems(query: LibraryItemsQuery): Promise<LibraryItemsResponse>;
  getLibraryStats(libraryId: string): Promise<any>;
  getRecentItems(limit?: number): Promise<{ results: Book[]; totalBooks: number }>;
  getSessions(params: any): Promise<{ sessions: Session[]; total?: number }>;
  getOnlineUsers(): Promise<any>;
  getUsers(): Promise<User[]>;
  getUserStats(): Promise<UserStats[]>;
  getSyncStatus(): Promise<SyncStatus | null>;
  triggerSync(): Promise<any>;

  // Direct pass-through controls
  getItemDetails(itemId: string): Promise<any>;
  matchLibraryItem(itemId: string, matchData?: any): Promise<any>;
  searchMatches(itemId: string, provider: string, title: string, author?: string): Promise<any>;
  scanLibrary(libraryId: string): Promise<any>;
}
