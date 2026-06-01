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
  extraHeaders: Record<string, string>;
}

class ApiClient {
  private client: AxiosInstance | null = null;
  private config: ConnectionConfig | null = null;
  private provider: DataProvider | null = null;

  constructor() {
    // initialize must be called asynchronously at startup
  }

  // Load connection config based on platform
  public async initialize() {
    const isNative = Capacitor.isNativePlatform();

    if (isNative) {
      // Android: Load saved direct connection from Capacitor Preferences
      const url = await getItem("ABS_URL");
      const token = await getItem("ABS_TOKEN");
      const extraHeadersRaw = await getItem("ABS_EXTRA_HEADERS");

      let extraHeaders: Record<string, string> = {};
      if (extraHeadersRaw) {
        try {
          extraHeaders = JSON.parse(extraHeadersRaw);
        } catch {
          console.warn("ABS_EXTRA_HEADERS in storage is not valid JSON — ignoring.");
        }
      }

      if (url && token) {
        this.config = {
          url: url.endsWith("/") ? url.slice(0, -1) : url,
          token,
          extraHeaders,
        };

        this.provider = new DirectDataProvider(this.config.url, this.config.token, extraHeaders, true);

        this.client = axios.create({
          baseURL: `${this.config.url}/api`,
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            ...extraHeaders,
          },
        });
      } else {
        // Not configured yet — no saved credentials
        this.config = null;
        this.provider = null;
        this.client = null;
      }
    } else {
      // Web: Always use ServerDataProvider — server provides ABS connection via env
      const serverUrl = window.location.origin;

      this.config = {
        url: serverUrl,
        token: "",
        extraHeaders: {},
      };

      this.provider = new ServerDataProvider(serverUrl, "", {});

      this.client = axios.create({
        baseURL: "/gateway/api",
      });
    }

    if (this.client) {
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
  }

  public getProvider(): DataProvider | null {
    return this.provider;
  }

  public getConfig(): ConnectionConfig | null {
    return this.config;
  }

  // Save connection config (Android only — web uses server env)
  public async saveConnection(url: string, token: string, extraHeaders?: Record<string, string>) {
    const cleanUrl = url.endsWith("/") ? url.slice(0, -1) : url;
    await setItem("ABS_URL", cleanUrl);
    await setItem("ABS_TOKEN", token);
    if (extraHeaders && Object.keys(extraHeaders).length > 0) {
      await setItem("ABS_EXTRA_HEADERS", JSON.stringify(extraHeaders));
    } else {
      await removeItem("ABS_EXTRA_HEADERS");
    }
    // Clean up legacy key
    await removeItem("CONNECTION_MODE");
    await this.initialize();
  }

  // Clear credentials (Android only — web has no client-side credentials)
  public async disconnect() {
    await removeItem("ABS_URL");
    await removeItem("ABS_TOKEN");
    await removeItem("ABS_EXTRA_HEADERS");
    await removeItem("CONNECTION_MODE");
    await this.initialize();
  }

  // Get cover path dynamically based on platform
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
      if (isNative && this.config) {
        if (this.config.token) {
          headers["Authorization"] = `Bearer ${this.config.token}`;
        }
        const extraHeaders = this.config.extraHeaders || {};
        if (Object.keys(extraHeaders).length > 0) {
          Object.assign(headers, extraHeaders);
        }
      }
      // Web: no extra headers needed — gateway proxy handles auth
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
          await axios.get(`${this.config.url}/ping`, {
            timeout: 5000,
            headers: this.config.extraHeaders || {},
          });
        } else {
          return { ok: false, error: "No URL configured" };
        }
      } else {
        // Web: ping upstream ABS via the gateway proxy
        await axios.get("/gateway/ping", { timeout: 5000 });
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
