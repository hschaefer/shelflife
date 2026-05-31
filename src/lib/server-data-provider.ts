import axios, { AxiosInstance } from 'axios';
import { DataProvider, LibraryItemsQuery, LibraryItemsResponse, SyncStatus } from './data-provider';
import { Library, Book, User, Session, UserStats } from '../types';

export class ServerDataProvider implements DataProvider {
  private cacheClient: AxiosInstance;
  private gatewayClient: AxiosInstance;

  constructor(serverUrl: string, token?: string, extraHeaders?: Record<string, string>) {
    const isRelative = !serverUrl.startsWith('http://') && !serverUrl.startsWith('https://');
    
    // Config for ShelfLife's cache API endpoints (/api)
    const cacheBase = isRelative ? '/api' : `${serverUrl}/api`;
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (extraHeaders) {
      Object.assign(headers, extraHeaders);
    }

    this.cacheClient = axios.create({
      baseURL: cacheBase,
      headers
    });

    // Config for passthrough requests via proxy (/gateway/api)
    const gatewayBase = isRelative ? '/gateway/api' : `${serverUrl}/gateway/api`;
    const gatewayHeaders: Record<string, string> = { ...headers };
    
    // Inject Target URL headers if we are using custom URL in browser mode
    if (isRelative && serverUrl && serverUrl !== window.location.origin) {
      gatewayHeaders['X-Target-URL'] = serverUrl;
    }

    this.gatewayClient = axios.create({
      baseURL: gatewayBase,
      headers: gatewayHeaders
    });
  }

  public async getLibraries(): Promise<Library[]> {
    const response = await this.cacheClient.get('/libraries');
    return response.data?.libraries || response.data || [];
  }

  public async getLibraryItems(query: LibraryItemsQuery): Promise<LibraryItemsResponse> {
    const response = await this.cacheClient.get(`/libraries/${query.libraryId}/items`, {
      params: {
        search: query.search,
        sort: query.sort,
        order: query.order,
        page: query.page,
        limit: query.limit
      }
    });
    return response.data;
  }

  public async getLibraryStats(libraryId: string): Promise<any> {
    const response = await this.cacheClient.get(`/libraries/${libraryId}/stats`);
    return response.data;
  }

  public async getRecentItems(limit = 10): Promise<{ results: Book[]; totalBooks: number }> {
    const response = await this.cacheClient.get('/items/recent', {
      params: { limit }
    });
    return response.data;
  }

  public async getSessions(params: any): Promise<{ sessions: Session[]; total?: number }> {
    const response = await this.cacheClient.get('/sessions', { params });
    return response.data;
  }

  public async getOnlineUsers(): Promise<any> {
    // Online status is highly real-time, fetch from proxy gateway
    const response = await this.gatewayClient.get('/users/online');
    return response.data;
  }

  public async getUsers(): Promise<User[]> {
    const response = await this.gatewayClient.get('/users');
    return response.data?.users || response.data || [];
  }

  public async getUserStats(): Promise<UserStats[]> {
    const response = await this.cacheClient.get('/users/stats');
    return response.data;
  }

  public async getDashboardStats(timeframe?: string): Promise<any> {
    const response = await this.cacheClient.get('/stats/dashboard', {
      params: { timeframe }
    });
    return response.data;
  }

  public async getSyncStatus(): Promise<SyncStatus | null> {
    try {
      const response = await this.cacheClient.get('/sync/status');
      return response.data;
    } catch {
      return null;
    }
  }

  public async triggerSync(libraryId?: string, forceFull = false, awaitSync = true): Promise<any> {
    const response = await this.cacheClient.post('/sync', {
      libraryId,
      forceFull,
      awaitSync
    });
    return response.data;
  }

  // Pass-through Direct ABS operations (route via proxy)
  public async getItemDetails(itemId: string): Promise<any> {
    const response = await this.gatewayClient.get(`/items/${itemId}`);
    return response.data;
  }

  public async matchLibraryItem(itemId: string, matchData?: any): Promise<any> {
    const response = await this.gatewayClient.post(`/items/${itemId}/match`, matchData);
    return response.data;
  }

  public async searchMatches(itemId: string, provider: string, title: string, author?: string): Promise<any> {
    const response = await this.gatewayClient.get(`/items/${itemId}/match/search`, {
      params: { provider, title, author }
    });
    return response.data;
  }

  public async scanLibrary(libraryId: string): Promise<any> {
    const response = await this.gatewayClient.post(`/libraries/${libraryId}/scan?force=1`);
    return response.data;
  }
}
