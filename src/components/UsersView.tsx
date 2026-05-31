import { useState, useMemo, useEffect, lazy, Suspense } from "react";
import { 
  Users, Search, Filter, ChevronRight, Clock, Calendar, BarChart3, 
  History, User as UserIcon, TrendingUp, Music, LayoutGrid, List, BookOpen,
  ChevronLeft, ChevronsLeft, ChevronsRight
} from "lucide-react";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from "recharts";
import { format, formatDistanceToNow, subDays } from "date-fns";
import { User, Session, UserStats, Book } from "../types";
import { formatDuration, cn, formatTotalTime } from "../lib/utils";
import { CoverImage } from "./CoverImage";

const ActivityHeatmap = lazy(() =>
  import("./ActivityHeatmap").then((module) => ({ default: module.ActivityHeatmap }))
);

interface UsersViewProps {
  users: User[];
  sessions: Session[];
  userStats: UserStats[];
  books: Book[];
  sessionsLoading: boolean;
  isDark?: boolean;
}

export function UsersView({ users, sessions, userStats, books, sessionsLoading, isDark = false }: UsersViewProps) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  type ViewMode = 'recent' | 'all-books' | 'full-log';
  type ProgressFilter = 'all' | 'completed' | 'unfinished';

  const [viewMode, setViewMode] = useState<ViewMode>('recent');
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>('all');
  const [sessionPage, setSessionPage] = useState(1);
  const SESSIONS_PER_PAGE = 10;

  // Reset view mode, progress filter, and page when selected user changes
  useEffect(() => {
    setViewMode('recent');
    setProgressFilter('all');
    setSessionPage(1);
  }, [selectedUserId]);

  // Reset page when view settings change
  useEffect(() => {
    setSessionPage(1);
  }, [viewMode, progressFilter]);

  const filteredUsers = useMemo(() => {
    return users.filter(u => u.username.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [users, searchQuery]);

  const selectedUser = useMemo(() => {
    return users.find(u => u.id === selectedUserId) || null;
  }, [users, selectedUserId]);

  const selectedUserStats = useMemo(() => {
    return userStats.find(s => s.userId === selectedUserId) || null;
  }, [userStats, selectedUserId]);

  const selectedUserSessions = useMemo(() => {
    return sessions
      .filter(s => s.userId === selectedUserId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }, [sessions, selectedUserId]);

  const last14DaysBooks = useMemo(() => {
    const cutoff = subDays(new Date(), 14).getTime();
    const seenBooks = new Set<string>();
    const booksList: { title: string; lastSession: Session }[] = [];

    selectedUserSessions.forEach(session => {
      if (session.startedAt >= cutoff) {
        const title = session.displayTitle || session.mediaItemTitle || "Unknown Book";
        if (!seenBooks.has(title)) {
          seenBooks.add(title);
          booksList.push({
            title,
            lastSession: session
          });
        }
      }
    });

    return booksList;
  }, [selectedUserSessions]);

  const getSessionBookInfo = (session: Session) => {
    const itemId = session.libraryItemId;
    const progressPercent = session.progress !== undefined 
      ? Math.round(session.progress * 100) 
      : (session.currentTime && session.duration 
        ? Math.round((session.currentTime / session.duration) * 100) 
        : null);
    return { itemId, progressPercent };
  };

  const allUserBooks = useMemo(() => {
    const seenBooks = new Set<string>();
    const booksList: { title: string; lastSession: Session }[] = [];

    selectedUserSessions.forEach(session => {
      const title = session.displayTitle || session.mediaItemTitle || "Unknown Book";
      if (!seenBooks.has(title)) {
        seenBooks.add(title);
        booksList.push({
          title,
          lastSession: session
        });
      } else {
        const existing = booksList.find(b => b.title.toLowerCase() === title.toLowerCase());
        if (existing && session.startedAt > existing.lastSession.startedAt) {
          existing.lastSession = session;
        }
      }
    });

    return booksList;
  }, [selectedUserSessions]);

  const filteredAllUserBooks = useMemo(() => {
    return allUserBooks.filter(({ lastSession }) => {
      const { progressPercent } = getSessionBookInfo(lastSession);
      const progress = progressPercent ?? 0;

      if (progressFilter === 'completed') {
        return progress > 99;
      }
      if (progressFilter === 'unfinished') {
        return progress <= 99;
      }
      return true;
    });
  }, [allUserBooks, progressFilter]);

  const activeItemsCount = useMemo(() => {
    if (viewMode === 'recent') return last14DaysBooks.length;
    if (viewMode === 'all-books') return filteredAllUserBooks.length;
    if (viewMode === 'full-log') return selectedUserSessions.length;
    return 0;
  }, [viewMode, last14DaysBooks, filteredAllUserBooks, selectedUserSessions]);

  const totalSessionPages = Math.max(1, Math.ceil(activeItemsCount / SESSIONS_PER_PAGE));

  const paginatedAllUserBooks = useMemo(() => {
    const startIndex = (sessionPage - 1) * SESSIONS_PER_PAGE;
    return filteredAllUserBooks.slice(startIndex, startIndex + SESSIONS_PER_PAGE);
  }, [filteredAllUserBooks, sessionPage]);

  const paginatedUserSessions = useMemo(() => {
    const startIndex = (sessionPage - 1) * SESSIONS_PER_PAGE;
    return selectedUserSessions.slice(startIndex, startIndex + SESSIONS_PER_PAGE);
  }, [selectedUserSessions, sessionPage]);

  const paginatedLast14DaysBooks = useMemo(() => {
    const startIndex = (sessionPage - 1) * SESSIONS_PER_PAGE;
    return last14DaysBooks.slice(startIndex, startIndex + SESSIONS_PER_PAGE);
  }, [last14DaysBooks, sessionPage]);

  const getSessionPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;
    if (totalSessionPages <= maxVisiblePages) {
      for (let i = 1; i <= totalSessionPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      const start = Math.max(2, sessionPage - 1);
      const end = Math.min(totalSessionPages - 1, sessionPage + 1);
      if (start > 2) {
        pages.push('...');
      }
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      if (end < totalSessionPages - 1) {
        pages.push('...');
      }
      pages.push(totalSessionPages);
    }
    return pages;
  };

  const userActivityChartData = useMemo(() => {
    if (!selectedUserId) return [];
    const last7Days = Array.from({ length: 14 }).map((_, i) => format(subDays(new Date(), i), "MM/dd")).reverse();
    return last7Days.map(date => {
      const daySessions = selectedUserSessions.filter(s => format(s.startedAt, "MM/dd") === date);
      const hours = daySessions.reduce((acc, s) => acc + (s.timeListening || s.duration || 0), 0) / 3600;
      return { date, hours: parseFloat(hours.toFixed(1)) };
    });
  }, [selectedUserSessions, selectedUserId]);

  const userHourlyActivityData = useMemo(() => {
    if (!selectedUserId) return [];
    const cutoff = subDays(new Date(), 14).getTime();
    const recentSessions = selectedUserSessions.filter(s => s.startedAt >= cutoff);

    const activity: Record<number, any> = {};
    for (let h = 0; h < 24; h++) {
      const label = `${h.toString().padStart(2, '0')}:00`;
      activity[h] = { hour: h, label, hours: 0 };
    }

    recentSessions.forEach(session => {
      const date = new Date(session.startedAt);
      const hour = date.getHours();
      const listeningTime = (session.timeListening || session.duration || 0) / 3600;

      activity[hour].hours += listeningTime;
    });

    return Object.values(activity)
      .map((entry: any) => {
        const newEntry = { ...entry };
        newEntry.hours = parseFloat(entry.hours.toFixed(1));
        return newEntry;
      })
      .sort((a: any, b: any) => a.hour - b.hour);
  }, [selectedUserSessions, selectedUserId]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Sidebar List */}
      <div className="lg:col-span-3 flex flex-col gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 overflow-hidden flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Active Accounts</h3>
            <span className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest">{users.length} Total</span>
          </div>
          
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search user..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg py-1.5 pl-9 pr-3 text-[11px] font-medium focus:ring-1 focus:ring-indigo-100 dark:focus:ring-indigo-950/50 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>

          <div className="flex flex-col gap-1 max-h-[600px] overflow-y-auto no-scrollbar pr-1">
            {filteredUsers.map((user) => {
              const stats = userStats.find(s => s.userId === user.id);
              const isActive = selectedUserId === user.id;
              
              return (
                <button
                  key={user.id}
                  onClick={() => setSelectedUserId(user.id)}
                  className={cn(
                    "flex items-center justify-between p-2 rounded-xl transition-all group cursor-pointer",
                    isActive ? "bg-indigo-600 text-white shadow-md shadow-indigo-100 dark:shadow-none" : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  )}
                >
                  <div className="flex items-center gap-2 text-left">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center border",
                      isActive ? "bg-white/20 border-white/20" : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm"
                    )}>
                      <UserIcon size={14} className={isActive ? "text-white" : "text-slate-600 dark:text-slate-400"} />
                    </div>
                    <div>
                      <p className={cn("text-[11px] font-bold uppercase tracking-tight", isActive ? "text-white" : "text-slate-900 dark:text-slate-100")}>
                        {user.username}
                      </p>
                      {user.type === 'admin' && (
                        <p className={cn("text-[9px] font-medium", isActive ? "text-white/60" : "text-slate-400 dark:text-slate-500")}>
                          System Admin
                        </p>
                      )}
                    </div>
                  </div>
                  {!isActive && stats && (
                    <div className="text-right">
                      <p className="text-[9px] font-bold text-slate-900 dark:text-slate-200">{formatTotalTime(stats.totalTime)}</p>
                      <p className="text-[8px] text-slate-400 dark:text-slate-500 uppercase font-bold">Logged</p>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detail View */}
      <div className="lg:col-span-9">
        {!selectedUserId ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 border-dashed h-full min-h-[400px] flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-3 p-8">
            <div className="w-12 h-12 bg-slate-50 dark:bg-slate-800/40 rounded-full flex items-center justify-center opacity-50">
              <Users size={24} />
            </div>
            <div className="text-center">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Pick a listener</p>
              <p className="text-xs font-medium mt-1">Select a user from the list to view their deep metrics and listening logs.</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Header / Stats */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 relative overflow-hidden">
               <div className="flex flex-col md:flex-row gap-6 items-start md:items-center relative z-10">
                <div className="w-16 h-16 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-100/50 dark:shadow-none border-2 border-white dark:border-slate-800 animate-fade-in">
                  <UserIcon size={32} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">{selectedUser?.username}</h2>
                    <span className="px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded text-[9px] font-bold uppercase tracking-widest">
                      {selectedUser?.type}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <Clock size={12} />
                      <span className="text-[10px] font-bold">{formatTotalTime(selectedUserStats?.totalTime || 0)} Total Time</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <TrendingUp size={12} />
                      <span className="text-[10px] font-bold">{formatDuration(selectedUserStats?.avgDaily || 0)}/Day Avg</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <Calendar size={12} />
                      <span className="text-[10px] font-bold">Joined {selectedUserStats?.joinedAt ? format(selectedUserStats.joinedAt, "MMM yyyy") : "Unknown"}</span>
                    </div>
                  </div>
                </div>
               </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
                <h3 className="text-[11px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight mb-4">Recent Activity (14 Days)</h3>
                {sessionsLoading ? (
                  <div className="h-[180px] w-full flex flex-col justify-end gap-3 p-2 bg-slate-50/50 dark:bg-slate-800/10 rounded-xl border border-slate-100 dark:border-slate-800 animate-pulse relative overflow-hidden select-none">
                    <div className="absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-slate-900/40">
                      <Clock size={20} className="text-indigo-500 dark:text-indigo-400 animate-spin" style={{ animationDuration: '3s' }} />
                    </div>
                    <div className="flex items-end justify-between h-[120px] px-1 opacity-30">
                      {Array.from({ length: 14 }).map((_, i) => (
                        <div key={i} className="w-3 bg-slate-200 dark:bg-slate-800 rounded-t-sm" style={{ height: `${(i % 3) * 30 + 20}%` }} />
                      ))}
                    </div>
                    <div className="flex justify-between border-t border-slate-200/50 dark:border-slate-800/50 pt-2 px-1 opacity-20">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="w-6 h-2 bg-slate-200 dark:bg-slate-800 rounded-sm" />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="h-[180px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={userActivityChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#334155" : "#f1f5f9"} />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: isDark ? '#64748b' : '#94a3b8', fontWeight: 600 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: isDark ? '#64748b' : '#94a3b8', fontWeight: 600 }} />
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
                        <Bar dataKey="hours" fill="#6366f1" radius={[2, 2, 0, 0]} barSize={16} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4">
                <h3 className="text-[11px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight mb-4">Active Hours (14 Days)</h3>
                {sessionsLoading ? (
                  <div className="h-[180px] w-full flex flex-col justify-end gap-3 p-2 bg-slate-50/50 dark:bg-slate-800/10 rounded-xl border border-slate-100 dark:border-slate-800 animate-pulse relative overflow-hidden select-none">
                    <div className="absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-slate-900/40">
                      <Clock size={20} className="text-indigo-500 dark:text-indigo-400 animate-spin" style={{ animationDuration: '3s' }} />
                    </div>
                    <div className="flex items-end justify-between h-[120px] px-1 opacity-30">
                      {Array.from({ length: 24 }).map((_, i) => (
                        <div key={i} className="w-1 bg-slate-200 dark:bg-slate-800 rounded-t-sm" style={{ height: `${(i % 5) * 20 + 20}%` }} />
                      ))}
                    </div>
                    <div className="flex justify-between border-t border-slate-200/50 dark:border-slate-800/50 pt-2 px-1 opacity-20">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="w-6 h-2 bg-slate-200 dark:bg-slate-800 rounded-sm" />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="h-[180px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={userHourlyActivityData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#334155" : "#f1f5f9"} />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: isDark ? '#64748b' : '#94a3b8', fontWeight: 600 }} interval={3} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 8, fill: isDark ? '#64748b' : '#94a3b8', fontWeight: 600 }} />
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
                        <Bar dataKey="hours" fill="#6366f1" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>

            {/* Heatmap */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 min-h-[180px]">
              <Suspense fallback={
                <div className="h-[130px] w-full flex flex-col justify-center items-center text-slate-400 dark:text-slate-500 gap-2.5">
                  <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Loading Playback Heatmap...</span>
                </div>
              }>
                <ActivityHeatmap 
                  title="Yearly Listening Intensity"
                  data={selectedUserStats?.activity || {}}
                  isDark={isDark}
                />
              </Suspense>
            </div>

            {/* Session Logs */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden mb-6">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-[11px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Listening Sessions</h3>
                  <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">
                    {viewMode === 'recent' && "Books listened to in the last 14 days"}
                    {viewMode === 'all-books' && `All unique books (${progressFilter} progress)`}
                    {viewMode === 'full-log' && "Detailed chronological playback history"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* View Mode Selector */}
                  <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/50 dark:border-slate-700/50">
                    {[
                      { label: "Recent", value: "recent" },
                      { label: "All Books", value: "all-books" },
                      { label: "Full Log", value: "full-log" }
                    ].map((mode) => (
                      <button
                        key={mode.value}
                        onClick={() => setViewMode(mode.value as ViewMode)}
                        className={cn(
                          "px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all cursor-pointer",
                          viewMode === mode.value 
                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' 
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                        )}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  {/* Progress Filter (only shown when viewMode is 'all-books') */}
                  {viewMode === 'all-books' && (
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200/50 dark:border-slate-700/50 animate-pulse-subtle">
                      {[
                        { label: "All Status", value: "all" },
                        { label: "Completed (>99%)", value: "completed" },
                        { label: "Unfinished", value: "unfinished" }
                      ].map((filter) => (
                        <button
                          key={filter.value}
                          onClick={() => setProgressFilter(filter.value as ProgressFilter)}
                          className={cn(
                            "px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all cursor-pointer",
                            progressFilter === filter.value 
                              ? 'bg-indigo-600 dark:bg-indigo-500 text-white shadow-sm' 
                              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                          )}
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-slate-50/50 dark:bg-slate-800/20">
                    <tr className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800">
                      <th className="px-4 py-2">
                        {viewMode === 'full-log' ? "Title" : "Book Title"}
                      </th>
                      <th className="px-4 py-2">
                        {viewMode === 'full-log' ? "Duration" : "Last Session Duration"}
                      </th>
                      <th className="px-4 py-2">
                        {viewMode === 'full-log' ? "Timestamp" : "Last Listened"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {sessionsLoading ? (
                      Array.from({ length: 5 }).map((_, rIdx) => (
                        <tr key={rIdx} className="animate-pulse bg-white/20 dark:bg-slate-800/10 select-none">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded bg-slate-200 dark:bg-slate-800 shrink-0" />
                              <div className="flex-grow">
                                <div className="w-32 h-3 bg-slate-200 dark:bg-slate-800 rounded mb-1" />
                                <div className="w-20 h-2 bg-slate-100 dark:bg-slate-850 rounded" />
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="w-12 h-3.5 bg-slate-200 dark:bg-slate-800 rounded" />
                          </td>
                          <td className="px-4 py-3">
                    <div className="w-16 h-3 bg-slate-200 dark:bg-slate-800 rounded mb-1" />
                            <div className="w-10 h-2 bg-slate-100 dark:bg-slate-850 rounded" />
                          </td>
                        </tr>
                      ))
                    ) : viewMode === 'all-books' ? (
                      paginatedAllUserBooks.length > 0 ? (
                        paginatedAllUserBooks.map(({ title, lastSession }) => {
                          const { itemId, progressPercent } = getSessionBookInfo(lastSession);
                          return (
                            <tr key={lastSession.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 aspect-square rounded overflow-hidden shadow-sm shrink-0 border border-slate-200/50 dark:border-slate-800 relative">
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
                                  <div>
                                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1">{title}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      {progressPercent !== null && (
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1 py-0.2 rounded">
                                            {progressPercent}%
                                          </span>
                                          <div className="w-12 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div 
                                              className="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full" 
                                              style={{ width: `${progressPercent}%` }}
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-300 text-[11px]">
                                {formatDuration(lastSession.timeListening || lastSession.duration || 0)}
                              </td>
                              <td className="px-4 py-2">
                                <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{format(lastSession.startedAt, "MMM d, HH:mm")}</p>
                                <p className="text-[8px] text-slate-400 dark:text-slate-500 uppercase font-bold tracking-tight">{formatDistanceToNow(lastSession.startedAt)} ago</p>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500 text-[10px] font-medium">
                            No books matched the selected progress filter.
                          </td>
                        </tr>
                      )
                    ) : viewMode === 'full-log' ? (
                      paginatedUserSessions.length > 0 ? (
                        paginatedUserSessions.map((session) => {
                          const { itemId, progressPercent } = getSessionBookInfo(session);
                          return (
                            <tr key={session.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 aspect-square rounded overflow-hidden shadow-sm shrink-0 border border-slate-200/50 dark:border-slate-800 relative">
                                    {itemId ? (
                                      <CoverImage 
                                        itemId={itemId} 
                                        title={session.displayTitle || session.mediaItemTitle} 
                                        className="w-full h-full object-cover animate-fade-in" 
                                      />
                                    ) : (
                                      <div className="w-full h-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500">
                                        <BookOpen size={14} />
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1">{session.displayTitle || session.mediaItemTitle}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      {progressPercent !== null && (
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1 py-0.2 rounded">
                                            {progressPercent}%
                                          </span>
                                          <div className="w-12 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div 
                                              className="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full" 
                                              style={{ width: `${progressPercent}%` }}
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-300 text-[11px]">
                                {formatDuration(session.timeListening || session.duration || 0)}
                              </td>
                              <td className="px-4 py-2">
                                <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{format(session.startedAt, "MMM d, HH:mm")}</p>
                                <p className="text-[8px] text-slate-400 dark:text-slate-500 uppercase font-bold tracking-tight">{formatDistanceToNow(session.startedAt)} ago</p>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500 text-[10px] font-medium">
                            No playback history found.
                          </td>
                        </tr>
                      )
                    ) : (
                      paginatedLast14DaysBooks.length > 0 ? (
                        paginatedLast14DaysBooks.map(({ title, lastSession }) => {
                          const { itemId, progressPercent } = getSessionBookInfo(lastSession);
                          return (
                            <tr key={lastSession.id} className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 aspect-square rounded overflow-hidden shadow-sm shrink-0 border border-slate-200/50 dark:border-slate-800 relative">
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
                                  <div>
                                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1">{title}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      {progressPercent !== null && (
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1 py-0.2 rounded">
                                            {progressPercent}%
                                          </span>
                                          <div className="w-12 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                            <div 
                                              className="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full" 
                                              style={{ width: `${progressPercent}%` }}
                                            />
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-2 font-bold text-slate-700 dark:text-slate-300 text-[11px]">
                                {formatDuration(lastSession.timeListening || lastSession.duration || 0)}
                              </td>
                              <td className="px-4 py-2">
                                <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{format(lastSession.startedAt, "MMM d, HH:mm")}</p>
                                <p className="text-[8px] text-slate-400 dark:text-slate-500 uppercase font-bold tracking-tight">{formatDistanceToNow(lastSession.startedAt)} ago</p>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-4 py-8 text-center text-slate-400 dark:text-slate-500 text-[10px] font-medium">
                            No books listened to in the last 14 days. Select "All Books" or "Full Log" to see historical data.
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
              
              {/* Pagination control bar */}
              {!sessionsLoading && activeItemsCount > SESSIONS_PER_PAGE && (
                <div className="px-4 py-3 bg-slate-50/30 dark:bg-slate-800/10 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                  <div className="font-semibold text-slate-500 dark:text-slate-400">
                    Showing <span className="text-slate-855 dark:text-slate-200">{(sessionPage - 1) * SESSIONS_PER_PAGE + 1}</span> to{" "}
                    <span className="text-slate-855 dark:text-slate-200">{Math.min(activeItemsCount, sessionPage * SESSIONS_PER_PAGE)}</span> of{" "}
                    <span className="text-slate-855 dark:text-slate-205">{activeItemsCount}</span> entries
                  </div>
                  
                  <div className="flex items-center gap-1.5">
                    {/* First Page */}
                    <button
                      onClick={() => setSessionPage(1)}
                      disabled={sessionPage === 1}
                      className={cn(
                        "p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
                      )}
                      title="First Page"
                    >
                      <ChevronsLeft size={13} />
                    </button>

                    {/* Prev Page */}
                    <button
                      onClick={() => setSessionPage(prev => Math.max(1, prev - 1))}
                      disabled={sessionPage === 1}
                      className={cn(
                        "p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
                      )}
                      title="Previous Page"
                    >
                      <ChevronLeft size={13} />
                    </button>

                    {/* Page Numbers */}
                    {getSessionPageNumbers().map((p, idx) => (
                      <button
                        key={idx}
                        onClick={() => typeof p === 'number' && setSessionPage(p)}
                        disabled={p === '...'}
                        className={cn(
                          "min-w-8 h-8 px-2 rounded-lg text-[10px] font-extrabold transition-all flex items-center justify-center cursor-pointer",
                          p === sessionPage
                            ? "bg-indigo-650 dark:bg-indigo-600 text-white shadow-sm"
                            : p === '...'
                            ? "text-slate-400 dark:text-slate-600 cursor-default"
                            : "border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-350"
                        )}
                      >
                        {p}
                      </button>
                    ))}

                    {/* Next Page */}
                    <button
                      onClick={() => setSessionPage(prev => Math.min(totalSessionPages, prev + 1))}
                      disabled={sessionPage === totalSessionPages}
                      className={cn(
                        "p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
                      )}
                      title="Next Page"
                    >
                      <ChevronRight size={13} />
                    </button>

                    {/* Last Page */}
                    <button
                      onClick={() => setSessionPage(totalSessionPages)}
                      disabled={sessionPage === totalSessionPages}
                      className={cn(
                        "p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
                      )}
                      title="Last Page"
                    >
                      <ChevronsRight size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
