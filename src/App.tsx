import { useEffect, useState, useMemo } from "react";
import { TextZoom } from "@capacitor/text-zoom";
import { 
  Users, 
  Library as LibraryIcon, 
  BarChart3, 
  Activity,
  Settings,
  Bell,
  User as UserIcon,
  Menu,
  X,
  AlertCircle,
  RefreshCcw,
  Sun,
  Moon
} from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "motion/react";

import { 
  Library, 
  User, 
  Session, 
  UserStats, 
  Book 
} from "./types";
import { DashboardView } from "./components/DashboardView";
import { UsersView } from "./components/UsersView";
import { LibraryView } from "./components/LibraryView";
import { SettingsView } from "./components/SettingsView";
import { ConnectionScreen } from "./components/ConnectionScreen";
import { api } from "./lib/api";
import { cn } from "./lib/utils";
import logoLight from "../assets/icon.svg";
import logoDark from "../assets/icon-dark.svg";

const NAV_ITEMS = [
  { id: 'dashboard', icon: BarChart3, label: 'Dashboard' },
  { id: 'users', icon: Users, label: 'Listeners' },
  { id: 'library', icon: LibraryIcon, label: 'Libraries' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Theme configuration
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("theme");
      if (saved) return saved === "dark";
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return false;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
      const meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) meta.setAttribute("content", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
      const meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) meta.setAttribute("content", "light");
    }
  }, [darkMode]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      const saved = localStorage.getItem("theme");
      if (!saved) {
        setDarkMode(e.matches);
      }
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Connection state
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);

  // Data state
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [totalBooks, setTotalBooks] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  
  // Dashboard aggregated stats cache state
  const [dashboardStats, setDashboardStats] = useState<any>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardTimeframe, setDashboardTimeframe] = useState<string>("30");

  async function fetchDashboardStats(tf: string) {
    try {
      setDashboardLoading(true);
      const stats = await api.getDashboardStats(tf);
      setDashboardStats(stats);
    } catch (err) {
      console.error("Failed to fetch dashboard stats:", err);
    } finally {
      setDashboardLoading(false);
    }
  }

  async function fetchSessions(isInitial = false) {
    try {
      setSessionsLoading(true);
      const sessionRes = await api.getSessions({
        limit: 500,
        sort: "startedAt",
        desc: "1"
      });
      const allSessions = sessionRes && Array.isArray(sessionRes.sessions) 
        ? sessionRes.sessions 
        : (Array.isArray(sessionRes) ? sessionRes : []);
      setSessions(allSessions);

      // Fetch user stats pre-aggregated from cache
      const stats = await api.getUserStats();
      setUserStats(stats);

      // Fetch sync status
      const status = await api.getSyncStatus();
      setSyncStatus(status);
    } catch (err) {
      console.error("Failed to fetch listening sessions:", err);
    } finally {
      setSessionsLoading(false);
      setRefreshing(false);
    }
  }

  async function fetchData(isInitial = false) {
    try {
      if (isInitial) {
        setLoading(true);
        setSessionsLoading(true);
        setDashboardLoading(true);
      } else {
        setRefreshing(true);
      }
      
      setError(null);

      // Fetch fast primary items first, excluding slow sessions call
      const [libData, userData, recentData, onlineData, dashboardData] = await Promise.all([
        api.getLibraries(),
        api.getUsers(),
        api.getRecentItems(),
        api.getOnlineUsers(),
        api.getDashboardStats(dashboardTimeframe)
      ]);

      const libs = Array.isArray(libData) ? libData : [];
      setLibraries(libs);

      const rawUsers = Array.isArray(userData) ? userData : [];
      setUsers(rawUsers);

      setDashboardStats(dashboardData);
      setDashboardLoading(false);
      
      const usersOnline = onlineData && Array.isArray(onlineData.usersOnline) 
        ? onlineData.usersOnline 
        : (Array.isArray(onlineData) ? onlineData : []);

      const userMap: Record<string, string> = {};
      rawUsers.forEach((u: any) => { if (u && u.id) userMap[u.id] = u.username || u.id; });
      usersOnline.forEach((u: any) => { if (u && u.id && !userMap[u.id]) userMap[u.id] = u.username || u.id; });

      const STALE_THRESHOLD = 10 * 60 * 1000;
      const isRecentlyActive = (s: any) => {
        if (s.updatedAt) return (Date.now() - s.updatedAt) < STALE_THRESHOLD;
        return (Date.now() - (s.startedAt + (s.timeListening || 0) * 1000)) < STALE_THRESHOLD;
      };

      const openSessions = (onlineData.openSessions || [])
        .filter(isRecentlyActive)
        .map((s: any) => ({
          ...s,
          username: s.username || userMap[s.userId] || s.userId,
        }));
      setActiveSessions(openSessions);
      
      const items = recentData.results || [];
      setBooks(items);
      setTotalBooks(recentData.totalBooks || 0);

      // Shell loaded immediately
      setLoading(false);

      // Asynchronously trigger lazy-loading of sessions
      fetchSessions(isInitial);
    } catch (err: any) {
      console.error(err);
      setError("Failed to connect to Audiobookshelf. Please check your credentials or network.");
      setLoading(false);
      setSessionsLoading(false);
      setDashboardLoading(false);
      setRefreshing(false);
    }
  }

  // Sync OS Accessibility text zoom preferences with Root Font Size
  useEffect(() => {
    async function initTextZoom() {
      try {
        const { value } = await TextZoom.getPreferred();
        const isMobile = window.innerWidth <= 768;
        const baseSize = isMobile ? 18 : 16;
        document.documentElement.style.fontSize = `${baseSize * value}px`;
      } catch (err) {
        console.warn("Capacitor TextZoom not supported or failed to load:", err);
      }
    }
    
    initTextZoom();

    let watchId: any;
    async function watchTextZoom() {
      try {
        const textZoomAny = TextZoom as any;
        if (typeof textZoomAny.addListener === "function") {
          watchId = await textZoomAny.addListener("textZoomDidChange", (data: any) => {
            const isMobile = window.innerWidth <= 768;
            const baseSize = isMobile ? 18 : 16;
            document.documentElement.style.fontSize = `${baseSize * data.value}px`;
          });
        }
      } catch (err) {
        console.debug("Capacitor textZoomDidChange listener not supported:", err);
      }
    }
    watchTextZoom();

    return () => {
      if (watchId && typeof watchId.remove === "function") {
        watchId.remove();
      }
    };
  }, []);

  // Handle Startup Connection Discovery
  useEffect(() => {
    async function discoverConnection() {
      await api.initialize();
      const conn = api.getConfig();
      if (conn?.isDirect) {
        setIsConfigured(true);
        fetchData(true);
      } else {
        // If not direct, see if the Node proxy server is running and healthy
        const health = await api.checkHealth();
        if (health.ok) {
          setIsConfigured(true);
          fetchData(true);
        } else {
          // If proxy fails, we boot to the manual onboarding interface
          setIsConfigured(false);
        }
      }
    }
    discoverConnection();
  }, []);

  // Set up periodic session refresher once verified configured
  useEffect(() => {
    if (!isConfigured) return;

    const interval = setInterval(async () => {
      try {
        const onlineData = await api.getOnlineUsers();
        const onlineUserMap: Record<string, string> = {};
        const onlineUsersArray = onlineData && Array.isArray(onlineData.usersOnline) 
          ? onlineData.usersOnline 
          : (Array.isArray(onlineData) ? onlineData : []);
        onlineUsersArray.forEach((u: any) => { if (u && u.id) onlineUserMap[u.id] = u.username || u.id; });
        // Merge with existing userMap from state
        if (Array.isArray(users)) {
          users.forEach(u => { if (u && u.id && !onlineUserMap[u.id]) onlineUserMap[u.id] = u.username || u.id; });
        }
        const STALE_THRESHOLD = 10 * 60 * 1000;
        const isRecentlyActive = (s: any) => {
          if (!s) return false;
          if (s.updatedAt) return (Date.now() - s.updatedAt) < STALE_THRESHOLD;
          return (Date.now() - (s.startedAt + (s.timeListening || 0) * 1000)) < STALE_THRESHOLD;
        };
        const openSessionsArray = onlineData && Array.isArray(onlineData.openSessions) ? onlineData.openSessions : [];
        const openSessions = openSessionsArray
          .filter(isRecentlyActive)
          .map((s: any) => ({
            ...s,
            username: s.username || onlineUserMap[s.userId] || s.userId,
          }));
        setActiveSessions(openSessions);
      } catch (e) {
        console.error("Failed to refresh active sessions", e);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isConfigured, users]);

  // Aggregate User Stats for both Dashboard and Users View


  if (isConfigured === null) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center font-sans">
        <div className="text-center">
          <Activity className="animate-spin mb-4 text-indigo-600 mx-auto" size={48} />
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">Initializing ShelfLife...</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm font-medium">Analyzing environment parameters.</p>
        </div>
      </div>
    );
  }

  if (isConfigured === false) {
    return <ConnectionScreen isDark={darkMode} onSuccess={() => {
      setIsConfigured(true);
      fetchData(true);
    }} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center font-sans">
        <div className="text-center">
          <Activity className="animate-spin mb-4 text-indigo-600 mx-auto" size={48} />
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">Synchronizing Dashboard...</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm font-medium">Hold on, we're fetching your audiobooks data.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl shadow-xl border border-slate-200 dark:border-slate-800 p-10 text-center">
          <div className="w-20 h-20 bg-red-50 dark:bg-red-950/20 text-red-500 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle size={40} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-4">Connection Blocked</h2>
          <p className="text-slate-600 dark:text-slate-400 mb-8 leading-relaxed">
            {error}
          </p>
          <div className="flex flex-col gap-3">
            <button 
              onClick={async () => {
                await api.disconnect();
                setIsConfigured(false);
                setError(null);
              }}
              className="w-full py-3 bg-indigo-600 text-white rounded-2xl text-[11px] font-bold uppercase tracking-widest hover:bg-indigo-700 transition-colors shadow-md"
            >
              Reconfigure Connection
            </button>
            <button 
              onClick={() => fetchData(true)}
              className="w-full py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-2xl text-[11px] font-bold uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              Retry Connection
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex selection:bg-indigo-100 selection:text-indigo-900 dark:selection:bg-indigo-950/40 dark:selection:text-indigo-200">
      {/* Sidebar - Desktop Only */}
      <aside className="hidden lg:flex h-screen border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex-col sticky top-0 z-50 shrink-0 w-[240px]">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-10">
            <motion.img 
              src={darkMode ? logoDark : logoLight} 
              alt="ShelfLife Logo" 
              className="w-10 h-10 object-contain cursor-pointer"
              whileHover={{ scale: 1.08, rotate: 3 }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            />
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Shelf<span className="text-indigo-600 dark:text-indigo-400">Life</span></h1>
          </div>
          
          <nav className="space-y-1">
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold uppercase tracking-tight transition-all cursor-pointer",
                  activeTab === item.id 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 dark:shadow-none' 
                    : 'text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-100'
                )}
              >
                <item.icon size={16} />
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-grow flex flex-col min-h-screen min-w-0 pb-20 lg:pb-0">
        {/* Top Header */}
        <header className="h-14 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl sticky top-0 z-40 px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex lg:hidden items-center gap-2 mr-2">
              <motion.img 
                src={darkMode ? logoDark : logoLight} 
                alt="ShelfLife Logo" 
                className="w-7 h-7 object-contain cursor-pointer"
                whileHover={{ scale: 1.08, rotate: 3 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
              />
              <h1 className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">Shelf<span className="text-indigo-600 dark:text-indigo-400">Life</span></h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            {syncStatus && syncStatus.lastSync > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 rounded-lg text-[10px] font-bold text-slate-500 dark:text-slate-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="uppercase tracking-wider">
                  DB Cache Synced
                </span>
              </div>
            )}
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all shadow-sm cursor-pointer"
              title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
              aria-label="Toggle theme"
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button 
              onClick={() => fetchData()}
              disabled={refreshing}
              className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-all shadow-sm disabled:opacity-50"
              title="Refresh Data"
            >
              <RefreshCcw size={18} className={cn(refreshing && "animate-spin")} />
            </button>
          </div>
        </header>

        {/* Dynamic Content Area */}
        <section className="p-6 max-w-[1600px] mx-auto w-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              {activeTab === 'dashboard' && (
                <DashboardView 
                  recentBooks={books}
                  totalBooks={totalBooks}
                  dashboardStats={dashboardStats}
                  dashboardLoading={dashboardLoading}
                  dashboardTimeframe={dashboardTimeframe}
                  onTimeframeChange={(tf) => {
                    setDashboardTimeframe(tf);
                    fetchDashboardStats(tf);
                  }}
                  userStats={userStats}
                  libraries={libraries}
                  activeSessions={activeSessions}
                  isDark={darkMode}
                />
              )}
              {activeTab === 'users' && (
                <UsersView 
                  users={users}
                  sessions={sessions}
                  userStats={userStats}
                  books={books}
                  sessionsLoading={sessionsLoading}
                  isDark={darkMode}
                />
              )}
              {activeTab === 'library' && (
                <LibraryView 
                  books={books}
                  libraries={libraries}
                  isDark={darkMode}
                />
              )}
              {activeTab === 'settings' && (
                <SettingsView 
                  onDisconnect={async () => {
                    await api.disconnect();
                    setIsConfigured(false);
                    setActiveTab("dashboard");
                  }} 
                  onHeadersSaved={async () => {
                    await fetchData(true);
                  }}
                  darkMode={darkMode}
                  setDarkMode={setDarkMode}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </section>
        {/* Bottom Navigation - Mobile Only */}
        <nav className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm bg-indigo-100/80 dark:bg-indigo-900/50 backdrop-blur-2xl border border-white/80 dark:border-indigo-950/80 rounded-3xl shadow-lg shadow-indigo-950/5 dark:shadow-2xl dark:shadow-black/40 z-50 p-2 flex items-center justify-around">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "flex flex-col items-center gap-1 p-2 min-w-[64px] rounded-xl transition-all relative cursor-pointer",
                activeTab === item.id 
                  ? 'text-indigo-950 dark:text-white font-black' 
                  : 'text-indigo-800/80 dark:text-indigo-200/85'
              )}
            >
              {activeTab === item.id && (
                <motion.div 
                  layoutId="bottomNavTab"
                  className="absolute inset-0 bg-white/95 dark:bg-indigo-950/70 rounded-xl -z-10 shadow-sm"
                />
              )}
              <item.icon size={20} />
              <span className="text-[10px] font-bold uppercase tracking-tighter">{item.label}</span>
            </button>
          ))}
        </nav>
      </main>
    </div>
  );
}
