import React, { useState, useEffect } from "react";
import { 
  X, Search, Sparkles, BookOpen, AlertCircle, 
  CheckCircle2, ChevronRight, Info, RefreshCw, HelpCircle,
  User as UserIcon, Calendar, Building, Globe, Hash, Clock, 
  Play, Tag, Award, Activity, BarChart3, Users, Headphones
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Book, MatchCandidate } from "../types";
import { api } from "../lib/api";
import { cn } from "../lib/utils";
import { CoverImage } from "./CoverImage";

interface BookDetailsModalProps {
  book: Book;
  initialTab?: "details" | "statistics" | "match" | "chapters";
  onClose: () => void;
  onMatchSuccess: () => void;
  isDark?: boolean;
}

const PROVIDERS = [
  { id: "audible", name: "Audible" },
  { id: "google", name: "Google Books" },
  { id: "openlibrary", name: "Open Library" },
  { id: "itunes", name: "iTunes" },
  { id: "audnexus", name: "Audnexus" }
];

// Helper to format duration in seconds to hh:mm:ss or mm:ss
function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const parts = [];
  if (h > 0) {
    parts.push(h.toString().padStart(2, "0"));
  }
  parts.push(m.toString().padStart(2, "0"));
  parts.push(s.toString().padStart(2, "0"));
  
  return parts.join(":");
}

export function BookDetailsModal({ book, initialTab = "details", onClose, onMatchSuccess, isDark = false }: BookDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<"details" | "statistics" | "match" | "chapters">(initialTab as any);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [fullItem, setFullItem] = useState<any>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Stats tab specific state
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [bookSessions, setBookSessions] = useState<any[]>([]);

  // Fetch book sessions
  const fetchBookSessions = async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const data = await api.getSessions({ 
        libraryItemId: book.id,
        limit: 5000,
        sort: "startedAt",
        desc: "1" 
      });
      // Strictly filter client-side in case the data provider ignores the libraryItemId parameter (e.g. Android DirectDataProvider offline cache)
      const filtered = (data.sessions || []).filter((s: any) => s.libraryItemId === book.id);
      setBookSessions(filtered);
    } catch (err: any) {
      console.error("Failed to fetch book sessions:", err);
      setStatsError("Failed to retrieve statistics for this audiobook.");
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "statistics" && bookSessions.length === 0 && !statsLoading && !statsError) {
      fetchBookSessions();
    }
  }, [activeTab, book.id]);

  // Match tab specific state
  const [provider, setProvider] = useState("audible");
  const [searchTitle, setSearchTitle] = useState(book.metadata?.title || "");
  const [searchAuthor, setSearchAuthor] = useState(book.metadata?.authorName || "");
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchResults, setMatchResults] = useState<MatchCandidate[]>([]);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchSearched, setMatchSearched] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<MatchCandidate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [matchSuccess, setMatchSuccess] = useState(false);

  // Fetch full item details (metadata + chapters)
  const fetchFullDetails = async () => {
    setDetailsLoading(true);
    setDetailsError(null);
    try {
      const data = await api.getItemDetails(book.id);
      setFullItem(data);
    } catch (err: any) {
      console.error("Failed to fetch audiobook details:", err);
      setDetailsError("Failed to retrieve detailed audiobook metadata.");
    } finally {
      setDetailsLoading(false);
    }
  };

  // Chapters lookup specific state
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupAsin, setLookupAsin] = useState("");
  const [lookupRegion, setLookupRegion] = useState("us");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResults, setLookupResults] = useState<any[] | null>(null);
  const [applyingChapters, setApplyingChapters] = useState(false);

  useEffect(() => {
    fetchFullDetails();
  }, [book.id]);

  // Sync the ASIN from the most recently fetched/matched metadata
  useEffect(() => {
    const asin = fullItem?.media?.metadata?.asin;
    if (asin) {
      setLookupAsin(asin.trim().toUpperCase());
    }
  }, [fullItem]);

  // Perform chapter lookup from Audnexus
  const AUDNEXUS_REGIONS = [
    { value: "us", label: "🇺🇸 US" },
    { value: "uk", label: "🇬🇧 UK" },
    { value: "au", label: "🇦🇺 AU" },
    { value: "de", label: "🇩🇪 DE" },
    { value: "fr", label: "🇫🇷 FR" },
    { value: "jp", label: "🇯🇵 JP" },
    { value: "it", label: "🇮🇹 IT" },
    { value: "es", label: "🇪🇸 ES" },
  ];

  const performChaptersLookup = async (asin: string, region?: string) => {
    const cleanAsin = asin?.trim()?.toUpperCase();
    if (!cleanAsin) {
      setLookupError("Audible ASIN is required for lookup.");
      return;
    }

    const effectiveRegion = region || lookupRegion || "us";
    setLookupLoading(true);
    setLookupError(null);
    setLookupResults(null);

    try {
      const data = await api.lookupChapters(cleanAsin, effectiveRegion);
      if (!data || !data.chapters || data.chapters.length === 0) {
        setLookupError("No chapters found for this ASIN on Audnexus. The book may not be in their database, or try a different region.");
      } else {
        const mapped = data.chapters.map((ch: any, idx: number) => ({
          id: idx,
          start: ch.startOffsetMs / 1000,
          end: (ch.startOffsetMs + ch.lengthMs) / 1000,
          title: ch.title || `Chapter ${idx + 1}`
        }));
        setLookupResults(mapped);
      }
    } catch (err: any) {
      console.error("Chapters lookup error:", err);
      const errMsg = err.response?.data?.error || err.message || "";
      const is404 = err.response?.status === 404 || errMsg.toLowerCase().includes("not found");
      setLookupError(
        is404
          ? "This ASIN was not found in the Audnexus database. Audnexus only indexes Audible-specific ASINs. Try a different region, or check that the ASIN is from an Audible product page (not Amazon)."
          : errMsg || "Failed to retrieve chapter information from Audnexus."
      );
    } finally {
      setLookupLoading(false);
    }
  };

  // Save the lookup chapters to the Audiobookshelf backend
  const handleSaveChapters = async () => {
    if (!lookupResults) return;

    setApplyingChapters(true);
    setLookupError(null);

    try {
      await api.updateChapters(book.id, lookupResults);
      // Success! Fetch updated details to re-render in timeline
      await fetchFullDetails();
      setIsLookingUp(false);
      setLookupResults(null);
    } catch (err: any) {
      console.error("Save chapters error:", err);
      setLookupError(
        err.response?.data?.error || 
        "Failed to write chapters to media asset."
      );
    } finally {
      setApplyingChapters(false);
    }
  };

  // Perform match search
  const handleMatchSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchTitle.trim()) {
      setMatchError("A title is required to search for matches.");
      return;
    }

    setMatchLoading(true);
    setMatchError(null);
    setMatchResults([]);
    setMatchSearched(true);
    setSelectedCandidate(null);

    try {
      const data = await api.searchMatches(book.id, provider, searchTitle.trim(), searchAuthor.trim() || undefined);
      setMatchResults(data || []);
      if (data && data.length === 0) {
        setMatchError("No match results found. Try refining parameters or changing providers.");
      }
    } catch (err: any) {
      console.error("Match search error:", err);
      setMatchError(
        err.response?.data?.error || 
        "Failed to query external metadata provider."
      );
    } finally {
      setMatchLoading(false);
    }
  };

  // Perform direct match association
  const handleConfirmMatch = async () => {
    if (!selectedCandidate) return;

    setConfirming(true);
    setMatchError(null);

    try {
      await api.matchLibraryItem(book.id, selectedCandidate);
      setMatchSuccess(true);
      setTimeout(async () => {
        onMatchSuccess();
        // Re-fetch details to show matched info in other tabs
        await fetchFullDetails();
        setConfirming(false);
        setMatchSuccess(false);
        setSelectedCandidate(null);
        setActiveTab("details");
      }, 1500);
    } catch (err: any) {
      console.error("Apply match error:", err);
      setMatchError(
        err.response?.data?.error || 
        "Failed to apply metadata updates. Please try again."
      );
      setConfirming(false);
    }
  };

  // Extract meta variables for display
  const media = fullItem?.media || {};
  const metadata = media.metadata || {};
  
  const displayTitle = metadata.title || book.metadata?.title || "Unknown Title";
  const displaySubtitle = metadata.subtitle || "";
  const displayAuthor = metadata.authorName || book.metadata?.authorName || "Unknown Author";
  const displayNarrator = metadata.narratorName || "";
  const displayPublisher = metadata.publisher || "";
  const displayPublishDate = metadata.publishedDate || metadata.publishedYear || "";
  const seriesList = Array.isArray(metadata.series) 
    ? metadata.series 
    : metadata.series 
      ? [{ name: metadata.series, sequence: metadata.seriesSequence || "" }]
      : [];
  const displayGenres = metadata.genres || [];
  const displayTags = metadata.tags || [];
  const displayDescription = metadata.description || "";
  const displayLanguage = metadata.language || "";
  const chapters = media.chapters || [];
  const duration = media.duration || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ type: "spring", duration: 0.4 }}
        className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200/80 dark:border-slate-800 max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden relative"
      >
        {/* Visual background accents */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-bl-full -z-10" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-slate-50 dark:bg-slate-950/20 rounded-tr-full -z-10" />

        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/20 dark:bg-slate-900/10">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-lg shrink-0">
                <BookOpen size={16} />
              </span>
              <h3 className="text-base font-black text-slate-900 dark:text-slate-100 tracking-tight truncate max-w-[280px] sm:max-w-md">
                {displayTitle}
              </h3>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider mt-1">
              By {displayAuthor}
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Dynamic Tab Bar */}
        <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 px-3 sm:px-5 py-1 gap-0.5 sm:gap-1">
          {[
            { id: "details", label: "Details", icon: Info },
            { id: "statistics", label: "Stats", icon: Activity },
            { id: "match", label: "Match", icon: Sparkles },
            { id: "chapters", label: "Chapters", icon: Clock }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as any);
                  setMatchError(null);
                }}
                className={cn(
                  "flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-4 py-1.5 sm:py-2 text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-all rounded-xl relative cursor-pointer",
                  isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100/50 dark:hover:bg-slate-800/30"
                )}
              >
                {isActive && (
                  <motion.div 
                    layoutId="modalActiveTabIndicator" 
                    className="absolute inset-0 bg-white dark:bg-slate-800 shadow-sm border border-slate-200/50 dark:border-slate-700/30 rounded-xl -z-10"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <Icon size={12} className="sm:w-[13px] sm:h-[13px]" />
                {tab.label}
                {tab.id === "chapters" && chapters.length > 0 && (
                  <span className={cn(
                    "ml-0.5 sm:ml-1 text-[8px] sm:text-[9px] font-black px-1 sm:px-1.5 py-0.25 sm:py-0.5 rounded-full",
                    isActive ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-400" : "bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                  )}>
                    {chapters.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Main Scrollable Content */}
        <div className="flex-grow overflow-y-auto p-6 flex flex-col min-h-[300px]">
          {detailsLoading && activeTab !== "match" && activeTab !== "statistics" ? (
            <div className="flex-grow flex flex-col items-center justify-center py-16">
              <RefreshCw size={28} className="animate-spin text-indigo-600 dark:text-indigo-400 mb-3" />
              <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                Fetching audiobook details...
              </p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              {activeTab === "details" && (
                <motion.div
                  key="details-tab"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.2 }}
                  className="grid grid-cols-1 md:grid-cols-12 gap-6"
                >
                  {/* Left Column - Cover and Pills */}
                  <div className="md:col-span-4 flex flex-col gap-4">
                    <div className="aspect-square bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-md flex items-center justify-center text-slate-300 dark:text-slate-700 relative group hover:scale-[1.01] transition-transform">
                      <CoverImage
                        itemId={book.id}
                        title={displayTitle}
                        className="w-full h-full object-cover aspect-square"
                      />
                    </div>

                    {/* Quick Stats Pill */}
                    {duration > 0 && (
                      <div className="bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100/50 dark:border-indigo-900/20 rounded-2xl p-3 flex items-center gap-3">
                        <Clock size={16} className="text-indigo-600 dark:text-indigo-400" />
                        <div>
                          <p className="text-[8px] font-bold text-indigo-400 dark:text-indigo-500 uppercase tracking-widest leading-none">Total Duration</p>
                          <p className="text-xs font-bold text-indigo-900 dark:text-indigo-200 mt-1">{formatDuration(duration)}</p>
                        </div>
                      </div>
                    )}

                    {/* Genres Badges */}
                    {displayGenres.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1">
                          <Tag size={10} /> Genres
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {displayGenres.map((genre: string, i: number) => (
                            <span 
                              key={i} 
                              className="bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-100/30 dark:border-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-[9px] font-bold px-2 py-0.5 rounded-lg"
                            >
                              {genre}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Column - Rich Metadata Fields */}
                  <div className="md:col-span-8 space-y-5">
                    <div>
                      <h4 className="text-lg font-black text-slate-900 dark:text-slate-100 tracking-tight leading-snug">{displayTitle}</h4>
                      {displaySubtitle && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium tracking-tight mt-1">{displaySubtitle}</p>
                      )}
                      
                      {seriesList.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {seriesList.map((s: any, idx: number) => (
                            <div key={idx} className="inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/30 text-amber-800 dark:text-amber-400 text-[9px] font-bold px-2 py-0.5 rounded-lg shadow-sm">
                              <Award size={10} />
                              <span>{s.name || s} {s.sequence && `#${s.sequence}`}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <hr className="border-slate-100 dark:border-slate-800" />

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                      <div className="flex items-center gap-2">
                        <UserIcon size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Author</p>
                          <p className="font-bold text-slate-700 dark:text-slate-300 truncate">{displayAuthor}</p>
                        </div>
                      </div>
                      
                      {displayNarrator && (
                        <div className="flex items-center gap-2">
                          <Globe size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Narrator</p>
                            <p className="font-bold text-slate-700 dark:text-slate-300 truncate">{displayNarrator}</p>
                          </div>
                        </div>
                      )}

                      {displayPublisher && (
                        <div className="flex items-center gap-2">
                          <Building size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Publisher</p>
                            <p className="font-bold text-slate-700 dark:text-slate-300 truncate">{displayPublisher}</p>
                          </div>
                        </div>
                      )}

                      {displayPublishDate && (
                        <div className="flex items-center gap-2">
                          <Calendar size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Release Date</p>
                            <p className="font-bold text-slate-700 dark:text-slate-300 truncate">{displayPublishDate}</p>
                          </div>
                        </div>
                      )}

                      {displayLanguage && (
                        <div className="flex items-center gap-2">
                          <Globe size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Language</p>
                            <p className="font-bold text-slate-700 dark:text-slate-300 truncate">{displayLanguage}</p>
                          </div>
                        </div>
                      )}

                      {(metadata.isbn || metadata.asin) && (
                        <div className="flex items-center gap-2">
                          <Hash size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[8px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Catalog Code</p>
                            <p className="font-bold text-slate-700 dark:text-slate-300 truncate uppercase">
                              {metadata.asin ? `ASIN: ${metadata.asin}` : `ISBN: ${metadata.isbn}`}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    <hr className="border-slate-100 dark:border-slate-800" />

                    {/* Book Description */}
                    {displayDescription ? (
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Description</span>
                        <div className="bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed max-h-[180px] overflow-y-auto shadow-inner">
                          {displayDescription}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-slate-50 dark:bg-slate-950 border border-dashed border-slate-200 dark:border-slate-800 p-6 rounded-2xl text-center text-slate-400 dark:text-slate-500 text-xs font-semibold">
                        No description cataloged for this asset.
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === "statistics" && (
                <motion.div
                  key="statistics-tab"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col gap-6 flex-grow"
                >
                  {statsLoading ? (
                    <div className="flex-grow flex flex-col items-center justify-center py-16">
                      <RefreshCw size={28} className="animate-spin text-indigo-600 dark:text-indigo-400 mb-3" />
                      <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                        Compiling statistics...
                      </p>
                    </div>
                  ) : statsError ? (
                    <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 text-rose-800 dark:text-rose-400 p-4 rounded-2xl flex items-start gap-2.5 text-xs font-semibold">
                      <AlertCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                      <div>{statsError}</div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Overall Statistics Summary */}
                      {(() => {
                        const totalTime = bookSessions.reduce((acc, s) => acc + (s.timeListening || 0), 0);
                        const uniqueUsers = new Set(bookSessions.map(s => s.userId)).size;
                        const totalSessions = bookSessions.length;
                        const lastListened = bookSessions.reduce((latest, s) => Math.max(latest, s.updatedAt || 0), 0);

                        return (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col gap-1 items-center justify-center text-center">
                              <Headphones size={20} className="text-indigo-500 mb-1" />
                              <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Total Time</p>
                              <p className="text-lg font-black text-slate-800 dark:text-slate-100">{formatDuration(totalTime)}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col gap-1 items-center justify-center text-center">
                              <Users size={20} className="text-indigo-500 mb-1" />
                              <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Listeners</p>
                              <p className="text-lg font-black text-slate-800 dark:text-slate-100">{uniqueUsers}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col gap-1 items-center justify-center text-center">
                              <BarChart3 size={20} className="text-indigo-500 mb-1" />
                              <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Sessions</p>
                              <p className="text-lg font-black text-slate-800 dark:text-slate-100">{totalSessions}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl flex flex-col gap-1 items-center justify-center text-center">
                              <Calendar size={20} className="text-indigo-500 mb-1" />
                              <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Last Listened</p>
                              <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate w-full">
                                {lastListened > 0 ? new Date(lastListened).toLocaleDateString() : 'Never'}
                              </p>
                            </div>
                          </div>
                        );
                      })()}

                      {/* User Progress */}
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800 pb-2">
                          User Progress
                        </h4>
                        {(() => {
                          const getSessionProgressPercent = (session: any) => {
                            if (session.progress !== undefined) return Math.round(session.progress * 100);
                            if (session.currentTime && session.duration) return Math.round((session.currentTime / session.duration) * 100);
                            if (session.currentTime && duration) return Math.round((session.currentTime / duration) * 100);
                            return null;
                          };

                          // Aggregate latest progress per user
                          const userProgressMap = new Map();
                          bookSessions.forEach(s => {
                            if (!s.user?.username && !s.username) return; // Skip if no user info
                            const username = s.user?.username || s.username || 'Unknown';
                            if (!userProgressMap.has(s.userId)) {
                              userProgressMap.set(s.userId, { username, progressPercent: 0, latestTime: 0 });
                            }
                            const existing = userProgressMap.get(s.userId);
                            const sessionTime = s.startedAt || s.updatedAt || 0;
                            
                            if (sessionTime >= existing.latestTime) {
                              existing.latestTime = sessionTime;
                              const progress = getSessionProgressPercent(s);
                              existing.progressPercent = progress !== null ? progress : existing.progressPercent;
                            }
                          });
                          const progressList = Array.from(userProgressMap.values());
                          
                          if (progressList.length === 0) {
                            return (
                              <div className="text-xs text-slate-400 dark:text-slate-500 italic py-4 text-center">
                                No listening progress recorded for this book yet.
                              </div>
                            );
                          }

                          return (
                            <div className="space-y-3">
                              {progressList.map((p: any, idx) => (
                                <div key={idx} className="flex items-center gap-4">
                                  <div className="w-24 shrink-0 truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                                    {p.username}
                                  </div>
                                  <div className="flex-grow h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full bg-indigo-500 rounded-full" 
                                      style={{ width: `${Math.min(100, Math.max(0, p.progressPercent))}%` }} 
                                    />
                                  </div>
                                  <div className="w-12 shrink-0 text-right text-[10px] font-black text-indigo-600 dark:text-indigo-400">
                                    {Math.round(p.progressPercent)}%
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>

                      {/* Recent Sessions */}
                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800 pb-2">
                          Recent Sessions
                        </h4>
                        {bookSessions.length === 0 ? (
                          <div className="text-xs text-slate-400 dark:text-slate-500 italic py-4 text-center">
                            No listening sessions recorded for this book yet.
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-[240px] overflow-y-auto pr-2">
                            {[...bookSessions]
                              .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
                              .slice(0, 10)
                              .map((session, idx) => {
                                const getSessionProgressPercent = (s: any) => {
                                  if (s.progress !== undefined) return Math.round(s.progress * 100);
                                  if (s.currentTime && s.duration) return Math.round((s.currentTime / s.duration) * 100);
                                  if (s.currentTime && duration) return Math.round((s.currentTime / duration) * 100);
                                  return null;
                                };
                                const sessionProgress = getSessionProgressPercent(session);

                                return (
                                  <div key={session.id || idx} className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-3 flex items-center justify-between">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
                                        <Play size={14} className="ml-0.5" />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate">
                                          {session.user?.username || session.username || 'Unknown User'}
                                        </p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                            {new Date(session.startedAt || session.updatedAt).toLocaleString()}
                                          </p>
                                          {sessionProgress !== null && (
                                            <div className="flex items-center gap-1.5 ml-2">
                                              <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1 py-0.2 rounded">
                                                {sessionProgress}%
                                              </span>
                                              <div className="w-12 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                                <div 
                                                  className="h-full bg-indigo-600 dark:bg-indigo-500 rounded-full" 
                                                  style={{ width: `${Math.min(100, Math.max(0, sessionProgress))}%` }}
                                                />
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0 ml-3">
                                      <p className="text-xs font-black text-indigo-600 dark:text-indigo-400">
                                        {formatDuration(session.timeListening || 0)}
                                      </p>
                                      <p className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">
                                        Listened
                                      </p>
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === "match" && (
                <motion.div
                  key="match-tab"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col gap-4 flex-grow"
                >
                  {/* Search Fields Form */}
                  {!selectedCandidate && (
                    <form onSubmit={handleMatchSearch} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 p-4 rounded-2xl">
                      <div className="md:col-span-1 space-y-1.5">
                        <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Provider</label>
                        <select
                          value={provider}
                          onChange={(e) => setProvider(e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-950/30 outline-none transition-all cursor-pointer hover:border-slate-300 dark:hover:border-slate-700"
                        >
                          {PROVIDERS.map((prov) => (
                            <option key={prov.id} value={prov.id}>
                              {prov.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="md:col-span-1.5 space-y-1.5">
                        <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Search Title</label>
                        <input
                          type="text"
                          placeholder="Title"
                          value={searchTitle}
                          onChange={(e) => setSearchTitle(e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-1.5 text-xs font-semibold focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-950/30 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-550 outline-none transition-all"
                          required
                        />
                      </div>

                      <div className="md:col-span-1.5 space-y-1.5">
                        <label className="text-[9px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-widest block">Search Author</label>
                        <input
                          type="text"
                          placeholder="Author (Optional)"
                          value={searchAuthor}
                          onChange={(e) => setSearchAuthor(e.target.value)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-1.5 text-xs font-semibold focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-950/30 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all"
                        />
                      </div>

                      <div className="md:col-span-4 flex justify-end">
                        <button
                          type="submit"
                          disabled={matchLoading}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-wider px-5 py-2 rounded-xl transition-all active:scale-95 shadow-md shadow-indigo-100 dark:shadow-none flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                        >
                          {matchLoading ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
                          {matchLoading ? "SEARCHING..." : "SEARCH MATCHES"}
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Results lists & Selection steps */}
                  <div className="flex-grow flex flex-col min-h-[220px]">
                    {/* Error notification */}
                    {matchError && (
                      <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 text-rose-800 dark:text-rose-400 p-4 rounded-2xl flex items-start gap-2.5 text-xs font-semibold mb-4 animate-shake animate-duration-300">
                        <AlertCircle size={16} className="text-rose-500 dark:text-rose-400 shrink-0 mt-0.5" />
                        <div>{matchError}</div>
                      </div>
                    )}

                    {/* Searching Loader */}
                    {matchLoading && (
                      <div className="flex-grow flex flex-col items-center justify-center py-12 text-center">
                        <RefreshCw size={24} className="animate-spin text-indigo-600 dark:text-indigo-400 mb-3" />
                        <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Querying database for matches...</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Connecting to {PROVIDERS.find(p => p.id === provider)?.name}</p>
                      </div>
                    )}

                    {/* Display candidates list */}
                    {!matchLoading && !selectedCandidate && matchSearched && matchResults.length > 0 && (
                      <div className="space-y-3 flex-grow">
                        <h4 className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1">
                          <Info size={11} /> {matchResults.length} Candidates Found
                        </h4>
                        <div className="grid grid-cols-1 gap-2 max-h-[280px] overflow-y-auto pr-1">
                          {matchResults.map((candidate, idx) => (
                            <motion.div
                              key={candidate.id || idx}
                              initial={{ opacity: 0, y: 5 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.03 }}
                              onClick={() => setSelectedCandidate(candidate)}
                              className="group border border-slate-100 dark:border-slate-800 rounded-2xl p-3 flex gap-4 bg-white dark:bg-slate-900 hover:bg-slate-50/50 dark:hover:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700 transition-all cursor-pointer items-start"
                            >
                              <div className="w-12 h-18 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden shrink-0 flex items-center justify-center text-slate-300 dark:text-slate-700 group-hover:shadow-sm transition-shadow">
                                {candidate.coverUrl ? (
                                  <img
                                    src={candidate.coverUrl}
                                    alt={candidate.title}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      (e.target as HTMLElement).style.display = "none";
                                    }}
                                  />
                                ) : (
                                  <BookOpen size={20} />
                                )}
                              </div>

                              <div className="flex-grow min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-[11px] font-bold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors leading-tight truncate">
                                    {candidate.title}
                                  </p>
                                  <span className="bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400 text-[8px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0">
                                    {candidate.provider}
                                  </span>
                                </div>
                                {candidate.subtitle && (
                                  <p className="text-[9px] text-slate-400 dark:text-slate-500 font-semibold leading-tight mt-0.5 truncate">{candidate.subtitle}</p>
                                )}
                                <p className="text-[9px] text-slate-600 dark:text-slate-300 font-bold mt-1">By {candidate.author || "Unknown Author"}</p>
                                
                                <div className="flex items-center gap-3 mt-2 text-[8px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">
                                  {candidate.publisher && <span className="truncate max-w-[150px]">{candidate.publisher}</span>}
                                  {candidate.publishDate && <span>({candidate.publishDate.slice(0, 4)})</span>}
                                  {candidate.asin && <span>ASIN: {candidate.asin}</span>}
                                  {candidate.isbn && <span>ISBN: {candidate.isbn}</span>}
                                </div>
                              </div>

                              <div className="self-center p-1 border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-950/40 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 rounded-lg transition-colors">
                                <ChevronRight size={14} />
                              </div>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Unsearched placeholder */}
                    {!matchLoading && !matchSearched && (
                      <div className="flex-grow flex flex-col items-center justify-center py-12 text-center">
                        <HelpCircle size={32} className="text-slate-300 dark:text-slate-600 mb-3" />
                        <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Awaiting search initiation</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500 font-medium max-w-sm mt-1">
                          Adjust metadata search parameters above and click Search to query online catalog providers.
                        </p>
                      </div>
                    )}

                    {/* Side-by-Side Confirmation Step */}
                    {selectedCandidate && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                          <h4 className="text-[10px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-widest">Confirm Match Association</h4>
                          <button
                            type="button"
                            onClick={() => setSelectedCandidate(null)}
                            className="text-[9px] font-black text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors uppercase tracking-widest cursor-pointer"
                          >
                            Back to Candidates
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl relative overflow-hidden">
                          {confirming && (
                            <div className="absolute inset-0 bg-white/70 dark:bg-slate-900/70 backdrop-blur-[1px] flex flex-col items-center justify-center z-10 animate-fade-in">
                              {matchSuccess ? (
                                <div className="text-center">
                                  <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-2 animate-bounce" />
                                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">Match confirmed!</p>
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Syncing new library assets...</p>
                                </div>
                              ) : (
                                <div className="text-center">
                                  <RefreshCw size={24} className="animate-spin text-indigo-600 dark:text-indigo-400 mx-auto mb-2" />
                                  <p className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-widest">Writing metadata update...</p>
                                </div>
                              )}
                            </div>
                          )}

                          <div className="space-y-2.5">
                            <p className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest block">Proposed Metadata</p>
                            <div className="flex gap-3 bg-white dark:bg-slate-900 p-3 rounded-xl border border-indigo-100 dark:border-indigo-950/60 shadow-sm">
                              <div className="w-12 h-18 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden shrink-0 flex items-center justify-center text-slate-300 dark:text-slate-700">
                                {selectedCandidate.coverUrl ? (
                                  <img
                                    src={selectedCandidate.coverUrl}
                                    alt={selectedCandidate.title}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <BookOpen size={16} />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-bold text-slate-900 dark:text-slate-100 leading-snug truncate">{selectedCandidate.title}</p>
                                <p className="text-[9px] text-slate-500 dark:text-slate-400 font-bold mt-0.5 leading-snug truncate">By {selectedCandidate.author}</p>
                                
                                <div className="mt-2 text-[8px] text-slate-400 dark:text-slate-500 font-semibold space-y-0.5">
                                  {selectedCandidate.publisher && <p className="truncate">Pub: {selectedCandidate.publisher}</p>}
                                  {selectedCandidate.publishDate && <p>Date: {selectedCandidate.publishDate}</p>}
                                  {selectedCandidate.id && <p className="truncate uppercase">ID: {selectedCandidate.id}</p>}
                                </div>
                              </div>
                            </div>
                          </div>

                          {selectedCandidate.description && (
                            <div className="space-y-2.5">
                              <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Description Preview</p>
                              <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed max-h-[110px] overflow-y-auto shadow-sm">
                                {selectedCandidate.description}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-2">
                          <button
                            type="button"
                            onClick={() => setSelectedCandidate(null)}
                            disabled={confirming}
                            className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-[10px] font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                          >
                            CANCEL
                          </button>
                          <button
                            type="button"
                            onClick={handleConfirmMatch}
                            disabled={confirming}
                            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-bold transition-all active:scale-95 shadow-md shadow-indigo-100 dark:shadow-none flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                          >
                            <CheckCircle2 size={12} />
                            CONFIRM MATCH & SYNC
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {activeTab === "chapters" && (
                <motion.div
                  key="chapters-tab"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.2 }}
                  className="flex flex-col flex-grow min-h-0"
                >
                  {isLookingUp ? (
                    // Lookup flow active
                    <div className="flex-grow flex flex-col min-h-0">
                      {lookupLoading ? (
                        <div className="flex-grow flex flex-col items-center justify-center py-12 text-center">
                          <RefreshCw size={28} className="animate-spin text-indigo-600 dark:text-indigo-400 mb-3" />
                          <p className="text-[10px] font-black text-indigo-900 dark:text-indigo-300 uppercase tracking-widest">
                            Connecting to Audnexus...
                          </p>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 font-medium">
                            Searching for chapters: ASIN <span className="font-bold text-slate-600 dark:text-slate-300">{lookupAsin}</span> · Region <span className="font-bold text-slate-600 dark:text-slate-300 uppercase">{lookupRegion}</span>
                          </p>
                        </div>
                      ) : lookupResults ? (
                        // Results Preview
                        <div className="space-y-4 flex-grow flex flex-col min-h-0">
                          <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-900/30 text-emerald-800 dark:text-emerald-400 p-4 rounded-2xl flex items-start gap-2.5 text-xs font-medium shrink-0 animate-fade-in">
                            <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-bold">Fetched {lookupResults.length} chapters successfully!</p>
                              <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-0.5">Please review the chapter structure below and click "Apply" to save them to the audiobook.</p>
                            </div>
                          </div>

                          {/* Preview List */}
                          <div className="space-y-2 overflow-y-auto pr-1 flex-grow border border-slate-100 dark:border-slate-800 p-3 rounded-2xl bg-slate-50/30 dark:bg-slate-950/20 max-h-[220px]">
                            {lookupResults.map((chapter: any, index: number) => {
                              const chapDuration = (chapter.end - chapter.start);
                              return (
                                <div key={index} className="flex items-center justify-between text-[11px] p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 font-mono w-5">
                                      {(index + 1).toString().padStart(2, "0")}
                                    </span>
                                    <p className="font-bold text-slate-700 dark:text-slate-300 truncate">{chapter.title}</p>
                                  </div>
                                  <div className="flex items-center gap-4 text-[9px] font-bold text-slate-400 dark:text-slate-500 font-mono shrink-0">
                                    <span className="bg-slate-50 dark:bg-slate-950 px-1.5 py-0.5 rounded text-slate-500 dark:text-slate-400 border border-slate-100 dark:border-slate-800">
                                      {formatDuration(chapter.start)} - {formatDuration(chapter.end)}
                                    </span>
                                    <span className="text-slate-500 dark:text-slate-400 font-semibold w-12 text-right">{formatDuration(chapDuration)}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {lookupError && (
                            <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 text-rose-800 dark:text-rose-400 p-3 rounded-xl flex items-start gap-2 text-[11px] font-semibold shrink-0">
                              <AlertCircle size={14} className="text-rose-500 shrink-0 mt-0.5" />
                              <div>{lookupError}</div>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex justify-between items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 mt-auto shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setLookupResults(null);
                                setLookupError(null);
                                if (!metadata.asin) {
                                  // Keep ASIN input form open
                                } else {
                                  setIsLookingUp(false);
                                }
                              }}
                              className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 cursor-pointer"
                            >
                              Back
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveChapters}
                              disabled={applyingChapters}
                              className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 shadow-md shadow-indigo-100 dark:shadow-none flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                            >
                              {applyingChapters ? (
                                <>
                                  <RefreshCw size={12} className="animate-spin" />
                                  APPLYING...
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 size={12} />
                                  CONFIRM & APPLY
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      ) : (
                        // Form / Input step
                        <div className="space-y-4 p-4 border border-indigo-100/50 dark:border-indigo-950/40 bg-indigo-50/10 dark:bg-indigo-950/10 rounded-2xl flex-grow flex flex-col justify-center">
                          <div className="text-center max-w-md mx-auto space-y-2">
                            <Sparkles className="mx-auto text-indigo-500" size={24} />
                            <h4 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">Chapter Lookup via Audnexus</h4>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                              Audnexus indexes chapter data from Audible. Enter the book's Audible ASIN and select your regional storefront to find chapters.
                            </p>
                          </div>

                          {lookupError && (
                            <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 text-rose-800 dark:text-rose-400 p-3 rounded-xl flex items-start gap-2 text-[11px] font-semibold max-w-md mx-auto w-full">
                              <AlertCircle size={14} className="text-rose-500 shrink-0 mt-0.5" />
                              <div>{lookupError}</div>
                            </div>
                          )}

                          <div className="max-w-md mx-auto w-full space-y-3">
                            <div className="space-y-1.5">
                              <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Audible Region</label>
                              <div className="grid grid-cols-4 gap-1.5">
                                {AUDNEXUS_REGIONS.map((r) => (
                                  <button
                                    key={r.value}
                                    type="button"
                                    onClick={() => setLookupRegion(r.value)}
                                    className={`py-1.5 rounded-lg text-[10px] font-bold transition-all border cursor-pointer ${
                                      lookupRegion === r.value
                                        ? "bg-indigo-600 dark:bg-indigo-600 text-white border-indigo-600 dark:border-indigo-600 shadow-sm"
                                        : "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 hover:text-indigo-700 dark:hover:text-indigo-400"
                                    }`}
                                  >
                                    {r.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Audible ASIN</label>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={lookupAsin}
                                  onChange={(e) => {
                                    setLookupAsin(e.target.value.trim().toUpperCase());
                                    setLookupError(null);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && lookupAsin) performChaptersLookup(lookupAsin);
                                  }}
                                  placeholder="e.g. B08G9PRS1K"
                                  className="flex-grow bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-1.5 text-xs font-semibold focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-950/30 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none transition-all"
                                />
                                <button
                                  type="button"
                                  onClick={() => performChaptersLookup(lookupAsin)}
                                  disabled={!lookupAsin}
                                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-wider px-5 py-2 rounded-xl transition-all active:scale-95 shadow-md shadow-indigo-100 dark:shadow-none disabled:opacity-50 cursor-pointer"
                                >
                                  Lookup
                                </button>
                              </div>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium leading-relaxed">
                                Find the ASIN in the Audible product URL: <span className="font-bold text-slate-500 dark:text-slate-400 font-mono">audible.com/pd/Title/<span className="text-indigo-500 dark:text-indigo-400">B08G9PRS1K</span></span>.
                              </p>
                            </div>

                            <div className="flex justify-between items-center pt-2.5 border-t border-slate-100 dark:border-slate-800">
                              <button
                                type="button"
                                onClick={() => {
                                  setIsLookingUp(false);
                                  setLookupError(null);
                                }}
                                className="text-[9px] font-black text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 uppercase tracking-widest cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>

                      )}
                    </div>
                  ) : (
                    // Regular Timeline View
                    <div className="flex-grow flex flex-col min-h-0">
                      {chapters.length > 0 ? (
                        <div className="flex flex-col flex-grow min-h-0">
                          <div className="flex items-center justify-between text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800 pb-2 mb-2 shrink-0">
                            <span>Chapter Title / Index</span>
                            <div className="flex items-center gap-6">
                              <span>Timeline</span>
                              <span>Duration</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsLookingUp(true);
                                  setLookupAsin(metadata.asin || "");
                                  setLookupError(null);
                                  if (metadata.asin) {
                                    performChaptersLookup(metadata.asin);
                                  }
                                }}
                                className="ml-2 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded-lg transition-all flex items-center gap-1 font-bold text-[9px] shrink-0 cursor-pointer"
                              >
                                <Sparkles size={9} />
                                Lookup
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1.5 relative border-l-2 border-indigo-50 dark:border-indigo-950/40 pl-4 ml-2 overflow-y-auto pr-1 flex-grow max-h-[300px]">
                            {chapters.map((chapter: any, index: number) => {
                              const chapDuration = (chapter.end - chapter.start);
                              return (
                                <div 
                                  key={chapter.id || index}
                                  className="group hover:bg-slate-50 dark:hover:bg-slate-800/40 border border-transparent hover:border-slate-100 dark:hover:border-slate-800/80 p-2.5 rounded-xl transition-all flex items-center justify-between text-xs relative"
                                >
                                  {/* Timeline indicator bullet */}
                                  <div className="absolute w-2.5 h-2.5 rounded-full bg-slate-300 dark:bg-slate-700 group-hover:bg-indigo-600 dark:group-hover:bg-indigo-400 border border-white dark:border-slate-900 left-[-21.5px] top-1/2 -translate-y-1/2 transition-colors" />

                                  <div className="flex items-center gap-3 min-w-0">
                                    <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 font-mono w-5">
                                      {(index + 1).toString().padStart(2, "0")}
                                    </span>
                                    <div className="min-w-0">
                                      <p className="font-bold text-slate-800 dark:text-slate-200 truncate leading-tight group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                        {chapter.title || `Chapter ${index + 1}`}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-6 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase font-mono shrink-0">
                                    <span className="bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/30 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300 font-semibold font-sans text-[9px]">
                                      {formatDuration(chapter.start)} - {formatDuration(chapter.end)}
                                    </span>
                                    <span className="text-slate-500 dark:text-slate-400 font-semibold min-w-[50px] text-right">
                                      {formatDuration(chapDuration)}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="flex-grow flex flex-col items-center justify-center py-12 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-950/20 animate-fade-in">
                          <Clock size={32} className="text-slate-300 dark:text-slate-650 mb-3" />
                          <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                            No chapters cataloged
                          </p>
                          <p className="text-xs text-slate-400 dark:text-slate-500 font-medium max-w-xs mt-1 leading-relaxed">
                            This digital asset does not contain internal chapter divisions or timestamps.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setIsLookingUp(true);
                              setLookupAsin(metadata.asin || "");
                              setLookupError(null);
                              if (metadata.asin) {
                                performChaptersLookup(metadata.asin);
                              }
                            }}
                            className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-wider px-5 py-2.5 rounded-xl transition-all active:scale-95 shadow-md shadow-indigo-100 dark:shadow-none flex items-center gap-1.5 cursor-pointer"
                          >
                            <Sparkles size={12} />
                            Lookup Chapters from Provider
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {/* Details tab network error display */}
          {detailsError && activeTab !== "match" && activeTab !== "statistics" && (
            <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 text-rose-800 dark:text-rose-400 p-4 rounded-2xl flex items-start gap-2.5 text-xs font-semibold mt-4">
              <AlertCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
              <div>{detailsError}</div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
