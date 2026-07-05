import { useState, useMemo } from "react";
import { 
  PieChart, Activity, Clock, BookOpen, Users, 
  Smartphone, PenTool, Compass, Tags, CheckCircle2
} from "lucide-react";
import { 
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  LineChart, Line, BarChart, Bar, RadarChart, PolarGrid, 
  PolarAngleAxis, PolarRadiusAxis, Radar
} from "recharts";
import { Book, Library, Session, UserStats } from "../types";
import { formatDuration, formatTotalTime, cn } from "../lib/utils";
import { CoverImage } from "./CoverImage";
import { BookDetailsModal } from "./BookDetailsModal";
import { AnimatePresence } from "motion/react";

interface StatisticsViewProps {
  recentBooks?: Book[];
  totalBooks?: number;
  dashboardStats?: any;
  dashboardLoading?: boolean;
  dashboardTimeframe?: "7" | "30" | "365" | "all";
  onTimeframeChange?: (timeframe: "7" | "30" | "365" | "all") => void;
  userStats?: UserStats[];
  libraries?: Library[];
  sessions?: Session[];
  activeSessions?: Session[];
  isDark?: boolean;
  onOpenUser?: (userId: string) => void;
}

export function StatisticsView({ 
  recentBooks = [],
  dashboardStats,
  dashboardLoading,
  dashboardTimeframe,
  onTimeframeChange,
  userStats = [],
  libraries = [],
  sessions = [],
  totalBooks = 0,
  activeSessions = [],
  isDark = false,
  onOpenUser
}: StatisticsViewProps) {
  const [chartType, setChartType] = useState<'line' | 'bar'>('bar');
  const [historyMetric, setHistoryMetric] = useState<'hours' | 'users'>('hours');
  const [selectedBookForDetails, setSelectedBookForDetails] = useState<Book | null>(null);
  
  const lineChartData = useMemo(() => dashboardStats?.lineChartData || [], [dashboardStats]);
  const hourlyActivityData = useMemo(() => dashboardStats?.hourlyActivityData || [], [dashboardStats]);
  const topAuthors = useMemo(() => dashboardStats?.topAuthors || [], [dashboardStats]);
  const topGenres = useMemo(() => dashboardStats?.topGenres || [], [dashboardStats]);

  const globalTotalTime = useMemo(() => {
    return userStats.reduce((sum, u) => sum + (u.totalTime || 0), 0);
  }, [userStats]);

  const activeUsersLast30 = useMemo(() => {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    return userStats.filter(u => {
      // User is considered active if they have activity in the last 30 days
      // Or if their joined date is very recent
      const lastActivity = u.activity ? Math.max(...Object.keys(u.activity).map(dateStr => new Date(dateStr).getTime())) : 0;
      return lastActivity >= thirtyDaysAgo || (u.joinedAt && u.joinedAt >= thirtyDaysAgo);
    }).length;
  }, [userStats]);

  const sortedUsersByTime = [...userStats].sort((a, b) => (b.totalTime || 0) - (a.totalTime || 0)).slice(0, 5);
  const sortedUsersByCompletion = [...userStats].sort((a, b) => (b.completionRate || 0) - (a.completionRate || 0)).slice(0, 5);

  const [topListenersMetric, setTopListenersMetric] = useState<'time' | 'completion'>('time');
  const [topBooksMetric, setTopBooksMetric] = useState<'time' | 'sessions' | 'listeners'>('time');

  const topBooks = useMemo(() => {
    if (!sessions.length) return [];
    
    let filteredSessions = sessions;
    if (dashboardTimeframe && dashboardTimeframe !== 'all') {
      const days = parseInt(dashboardTimeframe, 10);
      if (!isNaN(days)) {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        filteredSessions = sessions.filter(s => s.startedAt >= cutoff);
      }
    }

    const booksMap: Record<string, { title: string; time: number; sessions: number; listeners: Set<string>; id?: string; author?: string }> = {};

    filteredSessions.forEach(session => {
      const title = session.displayTitle || session.mediaItemTitle || "Unknown Book";
      const time = session.timeListening || session.duration || 0;
      
      if (!booksMap[title]) {
        booksMap[title] = { 
          title, 
          time: 0, 
          sessions: 0, 
          listeners: new Set(),
          id: session.libraryItemId,
          author: (session as any).mediaMetadata?.authorName || 
                  (session as any).mediaMetadata?.author || 
                  (session as any).displayAuthor ||
                  "Unknown Author"
        };
      }
      booksMap[title].time += time;
      booksMap[title].sessions += 1;
      booksMap[title].listeners.add(session.userId);
    });

    const booksArray = Object.values(booksMap).map(b => ({
      title: b.title,
      time: b.time,
      sessions: b.sessions,
      listeners: b.listeners.size,
      id: b.id,
      author: b.author
    }));

    if (topBooksMetric === 'time') {
      booksArray.sort((a, b) => b.time - a.time);
    } else if (topBooksMetric === 'sessions') {
      booksArray.sort((a, b) => b.sessions - a.sessions);
    } else {
      booksArray.sort((a, b) => b.listeners - a.listeners);
    }

    return booksArray.slice(0, 5);
  }, [sessions, dashboardTimeframe, topBooksMetric]);

  const getGenreStyle = (genre: string) => {
    const styles = [
      { bg: "from-pink-500 to-rose-500", text: "text-rose-600", barBg: "bg-rose-500" },
      { bg: "from-amber-500 to-orange-500", text: "text-orange-600", barBg: "bg-orange-500" },
      { bg: "from-emerald-500 to-teal-500", text: "text-emerald-600", barBg: "bg-emerald-500" },
      { bg: "from-blue-500 to-indigo-500", text: "text-indigo-600", barBg: "bg-indigo-500" },
      { bg: "from-violet-500 to-purple-500", text: "text-purple-600", barBg: "bg-purple-500" },
    ];
    let hash = 0;
    for (let i = 0; i < genre.length; i++) {
      hash = genre.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % styles.length;
    return styles[index];
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Global Header & Timeframe */}
      <div className="flex items-center justify-between bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm p-2 px-4">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Global Analytics</h2>
        </div>
        {onTimeframeChange && (
          <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
            {[
              { label: '7D', value: '7' },
              { label: '30D', value: '30' },
              { label: '1Y', value: '365' },
              { label: 'ALL', value: 'all' }
            ].map((tf) => (
              <button
                key={tf.value}
                onClick={() => onTimeframeChange(tf.value as any)}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all cursor-pointer ${dashboardTimeframe === tf.value ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        )}
      </div>



      {/* 2. Listening Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Listening History Card */}
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col justify-between h-[360px]">
          <div className="flex items-center justify-between mb-4 px-2 shrink-0">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Listening History</h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">
                {historyMetric === 'hours' ? 'Global hours consumed' : 'Active users'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
                <button 
                  onClick={() => setHistoryMetric('hours')}
                  className={`px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all cursor-pointer ${historyMetric === 'hours' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
                >
                  Hours
                </button>
                <button 
                  onClick={() => setHistoryMetric('users')}
                  className={`px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all cursor-pointer ${historyMetric === 'users' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
                >
                  Users
                </button>
              </div>
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
            <div className="h-[240px] w-full flex flex-col justify-end gap-4 p-4 bg-slate-50/50 dark:bg-slate-800/10 rounded-md border border-slate-100 dark:border-slate-800 animate-pulse relative overflow-hidden select-none">
              <div className="absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-slate-900/40 backdrop-blur-[1px]">
                <div className="flex flex-col items-center gap-2">
                  <Activity size={24} className="text-indigo-500 dark:text-indigo-400 animate-spin" style={{ animationDuration: '3s' }} />
                </div>
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
                      itemStyle={{ color: isDark ? '#f8fafc' : '#0f172a' }}
                    />
                    <Line type="monotone" dataKey={historyMetric === 'hours' ? 'hours' : 'activeUsers'} stroke="var(--indigo-600)" strokeWidth={2} dot={{ r: 3, fill: 'var(--indigo-600)', strokeWidth: 1.5, stroke: isDark ? '#1e293b' : '#fff' }} activeDot={{ r: 5, strokeWidth: 0 }} />
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
                      itemStyle={{ color: isDark ? '#f8fafc' : '#0f172a' }}
                    />
                    <Bar dataKey={historyMetric === 'hours' ? 'hours' : 'activeUsers'} fill="var(--indigo-600)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Top Activity Hours Card */}
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col justify-between h-[360px]">
          <div className="flex items-center justify-between mb-4 px-2 shrink-0">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Top Activity Hours</h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">
                Peak listening times
              </p>
            </div>
          </div>
          {dashboardLoading ? (
            <div className="h-[240px] w-full flex flex-col justify-end gap-4 p-4 bg-slate-50/50 dark:bg-slate-800/10 rounded-md border border-slate-100 dark:border-slate-800 animate-pulse relative overflow-hidden select-none">
              <div className="absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-slate-900/40 backdrop-blur-[1px]">
                <Activity size={24} className="text-indigo-500 dark:text-indigo-400 animate-spin" style={{ animationDuration: '3s' }} />
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
                  />
                  <Bar dataKey="hours" fill="var(--indigo-600)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* 3. Content Analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Books Card */}
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col h-[360px]">
          <div className="flex items-center justify-between mb-4 px-2 shrink-0">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Top Books</h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">Most engaged content</p>
            </div>
          </div>
          
          <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg mb-3 mx-2 shrink-0">
            {[
              { label: 'Time', value: 'time' },
              { label: 'Sessions', value: 'sessions' },
              { label: 'Listeners', value: 'listeners' }
            ].map((metric) => (
              <button
                key={metric.value}
                onClick={() => setTopBooksMetric(metric.value as any)}
                className={`flex-1 px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all cursor-pointer ${topBooksMetric === metric.value ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
              >
                {metric.label}
              </button>
            ))}
          </div>

          <div className="flex-grow overflow-y-auto no-scrollbar pr-1 flex flex-col gap-3">
            {topBooks.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2 py-16 flex-grow">
                <div className="w-10 h-10 bg-slate-50 dark:bg-slate-800/40 rounded-full flex items-center justify-center opacity-60">
                  <BookOpen size={18} className="text-slate-400" />
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">No book data</p>
                  <p className="text-[8px] font-medium text-slate-400 dark:text-slate-500">No logs found for this timeframe.</p>
                </div>
              </div>
            ) : (
              topBooks.map((book: any, idx: number) => {
                const maxVal = topBooksMetric === 'time' 
                  ? (topBooks[0]?.time || 1) 
                  : topBooksMetric === 'sessions' 
                    ? (topBooks[0]?.sessions || 1) 
                    : (topBooks[0]?.listeners || 1);
                
                const currentVal = topBooksMetric === 'time' 
                  ? book.time 
                  : topBooksMetric === 'sessions' 
                    ? book.sessions 
                    : book.listeners;
                    
                const percent = Math.round((currentVal / maxVal) * 100);
                
                return (
                  <div 
                    key={book.title} 
                    onClick={() => {
                      if (book.id) {
                        const fullBook = recentBooks?.find(b => b.id === book.id) || {
                          id: book.id,
                          libraryId: "",
                          metadata: { title: book.title, authorName: book.author || "Unknown Author" },
                          addedAt: Date.now()
                        };
                        setSelectedBookForDetails(fullBook as Book);
                      }
                    }}
                    className="flex flex-col gap-1.5 p-2 rounded-md border border-slate-50 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 hover:border-slate-100 dark:hover:border-slate-800 transition-all group select-none cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <div className="w-5 h-5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[9px] font-black shadow-sm shrink-0">
                           {idx + 1}
                        </div>
                        <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-md overflow-hidden flex-shrink-0 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-300 dark:text-slate-600 relative shrink-0">
                          {book.id ? (
                            <CoverImage
                              itemId={book.id}
                              title={book.title}
                              className="w-full h-full object-cover aspect-square"
                            />
                          ) : (
                            <BookOpen size={16} />
                          )}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {book.title}
                          </span>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium truncate">
                            {book.author}
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
                        {topBooksMetric === 'time' ? formatTotalTime(book.time) : currentVal}
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
        {/* Most Listened Authors Card */}
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col h-[360px]">
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
                  <p className="text-[8px] font-medium text-slate-400 dark:text-slate-500">No logs found for this timeframe.</p>
                </div>
              </div>
            ) : (
              topAuthors.map((author: any) => {
                const maxTime = topAuthors[0]?.time || 1;
                const percent = Math.round((author.time / maxTime) * 100);
                const initials = author.name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() || "??";
                
                return (
                  <div key={author.name} className="flex flex-col gap-1.5 p-2 rounded-md border border-slate-50 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 hover:border-slate-100 dark:hover:border-slate-800 transition-all group select-none">
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

      </div>

      {/* 4. User Leaderboards & Engagement */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col h-[360px]">
          <div className="flex items-center justify-between mb-4 px-2 shrink-0">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight">Top Listeners</h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">Leaderboard</p>
            </div>
            <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg">
              {[
                { label: 'Time', value: 'time' },
                { label: 'Completion', value: 'completion' }
              ].map((metric) => (
                <button
                  key={metric.value}
                  onClick={() => setTopListenersMetric(metric.value as any)}
                  className={`px-3 py-1 text-[9px] font-bold uppercase rounded-md transition-all cursor-pointer ${topListenersMetric === metric.value ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
                >
                  {metric.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-grow overflow-y-auto no-scrollbar pr-1 flex flex-col gap-3">
            {(topListenersMetric === 'time' ? sortedUsersByTime : sortedUsersByCompletion).map((user, idx) => (
              <div 
                key={user.userId} 
                onClick={() => onOpenUser && onOpenUser(user.userId)}
                className="flex items-center justify-between p-2 rounded-md border border-slate-50 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shadow-sm ${topListenersMetric === 'time' ? 'bg-gradient-to-tr from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-600 text-slate-700 dark:text-slate-200' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'}`}>
                    {topListenersMetric === 'time' ? (idx + 1) : <CheckCircle2 size={16} />}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">{user.username}</p>
                    {topListenersMetric === 'time' && (
                      <p className="text-[9px] text-slate-500 dark:text-slate-400 font-medium">Avg Daily: {formatDuration(user.avgDaily || 0)}</p>
                    )}
                  </div>
                </div>
                {topListenersMetric === 'time' ? (
                  <div className="text-right">
                    <p className="text-xs font-extrabold text-indigo-600 dark:text-indigo-400">{formatTotalTime(user.totalTime)}</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${Math.min(user.completionRate || 0, 100)}%` }}
                      />
                    </div>
                    <p className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400 w-8 text-right">
                      {Math.round(user.completionRate || 0)}%
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Most Listened Genres Card */}
        <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col h-[360px]">
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
                  <p className="text-[8px] font-medium text-slate-400 dark:text-slate-500">No logs found for this timeframe.</p>
                </div>
              </div>
            ) : (
              topGenres.map((genre: any) => {
                const maxTime = topGenres[0]?.time || 1;
                const percent = Math.round((genre.time / maxTime) * 100);
                const style = getGenreStyle(genre.name);
                
                return (
                  <div key={genre.name} className="flex flex-col gap-1.5 p-2 rounded-md border border-slate-50 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-800/30 hover:border-slate-100 dark:hover:border-slate-800 transition-all group select-none">
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
            initialTab="details"
            onClose={() => setSelectedBookForDetails(null)}
            onMatchSuccess={() => {}}
            isDark={isDark}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
