import { useMemo, useState, useEffect } from "react";
import { 
  Activity, Play, User as UserIcon,
  ChevronDown, ChevronRight, PenTool, Compass, Tags, Search, BookOpen
} from "lucide-react";
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, BarChart, Bar
} from "recharts";
import { format, subDays, isAfter, formatDistanceToNow } from "date-fns";
import { 
  Library, User, Session, UserStats, Book 
} from "../types";

import { UserStatsList } from "./UserStatsList";
import { RecentItems } from "./RecentItems";
import { formatDuration, cn, formatTotalTime } from "../lib/utils";
import { BookDetailsModal } from "./BookDetailsModal";
import { AnimatePresence } from "motion/react";
import { CoverImage } from "./CoverImage";
import { Capacitor } from "@capacitor/core";

interface DashboardViewProps {
  recentBooks: Book[];
  totalBooks: number;
  dashboardStats: any;
  dashboardLoading: boolean;
  dashboardTimeframe: "7" | "30" | "365" | "all";
  onTimeframeChange: (timeframe: "7" | "30" | "365" | "all") => void;
  userStats: UserStats[];
  libraries: Library[];
  activeSessions: Session[];
  isDark?: boolean;
}

export function DashboardView({ 
  recentBooks, 
  totalBooks, 
  dashboardStats, 
  dashboardLoading, 
  dashboardTimeframe, 
  onTimeframeChange, 
  userStats, 
  libraries, 
  activeSessions, 
  isDark = false
}: DashboardViewProps) {
  const isAndroid = Capacitor.getPlatform() === 'android';
  const [chartType, setChartType] = useState<'line' | 'bar'>('bar');
  const timeframe = dashboardTimeframe;
  const setTimeframe = onTimeframeChange;
  const [recentActivityWindow, setRecentActivityWindow] = useState<'1' | '7'>('7');
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({});
  const [selectedBookForDetails, setSelectedBookForDetails] = useState<Book | null>(null);
  const [initialModalTab, setInitialModalTab] = useState<'details' | 'match' | 'chapters'>('details');
  
  // States for search
  const [livePlaybackSearch, setLivePlaybackSearch] = useState("");
  const [recentActivitySearch, setRecentActivitySearch] = useState("");

  const filteredActiveSessions = useMemo(() => {
    if (!livePlaybackSearch.trim()) return activeSessions;
    const query = livePlaybackSearch.toLowerCase();
    return activeSessions.filter(s => {
      const username = (s.username || "").toLowerCase();
      const title = (s.displayTitle || s.mediaItemTitle || "").toLowerCase();
      return username.includes(query) || title.includes(query);
    });
  }, [activeSessions, livePlaybackSearch]);

  const topAuthors = useMemo(() => {
    return dashboardStats?.topAuthors || [];
  }, [dashboardStats]);

  const topGenres = useMemo(() => {
    return dashboardStats?.topGenres || [];
  }, [dashboardStats]);

  const getGenreStyle = (genre: string) => {
    const styles = [
      { bg: "from-pink-500 to-rose-500", text: "text-rose-600", lightBg: "bg-rose-50 border-rose-100", barBg: "bg-rose-500" },
      { bg: "from-amber-500 to-orange-500", text: "text-orange-600", lightBg: "bg-orange-50 border-orange-100", barBg: "bg-orange-500" },
      { bg: "from-emerald-500 to-teal-500", text: "text-emerald-600", lightBg: "bg-emerald-50 border-emerald-100", barBg: "bg-emerald-500" },
      { bg: "from-blue-500 to-indigo-500", text: "text-indigo-600", lightBg: "bg-indigo-50 border-indigo-100", barBg: "bg-indigo-500" },
      { bg: "from-violet-500 to-purple-500", text: "text-purple-600", lightBg: "bg-purple-50 border-purple-100", barBg: "bg-purple-500" },
    ];
    let hash = 0;
    for (let i = 0; i < genre.length; i++) {
      hash = genre.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % styles.length;
    return styles[index];
  };

  const lineChartData = useMemo(() => {
    return dashboardStats?.lineChartData || [];
  }, [dashboardStats]);

  const hourlyActivityData = useMemo(() => {
    return dashboardStats?.hourlyActivityData || [];
  }, [dashboardStats]);

  const toggleUserExpanded = (userId: string) => {
    setExpandedUsers(prev => {
      const currentlyExpanded = prev[userId] !== false;
      return {
        ...prev,
        [userId]: !currentlyExpanded
      };
    });
  };

  const last7DaysActivitiesGrouped = useMemo(() => {
    if (!dashboardStats) return [];
    return recentActivityWindow === '1'
      ? (dashboardStats.recentActivity1d || [])
      : (dashboardStats.recentActivity7d || []);
  }, [dashboardStats, recentActivityWindow]);

  const filteredRecentActivityGrouped = useMemo(() => {
    if (!recentActivitySearch.trim()) return last7DaysActivitiesGrouped;
    const query = recentActivitySearch.toLowerCase();
    return last7DaysActivitiesGrouped.filter(user => {
      const username = (user.username || "").toLowerCase();
      const matchUsername = username.includes(query);
      const matchBooks = user.uniqueBooks.some(b => 
        b.title.toLowerCase().includes(query)
      );
      return matchUsername || matchBooks;
    });
  }, [last7DaysActivitiesGrouped, recentActivitySearch]);

  const getSessionBookInfo = (session: Session) => {
    const itemId = session.libraryItemId;
    const progressPercent = session.progress !== undefined 
      ? Math.round(session.progress * 100) 
      : (session.currentTime && session.duration 
        ? Math.round((session.currentTime / session.duration) * 100) 
        : null);
    return { itemId, progressPercent };
  };

  return (
    <div className="flex flex-col gap-4">



      {/* Live Playback and Recent Activity Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className={cn(
          "bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col transition-all duration-300",
          filteredActiveSessions.length <= 1 
            ? "h-auto min-h-[180px] lg:h-[400px]" 
            : "h-[400px]"
        )}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 px-2 shrink-0 gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">
                Live Playback <span className="font-extrabold text-indigo-600 dark:text-indigo-400">({activeSessions.length})</span>
              </h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">Direct stream activity</p>
            </div>
            {activeSessions.length > 5 && (
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-1 rounded-xl w-full sm:w-44 focus-within:ring-2 focus-within:ring-indigo-100/50 dark:focus-within:ring-indigo-950/50 focus-within:border-indigo-400 dark:focus-within:border-indigo-500 transition-all shrink-0">
                <Search size={10} className="text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Filter streams..." 
                  value={livePlaybackSearch}
                  onChange={(e) => setLivePlaybackSearch(e.target.value)}
                  className="bg-transparent border-none text-[9px] font-semibold focus:ring-0 placeholder:text-slate-400 dark:placeholder:text-slate-500 w-full outline-none text-slate-900 dark:text-slate-100 p-0"
                />
              </div>
            )}
          </div>
          
          <div className="flex-grow overflow-y-auto no-scrollbar flex flex-col gap-3 pr-1">
            {filteredActiveSessions.map((session) => (
              <div key={session.id} className="p-3 rounded-xl border border-indigo-100 dark:border-indigo-950/40 bg-indigo-50/40 dark:bg-indigo-950/20 flex flex-col gap-2 relative overflow-hidden group shrink-0">
                <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:scale-125 transition-transform">
                  <Activity size={32} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 overflow-hidden">
                    <UserIcon size={14} />
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">{session.username}</p>
                    <p className="text-[9px] text-indigo-600 dark:text-indigo-400 font-semibold uppercase">Now Listening</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{session.displayTitle || session.mediaItemTitle}</p>
                  <div className="flex items-center justify-between mt-0.5">
                    <p className="text-[9px] font-medium text-slate-500 dark:text-slate-400">Live for {formatDuration(Date.now() / 1000 - session.startedAt / 1000)}</p>
                    {session.progress !== undefined && (
                      <p className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400">{Math.round(session.progress * 100)}%</p>
                    )}
                  </div>
                </div>
                <div className="w-full bg-indigo-100 dark:bg-indigo-950 rounded-full h-0.5 mt-1">
                  <div 
                    className="bg-indigo-600 dark:bg-indigo-500 h-0.5 rounded-full animate-pulse transition-all duration-1000" 
                    style={{ width: `${(session.progress || 0) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
            {filteredActiveSessions.length === 0 && (
              <div className="flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2 py-12 flex-grow">
                <div className="w-10 h-10 bg-slate-50 dark:bg-slate-800/40 rounded-full flex items-center justify-center opacity-60">
                  <Play size={18} className="text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {activeSessions.length === 0 ? "Silence reigns" : "No results"}
                  </p>
                  <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mt-1">
                    {activeSessions.length === 0 
                      ? "No active sessions at the moment." 
                      : "No active sessions matching your query."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={cn(
          "bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col transition-all duration-300",
          (dashboardLoading || filteredRecentActivityGrouped.length > 1)
            ? "h-[400px]" 
            : "h-auto min-h-[180px] lg:h-[400px]"
        )}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 px-2 shrink-0 gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">
                Recent Activity ({recentActivityWindow === '1' ? '24 Hours' : '7 Days'})
              </h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">User engagement &amp; book summaries</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
                {([{ label: '24H', value: '1' }, { label: '7D', value: '7' }] as const).map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setRecentActivityWindow(opt.value)}
                    className={`px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all cursor-pointer ${
                      recentActivityWindow === opt.value
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {last7DaysActivitiesGrouped.length > 5 && (
                <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-1 rounded-xl w-full sm:w-44 focus-within:ring-2 focus-within:ring-indigo-100/50 dark:focus-within:ring-indigo-950/50 focus-within:border-indigo-400 dark:focus-within:border-indigo-500 transition-all">
                  <Search size={10} className="text-slate-400" />
                  <input 
                    type="text" 
                    placeholder="Filter recent..." 
                    value={recentActivitySearch}
                    onChange={(e) => setRecentActivitySearch(e.target.value)}
                    className="bg-transparent border-none text-[9px] font-semibold focus:ring-0 placeholder:text-slate-400 dark:placeholder:text-slate-500 w-full outline-none text-slate-900 dark:text-slate-100 p-0"
                  />
                </div>
              )}
            </div>
          </div>
          
          <div className="flex-grow overflow-y-auto no-scrollbar flex flex-col gap-3 pr-1">
            {dashboardLoading ? (
              Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="flex flex-col gap-2 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/10 animate-pulse select-none">
                  {/* Pulsing User identity row */}
                  <div className="flex items-center justify-between px-2 py-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
                      <div className="w-16 h-3 bg-slate-200 dark:bg-slate-800 rounded shrink-0" />
                    </div>
                    <div className="w-12 h-4 bg-slate-100 dark:bg-slate-800 rounded-full" />
                  </div>
                  {/* Pulsing sub-book items */}
                  <div className="flex flex-col gap-1.5 px-1 pb-1">
                    {Array.from({ length: 2 }).map((_, bIdx) => (
                      <div key={bIdx} className="flex items-center gap-3 p-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                        <div className="w-7 h-7 bg-slate-200 dark:bg-slate-800 rounded shrink-0" />
                        <div className="flex-grow">
                          <div className="w-24 h-3 bg-slate-200 dark:bg-slate-800 rounded mb-1" />
                          <div className="w-16 h-2.5 bg-slate-100 dark:bg-slate-800/50 rounded" />
                        </div>
                        <div className="w-10 h-2.5 bg-slate-100 dark:bg-slate-800/50 rounded shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <>
                {filteredRecentActivityGrouped.map((user) => {
                  const isCollapsed = expandedUsers[user.userId] === false;
                  return (
                    <div key={user.userId} className="flex flex-col gap-2 p-1.5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/10">
                      {/* User identity row */}
                      <div 
                        onClick={() => toggleUserExpanded(user.userId)}
                        className="flex items-center justify-between px-2 py-1 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/80 cursor-pointer rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm transition-all select-none"
                      >
                        <div className="flex items-center gap-2">
                          {isCollapsed ? (
                            <ChevronRight size={12} className="text-slate-400 shrink-0" />
                          ) : (
                            <ChevronDown size={12} className="text-slate-400 shrink-0" />
                          )}
                          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 text-white flex items-center justify-center text-[10px] font-black shadow-sm uppercase shrink-0">
                            {user.username.charAt(0)}
                          </div>
                          <span className="text-[11px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wider">{user.username}</span>
                          <span className="text-[9px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full border border-slate-200/50 dark:border-slate-700 shrink-0">
                            {user.uniqueBooks.length} active {user.uniqueBooks.length === 1 ? 'book' : 'books'}
                          </span>
                        </div>
                        <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-full border border-indigo-100/50 dark:border-indigo-900/50">
                          {formatTotalTime(user.totalTime)}
                        </span>
                      </div>

                      {/* Sub-list of up to 3 unique books */}
                      {!isCollapsed && (
                        <div className="flex flex-col gap-1.5 px-1 pb-1">
                          {user.uniqueBooks.map(({ title, lastSession }) => {
                            const { itemId, progressPercent } = getSessionBookInfo(lastSession);
                            return (
                              <div key={lastSession.id} className="flex items-center gap-3 p-1.5 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all group/book">
                                <div className="w-8 h-8 aspect-square rounded overflow-hidden shadow-sm shrink-0 border border-slate-200/50 dark:border-slate-800 group-hover/book:scale-105 transition-transform relative">
                                  {itemId ? (
                                    <CoverImage 
                                      itemId={itemId} 
                                      title={title} 
                                      className="w-full h-full object-cover animate-fade-in" 
                                    />
                                  ) : (
                                    <div className="w-full h-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500">
                                      <BookOpen size={14} />
                                    </div>
                                  )}
                                </div>
                                <div className="flex-grow min-w-0">
                                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover/book:text-indigo-600 dark:group-hover/book:text-indigo-400 transition-colors">{title}</p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {progressPercent !== null && (
                                      <div className="flex items-center gap-1 shrink-0">
                                        <span className="text-[9px] font-extrabold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1 rounded shrink-0">
                                          {progressPercent}%
                                        </span>
                                        <div className="w-8 h-0.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shrink-0">
                                          <div 
                                            className="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full" 
                                            style={{ width: `${progressPercent}%` }}
                                          />
                                        </div>
                                      </div>
                                    )}
                                    <span className="text-xs text-slate-400 dark:text-slate-500 font-medium truncate">
                                      Session: {formatDuration(lastSession.timeListening || lastSession.duration || 0)}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-[9px] text-slate-400 dark:text-slate-500 uppercase font-bold tracking-tight">{formatDistanceToNow(lastSession.startedAt).replace('about ', '')} ago</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {filteredRecentActivityGrouped.length === 0 && (
                  <div className="flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2 py-12 flex-grow">
                    <div className="w-10 h-10 bg-slate-50 dark:bg-slate-800/40 rounded-full flex items-center justify-center opacity-60">
                      <Activity size={18} className="text-slate-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                        {last7DaysActivitiesGrouped.length === 0 ? "Silence reigns" : "No results"}
                      </p>
                      <p className="text-[8px] font-medium text-slate-400 dark:text-slate-500">
                        {last7DaysActivitiesGrouped.length === 0 
                          ? "No user activity recorded in the last 7 days." 
                          : "No activity matching your query."}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Listening History Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 overflow-hidden flex flex-col justify-between h-[360px]">
          <div className="flex items-center justify-between mb-4 px-2 shrink-0">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Listening History</h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">
                Global hours consumed
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
                {[
                  { label: '7D', value: '7' },
                  { label: '30D', value: '30' },
                  { label: '1Y', value: '365' },
                  { label: 'ALL', value: 'all' }
                ].map((tf) => (
                  <button
                    key={tf.value}
                    onClick={() => setTimeframe(tf.value as any)}
                    className={`px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all cursor-pointer ${timeframe === tf.value ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
              <div className="w-px h-4 bg-slate-250 dark:bg-slate-800 mx-1"></div>
              <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
                <button 
                  onClick={() => setChartType('line')}
                  className={`px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all cursor-pointer ${chartType === 'line' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
                >
                  Line
                </button>
                <button 
                  onClick={() => setChartType('bar')}
                  className={`px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all cursor-pointer ${chartType === 'bar' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
                >
                  Bar
                </button>
              </div>
            </div>
          </div>
          {dashboardLoading ? (
            <div className="h-[240px] w-full flex flex-col justify-end gap-4 p-4 bg-slate-50/50 dark:bg-slate-800/10 rounded-xl border border-slate-100 dark:border-slate-800 animate-pulse relative overflow-hidden select-none">
              <div className="absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-slate-900/40 backdrop-blur-[1px]">
                <div className="flex flex-col items-center gap-2">
                  <Activity size={24} className="text-indigo-500 dark:text-indigo-400 animate-spin" style={{ animationDuration: '3s' }} />
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Analyzing listening trends...</p>
                </div>
              </div>
              <div className="flex items-end justify-between h-40 px-2 opacity-40">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div 
                    key={i} 
                    className="w-4 bg-slate-200 dark:bg-slate-800 rounded-t-sm" 
                    style={{ height: `${Math.sin(i * 0.5) * 50 + 60}%` }}
                  />
                ))}
              </div>
              <div className="flex justify-between border-t border-slate-200/50 dark:border-slate-800/50 pt-2 px-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="w-8 h-2.5 bg-slate-200 dark:bg-slate-800 rounded-sm" />
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === 'line' ? (
                  <LineChart data={lineChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#334155" : "#f1f5f9"} />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: isDark ? '#64748b' : '#94a3b8', fontWeight: 600 }} dy={5} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: isDark ? '#64748b' : '#94a3b8', fontWeight: 600 }} />
                    <Tooltip 
                      cursor={{ stroke: isDark ? '#334155' : '#e2e8f0', strokeWidth: 1 }}
                      contentStyle={{ 
                        backgroundColor: isDark ? '#1e293b' : '#fff', 
                        borderRadius: '8px', 
                        border: isDark ? '1px solid #334155' : 'none', 
                        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                        fontSize: '10px',
                        fontWeight: '600',
                        color: isDark ? '#f8fafc' : '#0f172a'
                      }}
                      itemStyle={{
                        color: isDark ? '#f8fafc' : '#0f172a'
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="hours" 
                      stroke="#6366f1" 
                      strokeWidth={2} 
                      dot={{ r: 3, fill: '#6366f1', strokeWidth: 1.5, stroke: isDark ? '#1e293b' : '#fff' }} 
                      activeDot={{ r: 5, strokeWidth: 0 }} 
                    />
                  </LineChart>
                ) : (
                  <BarChart data={lineChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#334155" : "#f1f5f9"} />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: isDark ? '#64748b' : '#94a3b8', fontWeight: 600 }} dy={5} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: isDark ? '#64748b' : '#94a3b8', fontWeight: 600 }} />
                    <Tooltip 
                      cursor={{ fill: isDark ? 'rgba(30, 41, 59, 0.4)' : 'rgba(241, 245, 249, 0.6)' }}
                      contentStyle={{ 
                        backgroundColor: isDark ? '#1e293b' : '#fff', 
                        borderRadius: '8px', 
                        border: isDark ? '1px solid #334155' : 'none', 
                        boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                        fontSize: '10px',
                        fontWeight: '600',
                        color: isDark ? '#f8fafc' : '#0f172a'
                      }}
                      itemStyle={{
                        color: isDark ? '#f8fafc' : '#0f172a'
                      }}
                    />
                    <Bar 
                      dataKey="hours" 
                      fill="#6366f1" 
                      radius={[4, 4, 0, 0]} 
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Top Activity Hours Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 overflow-hidden flex flex-col justify-between h-[360px]">
          <div className="flex items-center justify-between mb-4 px-2 shrink-0">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Top Activity Hours</h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">
                Peak listening times (14D)
              </p>
            </div>
          </div>
          {dashboardLoading ? (
            <div className="h-[240px] w-full flex flex-col justify-end gap-4 p-4 bg-slate-50/50 dark:bg-slate-800/10 rounded-xl border border-slate-100 dark:border-slate-800 animate-pulse relative overflow-hidden select-none">
              <div className="absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-slate-900/40 backdrop-blur-[1px]">
                <div className="flex flex-col items-center gap-2">
                  <Activity size={24} className="text-indigo-500 dark:text-indigo-400 animate-spin" style={{ animationDuration: '3s' }} />
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Analyzing peak hours...</p>
                </div>
              </div>
              <div className="flex items-end justify-between h-40 px-2 opacity-40">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div 
                    key={i} 
                    className="w-4 bg-slate-200 dark:bg-slate-800 rounded-t-sm" 
                    style={{ height: `${Math.sin(i * 0.5) * 50 + 60}%` }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyActivityData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#334155" : "#f1f5f9"} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: isDark ? '#64748b' : '#94a3b8', fontWeight: 600 }} dy={5} interval={3} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: isDark ? '#64748b' : '#94a3b8', fontWeight: 600 }} />
                  <Tooltip 
                    cursor={{ fill: isDark ? 'rgba(30, 41, 59, 0.4)' : 'rgba(241, 245, 249, 0.6)' }}
                    contentStyle={{ 
                      backgroundColor: isDark ? '#1e293b' : '#fff', 
                      borderRadius: '8px', 
                      border: isDark ? '1px solid #334155' : 'none', 
                      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                      fontSize: '10px',
                      fontWeight: '600',
                      color: isDark ? '#f8fafc' : '#0f172a'
                    }}
                    itemStyle={{
                      color: isDark ? '#f8fafc' : '#0f172a'
                    }}
                  />
                  <Bar 
                    dataKey="hours" 
                    fill="#6366f1" 
                    radius={[3, 3, 0, 0]} 
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
        {/* Recent Additions Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col h-[360px]">
          <div className="flex items-center justify-between mb-4 px-2 shrink-0">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Recent Additions</h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">Latest library items</p>
            </div>
          </div>
          <div className="flex-grow overflow-y-auto no-scrollbar pr-1">
            <RecentItems 
              items={recentBooks} 
              onBookClick={(book) => {
                setSelectedBookForDetails(book);
                setInitialModalTab('details');
              }}
            />
          </div>
        </div>

        {/* Most Listened Authors Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col h-[360px]">
          <div className="flex items-center justify-between mb-4 px-2 shrink-0">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Top Authors</h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">Listening time by author</p>
            </div>
          </div>
          <div className="flex-grow overflow-y-auto no-scrollbar pr-1 flex flex-col gap-3">
            {topAuthors.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2 py-16 flex-grow">
                <div className="w-10 h-10 bg-slate-50 dark:bg-slate-800/40 rounded-full flex items-center justify-center opacity-60">
                  <PenTool size={18} className="text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">No author data</p>
                  <p className="text-[8px] font-medium text-slate-400 dark:text-slate-500">No listening logs found for this timeframe.</p>
                </div>
              </div>
            ) : (
              topAuthors.map((author) => {
                const maxTime = topAuthors[0]?.time || 1;
                const percent = Math.round((author.time / maxTime) * 100);
                const initials = author.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase() || "??";
                
                return (
                  <div key={author.name} className="flex flex-col gap-1.5 p-2 rounded-xl border border-slate-50 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 hover:border-slate-100 dark:hover:border-slate-800 transition-all group select-none">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 text-white flex items-center justify-center text-[10px] font-black shadow-sm shrink-0 group-hover:scale-105 transition-transform">
                           {initials}
                        </div>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {author.name}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
                        {formatTotalTime(author.time)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-grow bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className="bg-indigo-600 dark:bg-indigo-500 h-1.5 rounded-full transition-all duration-1000 group-hover:bg-indigo-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Most Listened Genres Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col h-[360px]">
          <div className="flex items-center justify-between mb-4 px-2 shrink-0">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Top Genres</h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">Listening time by category</p>
            </div>
          </div>
          <div className="flex-grow overflow-y-auto no-scrollbar pr-1 flex flex-col gap-3">
            {topGenres.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2 py-16 flex-grow">
                <div className="w-10 h-10 bg-slate-50 dark:bg-slate-800/40 rounded-full flex items-center justify-center opacity-60">
                  <Compass size={18} className="text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">No genre data</p>
                  <p className="text-[8px] font-medium text-slate-400 dark:text-slate-500">No listening logs found for this timeframe.</p>
                </div>
              </div>
            ) : (
              topGenres.map((genre) => {
                const maxTime = topGenres[0]?.time || 1;
                const percent = Math.round((genre.time / maxTime) * 100);
                const style = getGenreStyle(genre.name);
                
                return (
                  <div key={genre.name} className="flex flex-col gap-1.5 p-2 rounded-xl border border-slate-50 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 hover:border-slate-100 dark:hover:border-slate-800 transition-all group select-none">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={cn("w-8 h-8 rounded-full bg-gradient-to-tr text-white flex items-center justify-center shadow-sm shrink-0 group-hover:scale-105 transition-transform", style.bg)}>
                          <Tags size={12} />
                        </div>
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {genre.name}
                        </span>
                      </div>
                      <span className={cn("text-[10px] font-bold shrink-0", style.text)}>
                        {formatTotalTime(genre.time)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-grow bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className={cn("h-1.5 rounded-full transition-all duration-1000", style.barBg)}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {selectedBookForDetails && (
          <BookDetailsModal
            book={selectedBookForDetails}
            initialTab={initialModalTab}
            onClose={() => setSelectedBookForDetails(null)}
            onMatchSuccess={() => {}}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
