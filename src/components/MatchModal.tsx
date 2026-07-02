import React, { useState, useEffect } from "react";
import { 
  X, Search, Sparkles, BookOpen, AlertCircle, 
  CheckCircle2, ChevronRight, Info, RefreshCw, HelpCircle
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Book, MatchCandidate } from "../types";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

interface MatchModalProps {
  book: Book;
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

export function MatchModal({ book, onClose, onMatchSuccess, isDark = false }: MatchModalProps) {
  const [provider, setProvider] = useState("audible");
  const [searchTitle, setSearchTitle] = useState(book.metadata?.title || "");
  const [searchAuthor, setSearchAuthor] = useState(book.metadata?.authorName || "");
  
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<MatchCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Selected candidate for final confirmation step
  const [selectedCandidate, setSelectedCandidate] = useState<MatchCandidate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [matchSuccess, setMatchSuccess] = useState(false);

  // Perform search automatically on mount if we have a title
  useEffect(() => {
    if (book.metadata?.title) {
      handleSearch();
    }
  }, []);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchTitle.trim()) {
      setError("A title is required to search for matches.");
      return;
    }

    setLoading(true);
    setError(null);
    setResults([]);
    setSearched(true);
    setSelectedCandidate(null);

    try {
      const data = await api.searchMatches(book.id, provider, searchTitle.trim(), searchAuthor.trim() || undefined);
      setResults(data || []);
      if (data && data.length === 0) {
        setError("No match results found. Try refining your search parameters or changing providers.");
      }
    } catch (err: any) {
      console.error("Match search error:", err);
      setError(
        err.response?.data?.error || 
        "Failed to query external metadata provider. Check your network or server logs."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmMatch = async () => {
    if (!selectedCandidate) return;

    setConfirming(true);
    setError(null);

    try {
      await api.matchLibraryItem(book.id, selectedCandidate);
      setMatchSuccess(true);
      setTimeout(() => {
        onMatchSuccess();
        onClose();
      }, 1500);
    } catch (err: any) {
      console.error("Apply match error:", err);
      setError(
        err.response?.data?.error || 
        "Failed to apply metadata updates. Please try again."
      );
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      {/* Modal Card wrapper */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 5 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 5 }}
        transition={{ duration: 0.2 }}
        className="bg-white dark:bg-slate-900 rounded-md border border-slate-200 dark:border-slate-800 max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden relative"
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/20 dark:bg-slate-900/10">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-650 dark:text-indigo-400 rounded-md shrink-0">
                <Sparkles size={14} className="animate-pulse" />
              </span>
              <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 tracking-tight">Metadata Matcher</h3>
            </div>
            <p className="text-[10px] text-slate-505 dark:text-slate-500 font-semibold uppercase tracking-wider mt-1">
              Associate asset with verified online bibliographical data
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-all cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Main Content Area */}
        <div className="flex-grow overflow-y-auto p-5 flex flex-col gap-5">
          
          {/* Main provider and query search form */}
          {!selectedCandidate && (
            <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end bg-slate-50/50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 p-4 rounded-md">
              <div className="md:col-span-1 space-y-1.5">
                <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Provider</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-indigo-100 dark:focus:ring-indigo-950/30 outline-none transition-all cursor-pointer hover:border-slate-300 dark:hover:border-slate-700"
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
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md px-3.5 py-1.5 text-xs font-semibold focus:ring-1 focus:ring-indigo-100 dark:focus:ring-indigo-955/30 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all"
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
                  className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md px-3.5 py-1.5 text-xs font-semibold focus:ring-1 focus:ring-indigo-100 dark:focus:ring-indigo-955/30 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 outline-none transition-all"
                />
              </div>

              <div className="md:col-span-4 flex justify-end">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-wider px-5 py-2 rounded-md transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {loading ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />}
                  {loading ? "SEARCHING..." : "SEARCH MATCHES"}
                </button>
              </div>
            </form>
          )}

          {/* Results lists & Selection steps */}
          <div className="flex-grow flex flex-col min-h-[250px]">
            
            {/* Error notifications */}
            <AnimatePresence mode="wait">
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="bg-rose-50 dark:bg-rose-955/20 border border-rose-100 dark:border-rose-900/30 text-rose-800 dark:text-rose-400 p-4 rounded-md flex items-start gap-2.5 text-xs font-semibold mb-4"
                >
                  <AlertCircle size={16} className="text-rose-500 shrink-0 mt-0.5" />
                  <div>{error}</div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Loading/Searching visual feedback */}
            {loading && (
              <div className="flex-grow flex flex-col items-center justify-center py-12 text-center">
                <RefreshCw size={24} className="animate-spin text-indigo-650 dark:text-indigo-400 mb-3" />
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Querying database for matches...</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Connecting to {PROVIDERS.find(p => p.id === provider)?.name}</p>
              </div>
            )}

            {/* Candidates Lists */}
            {!loading && !selectedCandidate && searched && results.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-1">
                  <Info size={11} /> {results.length} Candidates Found
                </h4>
                <div className="grid grid-cols-1 gap-2 max-h-[350px] overflow-y-auto pr-1">
                  {results.map((candidate, idx) => (
                    <motion.div
                      key={candidate.id || idx}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
                      onClick={() => setSelectedCandidate(candidate)}
                      className="group border border-slate-100 dark:border-slate-800 rounded-md p-3 flex gap-4 bg-white dark:bg-slate-900 hover:bg-slate-55/50 dark:hover:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700 transition-all cursor-pointer items-start"
                    >
                      {/* Candidate Cover */}
                      <div className="w-12 h-18 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-md overflow-hidden shrink-0 flex items-center justify-center text-slate-300 dark:text-slate-700 transition-shadow">
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

                      {/* Candidate Info */}
                      <div className="flex-grow min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[11px] font-bold text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors leading-tight truncate">
                            {candidate.title}
                          </p>
                          <span className="bg-indigo-50 dark:bg-indigo-950/55 text-indigo-700 dark:text-indigo-400 text-[8px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0">
                            {candidate.provider}
                          </span>
                        </div>
                        {candidate.subtitle && (
                          <p className="text-[9px] text-slate-400 dark:text-slate-550 font-semibold leading-tight mt-0.5 truncate">{candidate.subtitle}</p>
                        )}
                        <p className="text-[9px] text-slate-650 dark:text-slate-350 font-bold mt-1">By {candidate.author || "Unknown Author"}</p>
                        
                        <div className="flex items-center gap-3 mt-2 text-[8px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">
                          {candidate.publisher && <span className="truncate max-w-[150px]">{candidate.publisher}</span>}
                          {candidate.publishDate && <span>({candidate.publishDate.slice(0, 4)})</span>}
                          {candidate.asin && <span>ASIN: {candidate.asin}</span>}
                          {candidate.isbn && <span>ISBN: {candidate.isbn}</span>}
                        </div>
                      </div>

                      {/* Select chevron */}
                      <div className="self-center p-1 border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 group-hover:bg-indigo-55 dark:group-hover:bg-indigo-950/45 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 rounded-md transition-colors">
                        <ChevronRight size={14} />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Instruction placeholder when not searched yet */}
            {!loading && !searched && (
              <div className="flex-grow flex flex-col items-center justify-center py-12 text-center">
                <HelpCircle size={32} className="text-slate-300 dark:text-slate-650 mb-3" />
                <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">Awaiting search initiation</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 font-medium max-w-sm mt-1">
                  Adjust metadata search parameters above and click Search to query online catalog providers.
                </p>
              </div>
            )}

            {/* Side-by-Side Confirmation Step */}
            <AnimatePresence>
              {selectedCandidate && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                    <h4 className="text-[10px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-widest">Confirm Match Association</h4>
                    <button
                      type="button"
                      onClick={() => setSelectedCandidate(null)}
                      className="text-[9px] font-black text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-350 transition-colors uppercase tracking-widest cursor-pointer"
                    >
                      Back to Candidates
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800 p-4 rounded-md relative overflow-hidden">
                    {confirming && (
                      <div className="absolute inset-0 bg-white/70 dark:bg-slate-900/70 backdrop-blur-[1px] flex flex-col items-center justify-center z-10 animate-fade-in">
                        {matchSuccess ? (
                          <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="text-center"
                          >
                            <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-2 animate-bounce" />
                            <p className="text-xs font-bold text-slate-800 dark:text-slate-200">Match confirmed!</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Syncing new library assets...</p>
                          </motion.div>
                        ) : (
                          <div className="text-center">
                            <RefreshCw size={24} className="animate-spin text-indigo-600 dark:text-indigo-400 mx-auto mb-2" />
                            <p className="text-[10px] font-bold text-slate-605 dark:text-slate-450 uppercase tracking-widest">Writing metadata update...</p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Proposed Candidate metadata */}
                    <div className="space-y-2.5">
                      <p className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest block">Proposed Metadata</p>
                      <div className="flex gap-3 bg-white dark:bg-slate-900 p-3 rounded-md border border-indigo-100 dark:border-indigo-950/60">
                        <div className="w-12 h-18 bg-slate-50 dark:bg-slate-955 border border-slate-100 dark:border-slate-800 rounded-md overflow-hidden shrink-0 flex items-center justify-center text-slate-300 dark:text-slate-700">
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

                    {/* Proposed Description snippet */}
                    {selectedCandidate.description && (
                      <div className="space-y-2.5">
                        <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Description Preview</p>
                        <div className="bg-white dark:bg-slate-900 p-3 rounded-md border border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed max-h-[110px] overflow-y-auto">
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
                      className="px-4 py-2 border border-slate-200 dark:border-slate-800 text-slate-650 dark:text-slate-300 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md text-[10px] font-bold transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                    >
                      CANCEL
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmMatch}
                      disabled={confirming}
                      className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle2 size={12} />
                      CONFIRM MATCH & SYNC
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

          </div>

        </div>
      </motion.div>
    </div>
  );
}
