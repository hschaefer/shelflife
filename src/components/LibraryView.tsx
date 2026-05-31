import { useState, useEffect, useMemo, useRef } from "react";
import { 
  Library as LibraryIcon, Database, RefreshCw, Layers, BookOpen, 
  Search, Filter, MoreVertical, CheckCircle2, AlertCircle, Sparkles,
  ChevronRight, Calendar, User as UserIcon, Tag, ArrowUp, ArrowDown, Clock,
  TrendingUp, ChevronLeft, ChevronsLeft, ChevronsRight
} from "lucide-react";
import { Book, Library } from "../types";
import { formatDistanceToNow, format, subDays } from "date-fns";
import { cn } from "../lib/utils";
import { api } from "../lib/api";
import { BookDetailsModal } from "./BookDetailsModal";
import { AnimatePresence } from "motion/react";
import { CoverImage } from "./CoverImage";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from "recharts";

interface LibraryViewProps {
  books: Book[];
  libraries: Library[];
  isDark?: boolean;
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes === null || bytes === 0) return "-- GB";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null || seconds === 0) return "-- h";
  const days = Math.floor(seconds / (24 * 3600));
  seconds %= (24 * 3600);
  const hours = Math.floor(seconds / 3600);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days === 0) parts.push(`${hours}h`);
  return parts.join(" ");
}

const getTickFormatter = (timeframe: string) => {
  return (timestamp: number) => {
    try {
      const date = new Date(timestamp);
      if (timeframe === '7' || timeframe === '30') {
        return format(date, "MMM d");
      }
      return format(date, "MMM yy");
    } catch (e) {
      return "";
    }
  };
};

const CustomChartTooltip = ({ active, payload, isDark }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    const isBoundary = data.isBoundary;
    return (
      <div className={cn(
        "border p-3 rounded-2xl shadow-xl max-w-[240px] font-sans text-xs",
        isDark 
          ? "bg-slate-900 border-slate-800 text-slate-100 shadow-black/40" 
          : "bg-white border-slate-200 text-slate-900 shadow-slate-200"
      )}>
        <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">{data.dateStr}</p>
        <p className={cn("font-bold truncate", isDark ? "text-slate-100" : "text-slate-900")} title={data.bookTitle}>{data.bookTitle}</p>
        {!isBoundary && data.author && (
          <p className="text-slate-500 dark:text-slate-400 font-medium truncate mb-2">{data.author}</p>
        )}
        <div className="border-t border-slate-100 dark:border-slate-800 pt-2 flex flex-col gap-1.5">
          {!isBoundary && (
            <div className="flex justify-between items-center gap-4">
              <span className="text-slate-400 dark:text-slate-500 font-medium text-[10px] uppercase tracking-wider">Book Length:</span>
              <span className={cn("font-bold", isDark ? "text-slate-300" : "text-slate-700")}>{formatDuration(data.rawDuration)}</span>
            </div>
          )}
          <div className="flex justify-between items-center gap-4">
            <span className="text-indigo-600 dark:text-indigo-400 font-bold text-[10px] uppercase tracking-wider">Total Library:</span>
            <span className="font-black text-indigo-650 dark:text-indigo-400">{data.hours}h</span>
          </div>
        </div>
      </div>
    );
  }
  return null;
};

export function LibraryView({ books: initialBooks, libraries, isDark = false }: LibraryViewProps) {
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>("");
  const [isRescanning, setIsRescanning] = useState(false);
  const [matchStatus, setMatchStatus] = useState<Record<string, 'matching' | 'success' | null>>({});
  const [selectedBookForDetails, setSelectedBookForDetails] = useState<Book | null>(null);
  const [initialModalTab, setInitialModalTab] = useState<'details' | 'match' | 'chapters'>('details');
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 18;
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [sortBy, setSortBy] = useState<'title' | 'author' | 'addedAt'>('addedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [libraryStats, setLibraryStats] = useState<{ totalSize: number; totalDuration: number } | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<'7' | '30' | '365' | 'all'>('all');
  const [chartBooks, setChartBooks] = useState<Book[]>([]);
  const [totalBooks, setTotalBooks] = useState(0);

  const { chartData, minTime, maxTime } = useMemo(() => {
    if (!chartBooks || chartBooks.length === 0) {
      return { chartData: [], minTime: 0, maxTime: 0 };
    }
    
    // Sort all books ascending by addedAt
    const sorted = [...chartBooks]
      .filter(b => b.addedAt)
      .sort((a, b) => a.addedAt - b.addedAt);
      
    let runningSumSeconds = 0;
    const allDataPoints = sorted.map(book => {
      const bookDuration = book.duration || 0;
      runningSumSeconds += bookDuration;
      const hours = runningSumSeconds / 3600;
      return {
        timestamp: book.addedAt,
        rawDuration: bookDuration,
        hours: parseFloat(hours.toFixed(1)),
        bookTitle: book.metadata?.title || "Unknown Title",
        author: book.metadata?.authorName || "Unknown Author",
        isBoundary: false,
        dateStr: format(new Date(book.addedAt), "MMM d, yyyy"),
        shortDate: format(new Date(book.addedAt), "MM/dd"),
      };
    });

    const now = Date.now();
    let minTime = sorted[0]?.addedAt || now;
    const maxTime = now;

    if (chartTimeframe !== 'all') {
      minTime = subDays(new Date(), parseInt(chartTimeframe)).getTime();
    }

    // Filter points that are within [minTime, maxTime]
    const filteredPoints = allDataPoints.filter(dp => dp.timestamp >= minTime);

    // Calculate the cumulative hours before minTime
    let initialHours = 0;
    const pointsBefore = allDataPoints.filter(dp => dp.timestamp < minTime);
    if (pointsBefore.length > 0) {
      initialHours = pointsBefore[pointsBefore.length - 1].hours;
    }

    const chartPoints = [];

    // Inject the start point at minTime
    chartPoints.push({
      timestamp: minTime,
      rawDuration: 0,
      hours: initialHours,
      bookTitle: "Period Start",
      author: "",
      isBoundary: true,
      dateStr: format(new Date(minTime), "MMM d, yyyy"),
      shortDate: format(new Date(minTime), "MM/dd"),
    });

    // Add all actual additions within the timeframe
    chartPoints.push(...filteredPoints);

    // Inject the end point at maxTime (now)
    const finalHours = filteredPoints.length > 0 
      ? filteredPoints[filteredPoints.length - 1].hours 
      : initialHours;

    chartPoints.push({
      timestamp: maxTime,
      rawDuration: 0,
      hours: finalHours,
      bookTitle: "Present Day",
      author: "",
      isBoundary: true,
      dateStr: format(new Date(maxTime), "MMM d, yyyy"),
      shortDate: format(new Date(maxTime), "MM/dd"),
    });

    return { chartData: chartPoints, minTime, maxTime };
  }, [chartBooks, chartTimeframe]);

  const handleHeaderClick = (field: 'title' | 'author' | 'addedAt') => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder(field === 'addedAt' ? 'desc' : 'asc');
    }
  };

  useEffect(() => {
    if (libraries.length > 0) {
      setSelectedLibraryId(prev => prev || libraries[0].id);
    }
  }, [libraries]);

  const fetchLibraryMetadata = async () => {
    const libId = selectedLibraryId || (libraries.length > 0 ? libraries[0].id : "");
    if (!libId) return;
    setLoading(true);
    try {
      const [stats, fullItemsRes] = await Promise.all([
        api.getLibraryStats(libId).catch(err => {
          console.error("Failed to fetch library stats:", err);
          return null;
        }),
        api.getLibraryItems(libId, { limit: 100000, page: 0 }).catch(err => {
          console.error("Failed to fetch full library items for chart:", err);
          return { results: [], totalBooks: 0 };
        })
      ]);

      const items = Array.isArray(fullItemsRes) ? fullItemsRes : (fullItemsRes?.results || []);
      const transformed: Book[] = items.map((item: any) => {
        const mediaMeta = item.metadata || { title: "Unknown Title", authorName: "Unknown Author" };
        return {
          id: item.id,
          libraryId: item.libraryId,
          metadata: {
            title: mediaMeta.title,
            authorName: mediaMeta.authorName,
            coverPath: mediaMeta.coverPath || api.getCoverPath(item.id),
          },
          addedAt: item.addedAt || Date.now(),
          duration: item.duration || 0,
        };
      });

      setChartBooks(transformed);
      setLibraryStats(stats);
    } catch (err) {
      console.error("Failed to fetch library metadata:", err);
      setLibraryStats(null);
    } finally {
      setLoading(false);
    }
  };

  const totalPages = Math.ceil(totalBooks / ITEMS_PER_PAGE) || 1;

  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      if (start > 2) {
        pages.push('...');
      }
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      if (end < totalPages - 1) {
        pages.push('...');
      }
      pages.push(totalPages);
    }
    return pages;
  };

  const fetchPaginatedBooks = async () => {
    const libId = selectedLibraryId || (libraries.length > 0 ? libraries[0].id : "");
    if (!libId) return;
    try {
      const res = await api.getLibraryItems(libId, {
        search: searchTerm,
        sort: sortBy,
        desc: sortOrder === 'desc',
        page: currentPage - 1,
        limit: ITEMS_PER_PAGE
      });
      const items = Array.isArray(res) ? res : (res?.results || []);
      const transformed: Book[] = items.map((item: any) => {
        const mediaMeta = item.metadata || { title: "Unknown Title", authorName: "Unknown Author" };
        return {
          id: item.id,
          libraryId: item.libraryId,
          metadata: {
            title: mediaMeta.title,
            authorName: mediaMeta.authorName,
            coverPath: mediaMeta.coverPath || api.getCoverPath(item.id),
          },
          addedAt: item.addedAt || Date.now(),
          duration: item.duration || 0,
        };
      });
      setBooks(transformed);
      setTotalBooks(res.totalBooks || transformed.length);
    } catch (err) {
      console.error("Failed to fetch paginated books:", err);
      setBooks([]);
      setTotalBooks(0);
    }
  };

  useEffect(() => {
    fetchLibraryMetadata();
  }, [selectedLibraryId]);

  // Reset page to 1 on filter/search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedLibraryId, searchTerm, sortBy, sortOrder]);

  useEffect(() => {
    fetchPaginatedBooks();
  }, [selectedLibraryId, searchTerm, sortBy, sortOrder, currentPage]);

  const fetchLibraryBooks = async () => {
    // Legacy function preserved for scan status polling / manual refresh triggers
    await Promise.all([
      fetchLibraryMetadata(),
      fetchPaginatedBooks()
    ]);
  };

  const handleRescan = async () => {
    const libId = selectedLibraryId || (libraries.length > 0 ? libraries[0].id : "");
    if (!libId) return;
    setIsRescanning(true);
    try {
      await api.scanLibrary(libId);
      
      const startTime = Date.now();
      const pollInterval = 3000; // poll every 3 seconds
      const maxDuration = 60000; // max 60 seconds (1 minute timeout)
      
      const pollScanStatus = async () => {
        if (!isMounted.current) return;
        
        try {
          // 1. Fetch current books and stats to update the UI in real-time
          await fetchLibraryBooks();
          
          // 2. Fetch tasks to check if the scan is still active on the server
          const tasksData = await api.getTasks().catch(() => null);
          const tasks = Array.isArray(tasksData)
            ? tasksData
            : (tasksData?.tasks || tasksData?.results || []);
          
          const isScanActive = tasks.some((t: any) => 
            (t.type === 'scan' || t.action === 'library-scan' || t.name === 'Library Scan') &&
            (t.status === 'running' || t.status === 'pending')
          );
          
          const elapsed = Date.now() - startTime;
          if (isScanActive && elapsed < maxDuration) {
            setTimeout(pollScanStatus, pollInterval);
          } else {
            // Scan finished or timed out - trigger targeted incremental sync
            await api.triggerSync(libId, false).catch(err => {
              console.error("Failed to sync library cache:", err);
            });
            // Do one final fetch of updated items and stop spinner
            await fetchLibraryBooks();
            setIsRescanning(false);
          }
        } catch (err) {
          console.error("Error during scan polling:", err);
          // Fallback: trigger cache sync and reload
          await api.triggerSync(libId, false).catch(() => null);
          await fetchLibraryBooks();
          setIsRescanning(false);
        }
      };
      
      // Start polling
      setTimeout(pollScanStatus, pollInterval);
      
    } catch (err) {
      console.error("Rescan failed to start:", err);
      setIsRescanning(false);
    }
  };

  const handleMatchSuccess = (id: string) => {
    setMatchStatus(prev => ({ ...prev, [id]: 'success' }));
    setTimeout(() => {
      setMatchStatus(prev => ({ ...prev, [id]: null }));
      fetchLibraryBooks();
    }, 2000);
  };

  const paginatedBooks = books;


  return (
    <div className="flex flex-col gap-4">
      {/* Upper Control Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Repository Management</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-tight">Systematic overview of indexed digital assets.</p>
        </div>
        <div className="flex items-center gap-3">
          {libraries.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Active Node:</span>
              <select
                value={selectedLibraryId}
                onChange={(e) => {
                  setSelectedLibraryId(e.target.value);
                  setCurrentPage(1);
                }}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-950/30 outline-none transition-all cursor-pointer hover:border-slate-300 dark:hover:border-slate-700"
              >
                {libraries.map((lib) => (
                  <option key={lib.id} value={lib.id}>
                    {lib.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button 
            onClick={handleRescan}
            disabled={isRescanning}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm",
              isRescanning 
                ? "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed" 
                : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95 shadow-indigo-100 dark:shadow-none"
            )}
          >
            <RefreshCw size={14} className={cn(isRescanning && "animate-spin")} />
            {isRescanning ? "Scanning..." : "Rescan Library"}
          </button>
        </div>
      </div>

      {/* Metrics and Library Growth Chart Container */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Metric Cards Stack */}
        <div className="lg:col-span-1">
          {/* MOBILE VIEW ONLY: Single Merged Metric Card */}
          <div className="block lg:hidden bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              {[
                { label: "Total Indexed", value: totalBooks, icon: BookOpen, color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 dark:bg-indigo-950/30" },
                { label: "Library Size", value: formatBytes(libraryStats?.totalSize), icon: Database, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30" },
                { label: "Play Duration", value: formatDuration(libraryStats?.totalDuration), icon: Clock, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
                { label: "Unique Authors", value: libraryStats?.totalAuthors || 0, icon: UserIcon, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950/30" },
              ].map((stat, idx) => (
                <div key={stat.label} className={cn("flex items-center gap-3", idx % 2 === 1 && "pl-2 border-l border-slate-100 dark:border-slate-800")}>
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", stat.bg, stat.color)}>
                    <stat.icon size={14} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-0.5 truncate">{stat.label}</p>
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-none truncate">{stat.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* DESKTOP VIEW ONLY: Stacked Vertical Cards */}
          <div className="hidden lg:flex flex-col gap-3 h-full">
            {[
              { label: "Total Indexed", value: totalBooks, icon: BookOpen, color: "text-indigo-600 dark:text-indigo-400", bg: "bg-indigo-50 dark:bg-indigo-950/30" },
              { label: "Library Size", value: formatBytes(libraryStats?.totalSize), icon: Database, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30" },
              { label: "Play Duration", value: formatDuration(libraryStats?.totalDuration), icon: Clock, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30" },
              { label: "Unique Authors", value: libraryStats?.totalAuthors || 0, icon: UserIcon, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950/30" },
            ].map((stat) => (
              <div key={stat.label} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-3.5 flex items-center gap-3.5 shadow-sm flex-grow justify-start">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", stat.bg, stat.color)}>
                  <stat.icon size={16} />
                </div>
                <div>
                  <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-0.5 leading-none">{stat.label}</p>
                  <p className="text-base font-extrabold text-slate-900 dark:text-slate-100 leading-none mt-1">{stat.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Library Growth Chart Card (Occupies 3/4 columns on desktop) */}
        <div className="lg:col-span-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 flex flex-col justify-between h-[360px]">
          <div className="flex items-center justify-between mb-4 px-2 shrink-0">
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 uppercase tracking-tight flex items-center gap-1.5">
                <TrendingUp size={14} className="text-indigo-600 dark:text-indigo-400 animate-pulse" />
                Library Growth
              </h3>
              <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold mt-0.5">
                Cumulative playback hours indexed over time
              </p>
            </div>
            <div className="flex bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200/50 dark:border-slate-700/50">
              {[
                { label: '7D', value: '7' },
                { label: '30D', value: '30' },
                { label: '1Y', value: '365' },
                { label: 'ALL', value: 'all' }
              ].map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => setChartTimeframe(tf.value as any)}
                  className={`px-2 py-1 text-[9px] font-bold uppercase rounded-md transition-all cursor-pointer ${chartTimeframe === tf.value ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-100'}`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="h-[240px] w-full flex flex-col justify-end gap-4 p-4 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl border border-slate-100 dark:border-slate-800/50 animate-pulse relative overflow-hidden select-none">
              <div className="absolute inset-0 flex items-center justify-center bg-white/40 dark:bg-slate-900/40 backdrop-blur-[1px]">
                <div className="flex flex-col items-center gap-2">
                  <Clock size={24} className="text-indigo-500 animate-spin" style={{ animationDuration: '3s' }} />
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Syncing growth trends...</p>
                </div>
              </div>
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-[240px] w-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/20 dark:bg-slate-900/10">
              <AlertCircle size={20} className="text-slate-400 dark:text-slate-500" />
              <div className="text-center">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">No indexing history</p>
                <p className="text-[8px] font-medium text-slate-400 dark:text-slate-500">Add assets to start visualizing library growth.</p>
              </div>
            </div>
          ) : (
            <div className="h-[240px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ left: -20, right: 10, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={isDark ? 0.35 : 0.2}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? "#334155" : "#f1f5f9"} />
                  <XAxis 
                    type="number"
                    dataKey="timestamp"
                    domain={[minTime, maxTime]}
                    tickFormatter={getTickFormatter(chartTimeframe)}
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 9, fill: isDark ? '#94a3b8' : '#64748b', fontWeight: 600 }} 
                    dy={5} 
                    minTickGap={20}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 9, fill: isDark ? '#94a3b8' : '#64748b', fontWeight: 600 }} 
                    tickFormatter={(v) => `${Math.round(v)}h`}
                  />
                  <Tooltip 
                    cursor={{ stroke: isDark ? '#334155' : '#cbd5e1', strokeWidth: 1 }}
                    content={<CustomChartTooltip isDark={isDark} />}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="hours" 
                    stroke={isDark ? "#818cf8" : "#6366f1"} 
                    strokeWidth={2} 
                    fillOpacity={1} 
                    fill="url(#colorHours)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Repository Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden mb-6">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50/30 dark:bg-slate-800/20 gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-grow max-w-2xl w-full sm:w-auto">
            <div className="relative flex-grow">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input 
                type="text" 
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1); // Reset page on search
                }}
                placeholder="Search volume by title, author, or ID..." 
                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-1.5 pl-9 pr-3 text-[11px] font-medium focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-950/30 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all"
              />
            </div>
            <div className="flex items-center justify-between sm:justify-start gap-3 shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as any);
                    setCurrentPage(1); // Reset page on sort change
                  }}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-2 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-950/30 outline-none transition-all cursor-pointer hover:border-slate-300 dark:hover:border-slate-700"
                >
                  <option value="addedAt">Added On</option>
                  <option value="title">Title</option>
                  <option value="author">Author</option>
                </select>
                <button
                  onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                  className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-805 transition-colors text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-950 flex items-center justify-center active:scale-95 cursor-pointer"
                  title={`Sort ${sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
                >
                  {sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                </button>
              </div>
              
              {/* Mobile Display Controls: visible on mobile screens only, hidden on sm and above */}
              <div className="flex items-center gap-1 sm:hidden">
                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mr-1">Display:</span>
                <button 
                  onClick={() => setViewMode('table')}
                  className={cn("p-1 px-2.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer", viewMode === 'table' ? "bg-white dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm" : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500")}
                >
                  TABLE
                </button>
                <button 
                  onClick={() => setViewMode('grid')}
                  className={cn("p-1 px-2.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer", viewMode === 'grid' ? "bg-white dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm" : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500")}
                >
                  GRID
                </button>
              </div>
            </div>
          </div>
          
          {/* Desktop Display Controls: hidden on mobile, visible on sm and above */}
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mr-2">Display:</span>
            <button 
              onClick={() => setViewMode('table')}
              className={cn("p-1 px-2.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer", viewMode === 'table' ? "bg-white dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm" : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500")}
            >
              TABLE
            </button>
            <button 
              onClick={() => setViewMode('grid')}
              className={cn("p-1 px-2.5 rounded-lg text-[9px] font-bold transition-all cursor-pointer", viewMode === 'grid' ? "bg-white dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm" : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500")}
            >
              GRID
            </button>
          </div>
        </div>


        {viewMode === 'table' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800">
                  <th 
                    className="px-3 sm:px-5 py-3 cursor-pointer select-none hover:bg-slate-100/30 dark:hover:bg-slate-800/30 transition-colors"
                    onClick={() => handleHeaderClick('title')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Title / Author</span>
                      {sortBy === 'title' && (
                        sortOrder === 'asc' ? <ArrowUp size={10} className="text-indigo-600 dark:text-indigo-400" /> : <ArrowDown size={10} className="text-indigo-600" />
                      )}
                      {sortBy === 'author' && (
                        sortOrder === 'asc' ? <ArrowUp size={10} className="text-indigo-600 dark:text-indigo-400" /> : <ArrowDown size={10} className="text-indigo-600" />
                      )}
                    </div>
                  </th>
                  <th 
                    className="px-3 sm:px-5 py-3 cursor-pointer select-none hover:bg-slate-100/30 dark:hover:bg-slate-800/30 transition-colors"
                    onClick={() => handleHeaderClick('addedAt')}
                  >
                    <div className="flex items-center gap-1">
                      <span>Added On</span>
                      {sortBy === 'addedAt' && (
                        sortOrder === 'asc' ? <ArrowUp size={10} className="text-indigo-600 dark:text-indigo-400" /> : <ArrowDown size={10} className="text-indigo-600" />
                      )}
                    </div>
                  </th>
                  <th className="px-3 sm:px-5 py-3 text-right select-none">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={3} className="px-3 sm:px-5 py-12 text-center">
                      <RefreshCw size={20} className="animate-spin text-indigo-600 dark:text-indigo-400 mx-auto mb-2" />
                      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Syncing repository contents...</p>
                    </td>
                  </tr>
                ) : paginatedBooks.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 sm:px-5 py-12 text-center">
                      <AlertCircle size={20} className="text-slate-400 dark:text-slate-500 mx-auto mb-2" />
                      <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">No assets match your search</p>
                    </td>
                  </tr>
                ) : (
                  paginatedBooks.map((book) => (
                    <tr 
                      key={book.id} 
                      onClick={() => {
                        setSelectedBookForDetails(book);
                        setInitialModalTab('details');
                      }}
                      className="group hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors cursor-pointer"
                    >
                      <td className="px-3 sm:px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden flex-shrink-0 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-300 dark:text-slate-600 relative">
                            <CoverImage
                              itemId={book.id}
                              title={book.metadata?.title}
                              className="w-full h-full object-cover aspect-square"
                            />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{book.metadata?.title}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{book.metadata?.authorName}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 sm:px-5 py-3">
                        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300">{formatDistanceToNow(book.addedAt)} ago</p>
                      </td>
                      <td className="px-3 sm:px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBookForDetails(book);
                              setInitialModalTab('match');
                            }}
                            className={cn(
                              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all cursor-pointer",
                              matchStatus[book.id] === 'success' 
                                ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400" 
                                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-900 dark:hover:bg-slate-700 hover:text-white"
                            )}
                          >
                            {matchStatus[book.id] === 'success' ? <CheckCircle2 size={10} /> : <Sparkles size={10} />}
                            {matchStatus[book.id] === 'success' ? "DONE" : "MATCH"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {loading ? (
              <div className="col-span-full py-12 text-center">
                <RefreshCw size={20} className="animate-spin text-indigo-600 dark:text-indigo-400 mx-auto mb-2" />
                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Syncing repository contents...</p>
              </div>
            ) : paginatedBooks.length === 0 ? (
              <div className="col-span-full py-12 text-center">
                <AlertCircle size={20} className="text-slate-400 dark:text-slate-500 mx-auto mb-2" />
                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">No assets match your search</p>
              </div>
            ) : (
              paginatedBooks.map((book) => (
                <div 
                  key={book.id} 
                  onClick={() => {
                    setSelectedBookForDetails(book);
                    setInitialModalTab('details');
                  }}
                  className="group flex flex-col gap-2 cursor-pointer"
                >
                  <div className="w-full aspect-square bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-sm group-hover:shadow-md group-hover:border-indigo-200 dark:group-hover:border-indigo-800/80 transition-all relative flex items-center justify-center text-slate-350 dark:text-slate-600">
                    <CoverImage
                      itemId={book.id}
                      title={book.metadata?.title}
                      className="w-full h-full object-cover aspect-square animate-fade-in"
                    />
                    
                    <div className="absolute top-2 right-2 flex gap-1">
                      {matchStatus[book.id] === 'success' ? (
                        <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                          <CheckCircle2 size={12} />
                        </div>
                      ) : (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedBookForDetails(book);
                            setInitialModalTab('match');
                          }}
                          className="w-6 h-6 rounded-full bg-white/90 dark:bg-slate-900/95 backdrop-blur text-slate-650 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-800 flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                          title="Match Metadata"
                        >
                          <Sparkles size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100 line-clamp-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors" title={book.metadata?.title}>{book.metadata?.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-medium line-clamp-1" title={book.metadata?.authorName}>{book.metadata?.authorName}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        
        {!loading && totalBooks > 0 && (
          <div className="px-4 py-3 bg-slate-50/30 dark:bg-slate-800/10 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="font-semibold text-slate-500 dark:text-slate-400">
              Showing <span className="text-slate-850 dark:text-slate-200">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</span> to{" "}
              <span className="text-slate-850 dark:text-slate-200">{Math.min(totalBooks, currentPage * ITEMS_PER_PAGE)}</span> of{" "}
              <span className="text-slate-855 dark:text-slate-205">{totalBooks}</span> assets
            </div>
            
            <div className="flex items-center gap-1.5">
              {/* First Page */}
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className={cn(
                  "p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
                )}
                title="First Page"
              >
                <ChevronsLeft size={13} />
              </button>

              {/* Prev Page */}
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className={cn(
                  "p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
                )}
                title="Previous Page"
              >
                <ChevronLeft size={13} />
              </button>

              {/* Page Numbers */}
              {getPageNumbers().map((p, idx) => (
                <button
                  key={idx}
                  onClick={() => typeof p === 'number' && setCurrentPage(p)}
                  disabled={p === '...'}
                  className={cn(
                    "min-w-8 h-8 px-2 rounded-lg text-[10px] font-extrabold transition-all flex items-center justify-center cursor-pointer",
                    p === currentPage
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
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className={cn(
                  "p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
                )}
                title="Next Page"
              >
                <ChevronRight size={13} />
              </button>

              {/* Last Page */}
              <button
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
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

      {/* Interactive Metadata & Chapters Details Modal */}
      <AnimatePresence>
        {selectedBookForDetails && (
          <BookDetailsModal
            book={selectedBookForDetails}
            initialTab={initialModalTab}
            onClose={() => setSelectedBookForDetails(null)}
            onMatchSuccess={() => handleMatchSuccess(selectedBookForDetails.id)}
            isDark={isDark}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
