import axios, { AxiosInstance } from "axios";
import { MatchCandidate, Library, Book, User, Session, UserStats } from "../types";
import { getItem, setItem, removeItem } from "./storage";
import { Capacitor } from "@capacitor/core";
import { DataProvider } from "./data-provider";
import { ServerDataProvider } from "./server-data-provider";
import { DirectDataProvider } from "./direct-data-provider";

export interface ConnectionConfig {
  url: string;
  token: string;
  isDirect: boolean;
  extraHeaders: Record<string, string>;
}

class ApiClient {
  private client: AxiosInstance | null = null;
  private config: ConnectionConfig | null = null;
  private provider: DataProvider | null = null;

  constructor() {
    // initialize must be called asynchronously at startup
  }

  // Load connection config from storage or fallback to server env
  public async initialize() {
    const url = await getItem("ABS_URL");
    const token = await getItem("ABS_TOKEN");
    const extraHeadersRaw = await getItem("ABS_EXTRA_HEADERS");
    const connectionMode = await getItem("CONNECTION_MODE") || (url && token ? "direct" : "server");
    const isNative = Capacitor.isNativePlatform();

    let extraHeaders: Record<string, string> = {};
    if (extraHeadersRaw) {
      try {
        extraHeaders = JSON.parse(extraHeadersRaw);
      } catch {
        console.warn("ABS_EXTRA_HEADERS in storage is not valid JSON — ignoring.");
      }
    }

    if (url && connectionMode === "direct") {
      this.config = {
        url: url.endsWith("/") ? url.slice(0, -1) : url,
        token: token || "",
        isDirect: true,
        extraHeaders,
      };

      // Set up direct ABS provider with IndexedDB local caching
      this.provider = new DirectDataProvider(this.config.url, this.config.token, extraHeaders, isNative);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.config.token}`,
      };

      if (!isNative) {
        // Web: routes through /gateway
        headers["X-Target-URL"] = this.config.url;
        if (Object.keys(extraHeaders).length > 0) {
          headers["X-ABS-Extra-Headers"] = JSON.stringify(extraHeaders);
        }
      } else {
        // Native: direct
        Object.assign(headers, extraHeaders);
      }

      this.client = axios.create({
        baseURL: isNative ? `${this.config.url}/api` : "/gateway/api",
        headers,
      });
    } else if (url && connectionMode === "server") {
      // Custom ShelfLife Server connection
      this.config = {
        url: url.endsWith("/") ? url.slice(0, -1) : url,
        token: "",
        isDirect: false,
        extraHeaders,
      };

      this.provider = new ServerDataProvider(this.config.url, "", extraHeaders);

      const headers: Record<string, string> = {};
      if (!isNative) {
        if (Object.keys(extraHeaders).length > 0) {
          headers["X-ABS-Extra-Headers"] = JSON.stringify(extraHeaders);
        }
      } else {
        Object.assign(headers, extraHeaders);
      }

      this.client = axios.create({
        baseURL: isNative ? `${this.config.url}/api` : "/gateway/api",
        headers,
      });
    } else {
      // Proxy Mode Fallback (reads relative from server env via /gateway)
      this.config = {
        url: isNative ? "http://localhost" : window.location.origin,
        token: "",
        isDirect: false,
        extraHeaders,
      };

      const serverUrl = isNative ? "http://localhost" : window.location.origin;
      // Set up cached server provider
      this.provider = new ServerDataProvider(serverUrl, "", extraHeaders);

      const headers: Record<string, string> = {};
      if (!isNative) {
        if (Object.keys(extraHeaders).length > 0) {
          headers["X-ABS-Extra-Headers"] = JSON.stringify(extraHeaders);
        }
      } else {
        Object.assign(headers, extraHeaders);
      }

      this.client = axios.create({
        baseURL: isNative ? "http://localhost/api" : "/gateway/api",
        headers,
      });
    }

    this.client.interceptors.response.use((response) => {
      const contentType = response.headers?.['content-type'];
      const contentTypeStr = typeof contentType === 'string' ? contentType : '';
      if (
        contentTypeStr.includes('text/html') ||
        (typeof response.data === 'string' && response.data.trim().startsWith('<!DOCTYPE'))
      ) {
        throw new Error('Upstream returned HTML instead of JSON. This typically indicates a Cloudflare Access or authentication gateway challenge.');
      }
      return response;
    });
  }

  public getProvider(): DataProvider | null {
    return this.provider;
  }

  public getConfig(): ConnectionConfig | null {
    return this.config;
  }

  public isDirectMode(): boolean {
    return !!this.config?.isDirect;
  }

  // Save connection config (supports both direct and server modes)
  public async saveConnection(url: string, token: string, extraHeaders?: Record<string, string>, connectionMode: "direct" | "server" = "direct") {
    const cleanUrl = url.endsWith("/") ? url.slice(0, -1) : url;
    await setItem("ABS_URL", cleanUrl);
    await setItem("CONNECTION_MODE", connectionMode);
    if (connectionMode === "direct") {
      await setItem("ABS_TOKEN", token);
    } else {
      await removeItem("ABS_TOKEN");
    }
    if (extraHeaders && Object.keys(extraHeaders).length > 0) {
      await setItem("ABS_EXTRA_HEADERS", JSON.stringify(extraHeaders));
    } else {
      await removeItem("ABS_EXTRA_HEADERS");
    }
    await this.initialize();
  }

  // Save extra headers separately (e.g. from Settings)
  public async saveExtraHeaders(extraHeaders: Record<string, string>) {
    if (Object.keys(extraHeaders).length > 0) {
      await setItem("ABS_EXTRA_HEADERS", JSON.stringify(extraHeaders));
    } else {
      await removeItem("ABS_EXTRA_HEADERS");
    }
    await this.initialize();
  }

  // Clear credentials (logout)
  public async disconnect() {
    await removeItem("ABS_URL");
    await removeItem("ABS_TOKEN");
    await removeItem("ABS_EXTRA_HEADERS");
    await removeItem("CONNECTION_MODE");
    await this.initialize();
  }

  // Get cover path dynamically based on connection mode
  public getCoverPath(itemId: string): string {
    const isNative = Capacitor.isNativePlatform();
    if (isNative && this.config?.url) {
      return `${this.config.url}/api/items/${itemId}/cover`;
    }
    return `/gateway/api/items/${itemId}/cover`;
  }

  // Fetch cover as secure blob URL with proper credentials in headers
  public async fetchCoverAsBlob(itemId: string): Promise<string | null> {
    const isNative = Capacitor.isNativePlatform();
    const coverPath = this.getCoverPath(itemId);
    try {
      const headers: Record<string, string> = {};
      if (!isNative) {
        // Web: through gateway
        if (this.config?.isDirect && this.config.url) {
          headers["X-Target-URL"] = this.config.url;
          if (this.config.token) {
            headers["Authorization"] = `Bearer ${this.config.token}`;
          }
        }
        const extraHeaders = this.config?.extraHeaders || {};
        if (Object.keys(extraHeaders).length > 0) {
          headers["X-ABS-Extra-Headers"] = JSON.stringify(extraHeaders);
        }
      } else {
        // Native: direct request
        if (this.config?.token) {
          headers["Authorization"] = `Bearer ${this.config.token}`;
        }
        const extraHeaders = this.config?.extraHeaders || {};
        if (Object.keys(extraHeaders).length > 0) {
          Object.assign(headers, extraHeaders);
        }
      }
      const response = await fetch(coverPath, { headers });
      if (!response.ok) return null;
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error("Failed to fetch cover as blob:", err);
      return null;
    }
  }

  // Health check to test if server is reachable
  public async checkHealth(): Promise<{ error?: string; ok: boolean }> {
    if (!this.client) {
      return { ok: false, error: "API client not initialized" };
    }

    const isNative = Capacitor.isNativePlatform();

    try {
      if (isNative) {
        if (this.config?.url) {
          const extraHeaders = this.config?.extraHeaders || {};
          const isDirectMode = this.config.isDirect;
          const pingUrl = isDirectMode ? `${this.config.url}/ping` : `${this.config.url}/api/ping`;
          await axios.get(pingUrl, {
            timeout: 5000,
            headers: extraHeaders,
          });
        } else {
          return { ok: false, error: "No URL configured" };
        }
      } else {
        // Web: ping the target via the gateway
        const headers: Record<string, string> = {};
        if (this.config?.isDirect && this.config.url) {
          headers["X-Target-URL"] = this.config.url;
        }
        const extraHeaders = this.config?.extraHeaders || {};
        if (Object.keys(extraHeaders).length > 0) {
          headers["X-ABS-Extra-Headers"] = JSON.stringify(extraHeaders);
        }
        await axios.get("/gateway/ping", {
          timeout: 5000,
          headers,
        });
      }

      // Test credentials/token by loading libraries
      await this.client.get("/libraries", { timeout: 5000 });
      return { ok: true };
    } catch (err: any) {
      console.error("Health check error:", err);
      const msg = err.response?.status === 401 
        ? "Unauthorized: Invalid API Token." 
        : err.message || "Network Error";
      return { ok: false, error: msg };
    }
  }

  // DELEGATED DATA PROVIDER METHODS FOR COMPATIBILITY

  public async getLibraries(): Promise<Library[]> {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.getLibraries();
  }

  public async getUsers(): Promise<User[]> {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.getUsers();
  }

  public async getOnlineUsers(): Promise<any> {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.getOnlineUsers();
  }

  public async getSessions(params: any): Promise<{ sessions: Session[]; total?: number }> {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.getSessions(params);
  }

  public async getLibraryItems(libraryId: string, params?: any) {
    if (!this.provider) throw new Error("Provider not initialized");
    
    // Map traditional client query fields to structural query params
    const query = {
      libraryId,
      search: params?.search,
      sort: params?.sort,
      order: params?.order || (params?.desc === "1" || params?.desc === true ? "desc" : "asc"),
      page: params?.page || 0,
      limit: params?.limit || 20
    };
    
    return this.provider.getLibraryItems(query);
  }

  public async getLibraryStats(libraryId: string): Promise<any> {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.getLibraryStats(libraryId);
  }

  public async scanLibrary(libraryId: string): Promise<any> {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.scanLibrary(libraryId);
  }

  // Get running/active tasks from ABS
  public async getTasks() {
    if (!this.client) throw new Error("Client not initialized");
    const response = await this.client.get("/tasks");
    return response.data;
  }

  public async matchLibraryItem(itemId: string, matchData?: MatchCandidate) {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.matchLibraryItem(itemId, matchData);
  }

  public async searchMatches(itemId: string, provider: string, title: string, author?: string): Promise<MatchCandidate[]> {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.searchMatches(itemId, provider, title, author);
  }

  public async getRecentItems(limit = 10): Promise<{ results: Book[]; totalBooks: number }> {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.getRecentItems(limit);
  }

  public async getItemDetails(itemId: string) {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.getItemDetails(itemId);
  }

  public async lookupChapters(asin: string, region?: string) {
    const params: Record<string, string> = {};
    if (region) params.region = region;
    const response = await axios.get(`https://api.audnex.us/books/${asin}/chapters`, { params });
    return response.data;
  }

  public async updateChapters(itemId: string, chapters: any[]) {
    if (!this.client) throw new Error("Client not initialized");
    const response = await this.client.post(`/items/${itemId}/chapters`, { chapters });
    return response.data;
  }

  // Cache specific methods
  
  public async getUserStats(): Promise<UserStats[]> {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.getUserStats();
  }

  public async getDashboardStats(timeframe?: string): Promise<any> {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.getDashboardStats(timeframe);
  }

  public async getSyncStatus() {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.getSyncStatus();
  }

  public async triggerSync(libraryId?: string, forceFull = false, awaitSync = true) {
    if (!this.provider) throw new Error("Provider not initialized");
    return this.provider.triggerSync(libraryId, forceFull, awaitSync);
  }
}

export const api = new ApiClient();
